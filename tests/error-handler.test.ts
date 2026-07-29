import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ErrorCodes,
  formatError,
  isReviewError,
  ReviewError,
  withRetry,
  withTimeout
} from '../src/utils/error-handler.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ReviewError', () => {
  it('preserves the message, code, and optional metadata', () => {
    const metadata = { file: 'src/example.ts', attempt: 2 };
    const error = new ReviewError(
      'Unable to review the file',
      ErrorCodes.AGENT_FAILED,
      metadata
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error.name).toBe('ReviewError');
    expect(error.message).toBe('Unable to review the file');
    expect(error.code).toBe(ErrorCodes.AGENT_FAILED);
    expect(error.metadata).toEqual(metadata);
    expect(error.stack).toContain('ReviewError');
  });

  it('leaves metadata undefined when it is not supplied', () => {
    const error = new ReviewError('Missing key', ErrorCodes.MISSING_API_KEY);

    expect(error.metadata).toBeUndefined();
  });
});

describe('ErrorCodes', () => {
  it('exposes the complete set of stable review error codes', () => {
    expect(ErrorCodes).toEqual({
      MISSING_API_KEY: 'MISSING_API_KEY',
      MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
      INVALID_CONFIG: 'INVALID_CONFIG',
      PR_NOT_FOUND: 'PR_NOT_FOUND',
      FILE_NOT_FOUND: 'FILE_NOT_FOUND',
      GITHUB_API_ERROR: 'GITHUB_API_ERROR',
      RATE_LIMITED: 'RATE_LIMITED',
      AGENT_TIMEOUT: 'AGENT_TIMEOUT',
      AGENT_FAILED: 'AGENT_FAILED',
      STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',
      RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
      VALIDATION_FAILED: 'VALIDATION_FAILED',
      WORKSPACE_PREPARATION_FAILED: 'WORKSPACE_PREPARATION_FAILED',
      UNKNOWN_ERROR: 'UNKNOWN_ERROR'
    });
  });
});

describe('isReviewError', () => {
  it('identifies ReviewError instances', () => {
    expect(
      isReviewError(new ReviewError('Not found', ErrorCodes.PR_NOT_FOUND))
    ).toBe(true);
  });

  it.each([new Error('ordinary error'), 'error', 42, null, undefined, {}])(
    'returns false for non-ReviewError values: %p',
    error => {
      expect(isReviewError(error)).toBe(false);
    }
  );
});

describe('formatError', () => {
  it('includes a ReviewError code and message', () => {
    const error = new ReviewError('Rate limit reached', ErrorCodes.RATE_LIMITED);

    expect(formatError(error)).toBe('[RATE_LIMITED] Rate limit reached');
  });

  it('returns the message from an ordinary Error', () => {
    expect(formatError(new Error('Network unavailable'))).toBe(
      'Network unavailable'
    );
  });

  it.each([
    ['a string error', 'a string error'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined'],
    [{ reason: 'unknown' }, '[object Object]']
  ])('stringifies non-Error values', (error, expected) => {
    expect(formatError(error)).toBe(expected);
  });
});

describe('withRetry', () => {
  it('returns the result from a successful first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('review complete');

    await expect(withRetry(operation)).resolves.toBe('review complete');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries failed operations with exponential backoff before succeeding', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('another temporary failure'))
      .mockResolvedValueOnce('review complete');

    const result = withRetry(operation, 3, 10);
    void result.catch(() => undefined);

    expect(operation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9);
    expect(operation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(19);
    expect(operation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('review complete');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED after the configured number of failed attempts', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error('persistent failure'));

    const result = withRetry(operation, 3, 5);
    void result.catch(() => undefined);

    await vi.runAllTimersAsync();

    await expect(result).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED
    });
    expect(operation).toHaveBeenCalledTimes(4);
  });
});

describe('withTimeout', () => {
  it('returns a result when the operation completes before the timeout', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(
      () => new Promise<string>(resolve => setTimeout(() => resolve('done'), 10))
    );
    const result = withTimeout(operation, 20);
    void result.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('throws an AGENT_TIMEOUT ReviewError with timeout metadata', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(
      () => new Promise<never>(() => undefined)
    );
    const result = withTimeout(operation, 25);
    void result.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).rejects.toMatchObject({
      name: 'ReviewError',
      message: 'Operation timed out',
      code: ErrorCodes.AGENT_TIMEOUT,
      metadata: { timeoutMs: 25 }
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('uses the supplied timeout message', async () => {
    vi.useFakeTimers();
    const result = withTimeout(
      () => new Promise<never>(() => undefined),
      15,
      'Analyzer did not finish in time'
    );
    void result.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(15);

    await expect(result).rejects.toMatchObject({
      message: 'Analyzer did not finish in time',
      code: ErrorCodes.AGENT_TIMEOUT,
      metadata: { timeoutMs: 15 }
    });
  });

  it('preserves an operation error that occurs before the timeout', async () => {
    const operationError = new Error('Analyzer crashed');

    await expect(
      withTimeout(() => Promise.reject(operationError), 100)
    ).rejects.toBe(operationError);
  });
});
