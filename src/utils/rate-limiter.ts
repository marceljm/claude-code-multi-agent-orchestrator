import {
  ErrorCodes,
  ReviewError
} from './error-handler.js';

/**
 * Rate-limiter configuration.
 */
export interface RateLimiterConfig {
  /** Maximum admitted requests during one sliding window. */
  maxRequestsPerMinute: number;

  /** Maximum admitted tokens during one sliding window. */
  maxTokensPerMinute: number;

  /** Maximum number of operations running concurrently. */
  maxConcurrent: number;
}

/**
 * Conservative default limits.
 */
export const DEFAULT_RATE_LIMITS:
  RateLimiterConfig = {
    maxRequestsPerMinute: 50,
    maxTokensPerMinute: 100000,
    maxConcurrent: 5
  };

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

const RATE_WINDOW_MS = 60000;

function assertPositiveInteger(
  value: number,
  name: keyof RateLimiterConfig
): void {
  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new ReviewError(
      `${name} must be a positive integer.`,
      ErrorCodes.INVALID_CONFIG,
      {
        [name]: value
      }
    );
  }
}

function assertTokenCount(
  value: number,
  name:
    | 'estimatedTokens'
    | 'actualTokens'
): void {
  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new ReviewError(
      `${name} must be a non-negative integer.`,
      ErrorCodes.INVALID_CONFIG,
      {
        [name]: value
      }
    );
  }
}

function sleep(
  delayMs: number
): Promise<void> {
  return new Promise(resolve => {
    setTimeout(
      resolve,
      delayMs
    );
  });
}

/**
 * FIFO sliding-window limiter for request, token, and concurrency limits.
 *
 * Acquisitions are serialized while capacity is reserved. This prevents two
 * callers from observing the same available slot and both reserving it.
 */
export class RateLimiter {
  private readonly config:
    RateLimiterConfig;

  private requestHistory:
    RequestRecord[] = [];

  private activeRequests = 0;

  private waitQueue:
    Array<() => void> = [];

  private acquisitionLock:
    Promise<void> =
      Promise.resolve();

  constructor(
    config:
      Partial<RateLimiterConfig> = {}
  ) {
    const mergedConfig = {
      ...DEFAULT_RATE_LIMITS,
      ...config
    };

    assertPositiveInteger(
      mergedConfig.maxRequestsPerMinute,
      'maxRequestsPerMinute'
    );

    assertPositiveInteger(
      mergedConfig.maxTokensPerMinute,
      'maxTokensPerMinute'
    );

    assertPositiveInteger(
      mergedConfig.maxConcurrent,
      'maxConcurrent'
    );

    this.config = mergedConfig;
  }

  /**
   * Wait until one operation can be admitted.
   */
  async acquire(
    estimatedTokens: number = 1000
  ): Promise<void> {
    assertTokenCount(
      estimatedTokens,
      'estimatedTokens'
    );

    if (
      estimatedTokens >
        this.config.maxTokensPerMinute
    ) {
      throw new ReviewError(
        'The estimated token count exceeds the configured per-minute token limit.',
        ErrorCodes.RATE_LIMITED,
        {
          estimatedTokens,
          maxTokensPerMinute:
            this.config.maxTokensPerMinute
        }
      );
    }

    const unlock =
      await this.lockAcquisition();

    try {
      while (
        this.activeRequests >=
          this.config.maxConcurrent
      ) {
        await this.waitForSlot();
      }

      await this.waitForRateLimit(
        estimatedTokens
      );

      this.activeRequests += 1;

      this.requestHistory.push({
        timestamp: Date.now(),
        tokens: estimatedTokens
      });
    } finally {
      unlock();
    }
  }

  /**
   * Release one active operation.
   *
   * When actualTokens is supplied, it replaces the latest request estimate.
   * This preserves the starter API while allowing a completed operation to
   * correct its estimate.
   */
  release(
    actualTokens?: number
  ): void {
    if (actualTokens !== undefined) {
      assertTokenCount(
        actualTokens,
        'actualTokens'
      );
    }

    if (this.activeRequests === 0) {
      return;
    }

    if (
      actualTokens !== undefined &&
      this.requestHistory.length > 0
    ) {
      const lastRequest =
        this.requestHistory[
          this.requestHistory.length - 1
        ];

      if (lastRequest) {
        lastRequest.tokens =
          actualTokens;
      }
    }

    this.activeRequests -= 1;

    const next =
      this.waitQueue.shift();

    next?.();
  }

  /**
   * Return the current sliding-window status.
   */
  getStatus(): {
    activeRequests: number;
    requestsInWindow: number;
    tokensInWindow: number;
    availableRequests: number;
    availableTokens: number;
  } {
    this.pruneOldRecords();

    const requestsInWindow =
      this.requestHistory.length;

    const tokensInWindow =
      this.requestHistory.reduce(
        (
          sum,
          record
        ) => sum + record.tokens,
        0
      );

    return {
      activeRequests:
        this.activeRequests,

      requestsInWindow,

      tokensInWindow,

      availableRequests:
        Math.max(
          0,
          this.config
            .maxRequestsPerMinute -
            requestsInWindow
        ),

      availableTokens:
        Math.max(
          0,
          this.config
            .maxTokensPerMinute -
            tokensInWindow
        )
    };
  }

  /**
   * Check whether an operation could be admitted immediately.
   */
  canProceed(
    estimatedTokens: number = 1000
  ): boolean {
    assertTokenCount(
      estimatedTokens,
      'estimatedTokens'
    );

    if (
      estimatedTokens >
        this.config.maxTokensPerMinute
    ) {
      return false;
    }

    this.pruneOldRecords();

    const requestsInWindow =
      this.requestHistory.length;

    const tokensInWindow =
      this.requestHistory.reduce(
        (
          sum,
          record
        ) => sum + record.tokens,
        0
      );

    return (
      this.activeRequests <
        this.config.maxConcurrent &&
      requestsInWindow <
        this.config
          .maxRequestsPerMinute &&
      tokensInWindow +
        estimatedTokens <=
        this.config
          .maxTokensPerMinute
    );
  }

  /**
   * Acquire the internal FIFO admission lock.
   */
  private async lockAcquisition():
    Promise<() => void> {
    const previous =
      this.acquisitionLock;

    let unlock:
      (() => void) | undefined;

    this.acquisitionLock =
      new Promise<void>(resolve => {
        unlock = resolve;
      });

    await previous;

    if (!unlock) {
      throw new ReviewError(
        'Unable to initialize the rate-limiter acquisition lock.',
        ErrorCodes.UNKNOWN_ERROR
      );
    }

    return unlock;
  }

  /**
   * Wait for one active-operation slot.
   */
  private waitForSlot():
    Promise<void> {
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Wait until the oldest relevant record leaves the sliding window.
   */
  private async waitForRateLimit(
    estimatedTokens: number
  ): Promise<void> {
    while (
      !this.canProceed(
        estimatedTokens
      )
    ) {
      this.pruneOldRecords();

      const oldestRequest =
        this.requestHistory[0];

      if (!oldestRequest) {
        return;
      }

      const expiresAt =
        oldestRequest.timestamp +
        RATE_WINDOW_MS;

      const waitMs =
        Math.max(
          1,
          expiresAt - Date.now()
        );

      await sleep(waitMs);
    }
  }

  /**
   * Remove records that are no longer inside the 60-second window.
   */
  private pruneOldRecords(): void {
    const cutoff =
      Date.now() -
      RATE_WINDOW_MS;

    this.requestHistory =
      this.requestHistory.filter(
        record =>
          record.timestamp > cutoff
      );
  }
}

/**
 * Run one operation while holding a rate-limiter reservation.
 */
export async function withRateLimit<T>(
  rateLimiter: RateLimiter,
  fn: () => Promise<T>,
  estimatedTokens: number = 1000
): Promise<T> {
  let acquired = false;

  try {
    await rateLimiter.acquire(
      estimatedTokens
    );

    acquired = true;

    return await fn();
  } finally {
    if (acquired) {
      rateLimiter.release();
    }
  }
}

/**
 * Shared limiter for callers that do not require isolated limits.
 */
export const globalRateLimiter =
  new RateLimiter();
