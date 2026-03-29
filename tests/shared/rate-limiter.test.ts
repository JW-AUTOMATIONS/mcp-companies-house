import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenBucketRateLimiter } from '../../src/shared/rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within budget', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10, refillRate: 2 });
    expect(limiter.tryConsume(1)).toBe(true);
    expect(limiter.tokensRemaining()).toBe(9);
  });

  it('rejects when bucket is empty', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 3, refillRate: 1 });
    expect(limiter.tryConsume(3)).toBe(true);
    expect(limiter.tryConsume(1)).toBe(false);
  });

  it('refills over time', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10, refillRate: 2 });
    limiter.tryConsume(10);
    expect(limiter.tokensRemaining()).toBe(0);

    vi.advanceTimersByTime(3000);
    expect(limiter.tokensRemaining()).toBe(6);
  });

  it('does not exceed max tokens', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10, refillRate: 100 });
    vi.advanceTimersByTime(10000);
    expect(limiter.tokensRemaining()).toBe(10);
  });

  it('consumes multiple tokens at once', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 600, refillRate: 2 });
    expect(limiter.tryConsume(6)).toBe(true);
    expect(limiter.tokensRemaining()).toBe(594);
  });

  it('rejects partial consume', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRate: 1 });
    limiter.tryConsume(3);
    expect(limiter.tryConsume(5)).toBe(false);
    expect(limiter.tokensRemaining()).toBe(2);
  });

  it('waitForTokens resolves after refill', async () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRate: 1 });
    limiter.tryConsume(5);

    const promise = limiter.waitForTokens(2);
    vi.advanceTimersByTime(2000);
    await promise;
    expect(limiter.tokensRemaining()).toBe(0);
  });
});
