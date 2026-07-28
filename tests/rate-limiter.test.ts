import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RATE_LIMITS,
  RateLimiter,
  withRateLimit
} from '../src/utils/rate-limiter.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('uses the documented default limits and reports an empty initial window', () => {
    const limiter = new RateLimiter();

    expect(DEFAULT_RATE_LIMITS).toEqual({
      maxRequestsPerMinute: 50,
      maxTokensPerMinute: 100000,
      maxConcurrent: 5
    });
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.getStatus()).toEqual({
      activeRequests: 0,
      requestsInWindow: 0,
      tokensInWindow: 0,
      availableRequests: 50,
      availableTokens: 100000
    });
  });

  it('reserves a concurrent slot and records the estimated token usage on acquire', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 2,
      maxTokensPerMinute: 100,
      maxConcurrent: 1
    });

    await limiter.acquire(40);

    expect(limiter.getStatus()).toEqual({
      activeRequests: 1,
      requestsInWindow: 1,
      tokensInWindow: 40,
      availableRequests: 1,
      availableTokens: 60
    });
    expect(limiter.canProceed(1)).toBe(false);
  });

  it('releases a slot and replaces the request estimate with actual token usage', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxTokensPerMinute: 100 });

    await limiter.acquire(40);
    limiter.release(25);

    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 0,
      requestsInWindow: 1,
      tokensInWindow: 25,
      availableTokens: 75
    });
    expect(limiter.canProceed(75)).toBe(true);
  });

  it('never reports negative active requests when release is called without an acquire', () => {
    const limiter = new RateLimiter();

    limiter.release();
    limiter.release();

    expect(limiter.getStatus().activeRequests).toBe(0);
  });

  it('allows requests that exactly consume the remaining token budget', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 3,
      maxTokensPerMinute: 100,
      maxConcurrent: 3
    });

    await limiter.acquire(70);
    limiter.release();

    expect(limiter.canProceed(30)).toBe(true);
    expect(limiter.canProceed(31)).toBe(false);
  });

  it('blocks a later acquire until the oldest request falls outside the 60-second window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 1,
      maxTokensPerMinute: 1000,
      maxConcurrent: 2
    });

    await limiter.acquire(100);
    limiter.release();
    const queuedAcquire = limiter.acquire(100);
    let completed = false;
    void queuedAcquire.then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(59999);
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(queuedAcquire).resolves.toBeUndefined();
    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 1,
      requestsInWindow: 1,
      tokensInWindow: 100
    });
  });

  it('waits for token capacity to re-enter the sliding window before acquiring', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 10,
      maxTokensPerMinute: 100,
      maxConcurrent: 2
    });

    await limiter.acquire(100);
    limiter.release();
    const queuedAcquire = limiter.acquire(1);
    let completed = false;
    void queuedAcquire.then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(59999);
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(queuedAcquire).resolves.toBeUndefined();
    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 1,
      requestsInWindow: 1,
      tokensInWindow: 1
    });
  });

  it('prunes records exactly at the 60-second boundary for status and eligibility checks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 1,
      maxTokensPerMinute: 100,
      maxConcurrent: 2
    });

    await limiter.acquire(100);
    limiter.release();
    await vi.advanceTimersByTimeAsync(60000);

    expect(limiter.getStatus()).toEqual({
      activeRequests: 0,
      requestsInWindow: 0,
      tokensInWindow: 0,
      availableRequests: 1,
      availableTokens: 100
    });
    expect(limiter.canProceed(100)).toBe(true);
  });

  it('queues concurrent acquires and admits one waiter per release in FIFO order', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 10,
      maxTokensPerMinute: 1000,
      maxConcurrent: 1
    });
    const order: string[] = [];

    await limiter.acquire(10);
    const second = limiter.acquire(10).then(() => order.push('second'));
    const third = limiter.acquire(10).then(() => order.push('third'));
    await Promise.resolve();

    expect(order).toEqual([]);
    expect(limiter.getStatus().activeRequests).toBe(1);

    limiter.release();
    await second;
    expect(order).toEqual(['second']);
    expect(limiter.getStatus().activeRequests).toBe(1);

    limiter.release();
    await third;
    expect(order).toEqual(['second', 'third']);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });
});

describe('withRateLimit', () => {
  it('releases the slot after a successful operation', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });

    await expect(withRateLimit(limiter, async () => 'complete', 12)).resolves.toBe(
      'complete'
    );
    expect(limiter.getStatus().activeRequests).toBe(0);
  });

  it('releases the slot and preserves an operation error', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const failure = new Error('review failed');

    await expect(
      withRateLimit(limiter, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(limiter.getStatus().activeRequests).toBe(0);
  });
});
