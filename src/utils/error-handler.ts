/**
 * Custom error class for review operations.
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    Error.captureStackTrace(
      this,
      ReviewError
    );
  }
}

/**
 * Error codes for the review system.
 */
export const ErrorCodes = {
  // Configuration errors
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN:
    'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // GitHub errors
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Agent errors
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED:
    'STRUCTURED_OUTPUT_FAILED',

  // General errors
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED:
    'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode =
  typeof ErrorCodes[
    keyof typeof ErrorCodes
  ];

const MAX_JITTER_MS = 100;

function assertNonNegativeInteger(
  value: number,
  name: string
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

function assertNonNegativeFiniteNumber(
  value: number,
  name: string
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new ReviewError(
      `${name} must be a non-negative finite number.`,
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
 * Retry an asynchronous operation with exponential backoff and jitter.
 *
 * maxRetries is the number of retries after the initial attempt. Therefore,
 * maxRetries=3 allows at most four total attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  assertNonNegativeInteger(
    maxRetries,
    'maxRetries'
  );

  assertNonNegativeFiniteNumber(
    delayMs,
    'delayMs'
  );

  const totalAttempts =
    maxRetries + 1;

  let lastError: unknown;

  for (
    let attemptIndex = 0;
    attemptIndex < totalAttempts;
    attemptIndex += 1
  ) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const retriesRemain =
        attemptIndex < maxRetries;

      if (!retriesRemain) {
        break;
      }

      const exponentialDelay =
        delayMs *
        Math.pow(
          2,
          attemptIndex
        );

      const jitter =
        Math.floor(
          Math.random() *
            (MAX_JITTER_MS + 1)
        );

      await sleep(
        exponentialDelay + jitter
      );
    }
  }

  const lastErrorMessage =
    formatError(lastError);

  const attemptLabel =
    totalAttempts === 1
      ? 'attempt'
      : 'attempts';

  throw new ReviewError(
    `Operation failed after ${totalAttempts} ${attemptLabel}: ${lastErrorMessage}`,
    ErrorCodes.RETRY_EXHAUSTED,
    {
      attempts: totalAttempts,
      maxRetries,
      delayMs,
      lastError: lastErrorMessage
    }
  );
}

/**
 * Race an asynchronous operation against a timeout.
 *
 * The operation's original rejection is propagated unchanged when it fails
 * before the timeout.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string =
    'Operation timed out'
): Promise<T> {
  assertNonNegativeFiniteNumber(
    timeoutMs,
    'timeoutMs'
  );

  let timeoutId:
    ReturnType<typeof setTimeout> |
    undefined;

  const timeoutPromise =
    new Promise<never>(
      (_resolve, reject) => {
        timeoutId = setTimeout(
          () => {
            reject(
              new ReviewError(
                errorMessage,
                ErrorCodes.AGENT_TIMEOUT,
                {
                  timeoutMs
                }
              )
            );
          },
          timeoutMs
        );
      }
    );

  const operationPromise =
    Promise.resolve().then(fn);

  try {
    return await Promise.race([
      operationPromise,
      timeoutPromise
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Check if an error is a ReviewError.
 */
export function isReviewError(
  error: unknown
): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Format an error for logging or display.
 */
export function formatError(
  error: unknown
): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
