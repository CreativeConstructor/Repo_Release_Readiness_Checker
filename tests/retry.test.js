const { withRetry, isTransientError, calculateDelay } = require('../utils/retry');

describe('withRetry Utility & Exponential Backoff', () => {
  test('returns result immediately when operation succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on network error code ECONNRESET and succeeds on subsequent attempt', async () => {
    const networkErr = new Error('Connection reset');
    networkErr.code = 'ECONNRESET';

    const fn = jest.fn().mockRejectedValueOnce(networkErr).mockResolvedValueOnce('recovered');

    const onRetry = jest.fn();
    const result = await withRetry(fn, {
      retries: 2,
      baseDelayMs: 5,
      jitterMs: 5,
      onRetry,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(networkErr, 1, expect.any(Number));
  });

  test('retries on HTTP 429 Too Many Requests and HTTP 503 Service Unavailable', async () => {
    const err429 = new Error('Rate limit exceeded');
    err429.status = 429;

    const err503 = new Error('Gateway Timeout');
    err503.status = 503;

    const fn = jest
      .fn()
      .mockRejectedValueOnce(err429)
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce('eventual_success');

    const result = await withRetry(fn, {
      retries: 3,
      baseDelayMs: 5,
      jitterMs: 5,
    });

    expect(result).toBe('eventual_success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('NEVER retries HTTP 400, 401, 403, or 404 errors', async () => {
    const nonRetryableCodes = [400, 401, 403, 404, 422];

    for (const status of nonRetryableCodes) {
      const err = new Error(`Client Error ${status}`);
      err.status = status;

      const fn = jest.fn().mockRejectedValue(err);

      await expect(
        withRetry(fn, {
          retries: 3,
          baseDelayMs: 5,
          jitterMs: 5,
        })
      ).rejects.toThrow(`Client Error ${status}`);

      // Crucial: Must fail immediately without retrying
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  test('throws final error after exhausting all retries on persistent 5xx failure', async () => {
    const serverErr = new Error('Internal Server Error');
    serverErr.status = 500;

    const fn = jest.fn().mockRejectedValue(serverErr);

    await expect(
      withRetry(fn, {
        retries: 2,
        baseDelayMs: 5,
        jitterMs: 5,
      })
    ).rejects.toThrow('Internal Server Error');

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  test('isTransientError accurately identifies transient conditions', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientError({ code: 'ENOTFOUND' })).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);

    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 403 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });

  test('calculateDelay respects maxDelayMs and adds non-negative jitter', () => {
    const delay = calculateDelay(0, 100, 2, 1000, 50);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(150);

    const cappedDelay = calculateDelay(10, 100, 2, 500, 50);
    expect(cappedDelay).toBe(500);
  });
});
