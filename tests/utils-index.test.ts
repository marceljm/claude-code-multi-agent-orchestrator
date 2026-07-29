import {
  describe,
  expect,
  it
} from 'vitest';

import {
  DEFAULT_RATE_LIMITS,
  ErrorCodes,
  RateLimiter,
  ReportGenerator,
  ReviewError,
  formatError,
  globalRateLimiter,
  isReviewError,
  logger,
  withRateLimit,
  withRetry,
  withTimeout
} from '../src/utils/index.js';

describe('utility barrel exports', () => {
  it('exports every completed utility', () => {
    expect(logger).toBeDefined();
    expect(ReportGenerator).toBeTypeOf('function');
    expect(RateLimiter).toBeTypeOf('function');
    expect(globalRateLimiter).toBeInstanceOf(RateLimiter);
    expect(DEFAULT_RATE_LIMITS).toEqual({
      maxRequestsPerMinute: 50,
      maxTokensPerMinute: 100000,
      maxConcurrent: 5
    });
    expect(ReviewError).toBeTypeOf('function');
    expect(ErrorCodes).toBeDefined();
    expect(withRateLimit).toBeTypeOf('function');
    expect(withRetry).toBeTypeOf('function');
    expect(withTimeout).toBeTypeOf('function');
    expect(isReviewError).toBeTypeOf('function');
    expect(formatError).toBeTypeOf('function');
  });
});
