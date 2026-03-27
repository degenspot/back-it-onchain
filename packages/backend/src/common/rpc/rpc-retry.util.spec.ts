/**
 * rpc-retry.util.spec.ts
 *
 * Tests for the exponential-backoff retry engine:
 *   - RpcExhaustedError / RpcNonRetryableError
 *   - withRetry (success, exhaustion, non-retryable, isRetryable predicate)
 *   - createRetryFn
 *   - defaultSorobanIsRetryable
 */

import {
  withRetry,
  createRetryFn,
  defaultSorobanIsRetryable,
  RpcExhaustedError,
  RpcNonRetryableError,
  RetryOptions,
} from './rpc-retry.util';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Speeds up tests by replacing every setTimeout with an immediate resolve. */
function useFakeTimers() {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
}

/**
 * Creates an async spy that fails `failTimes` times before resolving `value`.
 * `advanceTime` drains pending fake timers after each awaited tick so that
 * the retry sleep never blocks the test.
 */
function makeFlakySpy<T>(failTimes: number, value: T, error = new Error('transient')) {
  let calls = 0;
  return jest.fn(async () => {
    calls += 1;
    if (calls <= failTimes) throw error;
    return value;
  });
}

/** Runs withRetry while automatically advancing fake timers on each tick. */
async function runWithAutoAdvance<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const promise = withRetry(fn, options);
  // Drain all pending timers iteratively until the promise settles
  let settled = false;
  promise.then(() => (settled = true)).catch(() => (settled = true));

  while (!settled) {
    await Promise.resolve(); // flush micro-task queue
    jest.runAllTimers();
    await Promise.resolve();
  }
  return promise;
}

// ─── Error classes ────────────────────────────────────────────────────────────

describe('RpcExhaustedError', () => {
  it('should have the correct name', () => {
    const err = new RpcExhaustedError('op', 3, new Error('last'));
    expect(err.name).toBe('RpcExhaustedError');
  });

  it('should be an instance of Error', () => {
    expect(new RpcExhaustedError('op', 1, new Error('x'))).toBeInstanceOf(Error);
  });

  it('should embed operation, attempts and lastError in the message', () => {
    const last = new Error('connection refused');
    const err = new RpcExhaustedError('fetchBalance', 4, last);
    expect(err.message).toContain('fetchBalance');
    expect(err.message).toContain('4');
    expect(err.message).toContain('connection refused');
  });

  it('should expose operation, attempts and lastError as properties', () => {
    const last = new Error('boom');
    const err = new RpcExhaustedError('myOp', 2, last);
    expect(err.operation).toBe('myOp');
    expect(err.attempts).toBe(2);
    expect(err.lastError).toBe(last);
  });
});

describe('RpcNonRetryableError', () => {
  it('should have the correct name', () => {
    expect(new RpcNonRetryableError('bad request').name).toBe('RpcNonRetryableError');
  });

  it('should be an instance of Error', () => {
    expect(new RpcNonRetryableError('x')).toBeInstanceOf(Error);
  });

  it('should optionally store the underlying cause', () => {
    const cause = new Error('original');
    const err = new RpcNonRetryableError('wrapped', cause);
    expect(err.cause).toBe(cause);
  });

  it('should work without a cause', () => {
    expect(() => new RpcNonRetryableError('no cause')).not.toThrow();
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  useFakeTimers();

  describe('success path', () => {
    it('should resolve immediately when fn succeeds on the first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await withRetry(fn, { maxAttempts: 3 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should resolve after partial failures then a success', async () => {
      const fn = makeFlakySpy(2, 'value');
      const result = await runWithAutoAdvance(fn, {
        maxAttempts: 4,
        baseDelayMs: 0,
        jitter: 0,
      });
      expect(result).toBe('value');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should succeed on the very last allowed attempt', async () => {
      const fn = makeFlakySpy(3, 'last-chance');
      const result = await runWithAutoAdvance(fn, {
        maxAttempts: 4,
        baseDelayMs: 0,
        jitter: 0,
      });
      expect(result).toBe('last-chance');
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

  describe('exhaustion', () => {
    it('should throw RpcExhaustedError when all attempts fail', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      const promise = runWithAutoAdvance(fn, {
        maxAttempts: 3,
        baseDelayMs: 0,
        jitter: 0,
      });
      await expect(promise).rejects.toBeInstanceOf(RpcExhaustedError);
    });

    it('should call fn exactly maxAttempts times', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('err'));
      await runWithAutoAdvance(fn, { maxAttempts: 3, baseDelayMs: 0, jitter: 0 }).catch(() => {});
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should include the operation name in the exhausted error', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      await expect(
        runWithAutoAdvance(fn, {
          maxAttempts: 2,
          baseDelayMs: 0,
          jitter: 0,
          operationName: 'myRpcCall',
        }),
      ).rejects.toMatchObject({ operation: 'myRpcCall' });
    });

    it('should expose the last error via RpcExhaustedError.lastError', async () => {
      const last = new Error('last-specific-error');
      const fn = jest.fn().mockRejectedValue(last);
      await expect(
        runWithAutoAdvance(fn, { maxAttempts: 2, baseDelayMs: 0, jitter: 0 }),
      ).rejects.toMatchObject({ lastError: last });
    });

    it('should use the default maxAttempts of 4 when not specified', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('err'));
      await runWithAutoAdvance(fn, { baseDelayMs: 0, jitter: 0 }).catch(() => {});
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

  describe('RpcNonRetryableError passthrough', () => {
    it('should rethrow RpcNonRetryableError immediately without further attempts', async () => {
      const nonRetryable = new RpcNonRetryableError('logic error');
      const fn = jest.fn().mockRejectedValue(nonRetryable);

      await expect(
        withRetry(fn, { maxAttempts: 5, baseDelayMs: 0 }),
      ).rejects.toBeInstanceOf(RpcNonRetryableError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should preserve the RpcNonRetryableError message', async () => {
      const fn = jest.fn().mockRejectedValue(new RpcNonRetryableError('bad input'));
      await expect(withRetry(fn, { baseDelayMs: 0 })).rejects.toMatchObject({
        message: 'bad input',
      });
    });
  });

  describe('isRetryable predicate', () => {
    it('should stop retrying when the predicate returns false', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('400 Bad Request'));
      const isRetryable = jest.fn().mockReturnValue(false);

      await expect(
        withRetry(fn, { maxAttempts: 5, baseDelayMs: 0, isRetryable }),
      ).rejects.toBeInstanceOf(RpcNonRetryableError);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(isRetryable).toHaveBeenCalledTimes(1);
    });

    it('should continue retrying while the predicate returns true', async () => {
      const fn = makeFlakySpy(2, 'done');
      const isRetryable = jest.fn().mockReturnValue(true);
      const result = await runWithAutoAdvance(fn, {
        maxAttempts: 4,
        baseDelayMs: 0,
        jitter: 0,
        isRetryable,
      });
      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should pass the current attempt number to the predicate', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const isRetryable = jest.fn().mockReturnValue(true);
      await runWithAutoAdvance(fn, {
        maxAttempts: 3,
        baseDelayMs: 0,
        jitter: 0,
        isRetryable,
      }).catch(() => {});
      // predicate called for attempts 1 and 2 (attempt 3 is the last, no sleep → exhausted)
      expect(isRetryable).toHaveBeenCalledWith(expect.any(Error), 1);
      expect(isRetryable).toHaveBeenCalledWith(expect.any(Error), 2);
    });
  });

  describe('non-Error rejection values', () => {
    it('should wrap a string rejection in an Error', async () => {
      const fn = jest.fn().mockRejectedValue('string error');
      await expect(
        runWithAutoAdvance(fn, { maxAttempts: 1, baseDelayMs: 0 }),
      ).rejects.toMatchObject({ attempts: 1 });
    });
  });
});

// ─── createRetryFn ────────────────────────────────────────────────────────────

describe('createRetryFn', () => {
  useFakeTimers();

  it('should return a function', () => {
    const retryFn = createRetryFn({ maxAttempts: 2 });
    expect(typeof retryFn).toBe('function');
  });

  it('should use the default options supplied to createRetryFn', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const retry = createRetryFn({ maxAttempts: 2, baseDelayMs: 0, jitter: 0 });
    const promise = retry(fn);
    let settled = false;
    promise.then(() => (settled = true)).catch(() => (settled = true));
    while (!settled) {
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();
    }
    await promise.catch(() => {});
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should allow per-call option overrides', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const retry = createRetryFn({ maxAttempts: 5, baseDelayMs: 0, jitter: 0 });
    const promise = retry(fn, { maxAttempts: 2, baseDelayMs: 0, jitter: 0 });
    const settled = { value: false };
    promise.then(() => (settled.value = true)).catch(() => (settled.value = true));
    while (!settled.value) {
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();
    }
    await promise.catch(() => {});
    expect(fn).toHaveBeenCalledTimes(2); // override wins
  });

  it('should resolve successfully through the created wrapper', async () => {
    const fn = jest.fn().mockResolvedValue(42);
    const retry = createRetryFn({ maxAttempts: 3 });
    await expect(retry(fn)).resolves.toBe(42);
  });
});

// ─── defaultSorobanIsRetryable ────────────────────────────────────────────────

describe('defaultSorobanIsRetryable', () => {
  // Rate-limit → always retry
  it('should return true for a 429 error', () => {
    expect(defaultSorobanIsRetryable(new Error('HTTP 429'))).toBe(true);
  });

  it('should return true for an error containing "rate limit"', () => {
    expect(defaultSorobanIsRetryable(new Error('rate limit exceeded'))).toBe(true);
  });

  it('should return true for an error containing "too many requests"', () => {
    expect(defaultSorobanIsRetryable(new Error('too many requests'))).toBe(true);
  });

  // Client errors (4xx except 408 / 425 / 429) → non-retryable
  it('should return false for a 400 Bad Request error', () => {
    expect(defaultSorobanIsRetryable(new Error('400 Bad Request'))).toBe(false);
  });

  it('should return false for a 401 Unauthorized error', () => {
    expect(defaultSorobanIsRetryable(new Error('401 Unauthorized'))).toBe(false);
  });

  it('should return false for a 403 Forbidden error', () => {
    expect(defaultSorobanIsRetryable(new Error('403 Forbidden'))).toBe(false);
  });

  it('should return false for a 404 Not Found error', () => {
    expect(defaultSorobanIsRetryable(new Error('404 Not Found'))).toBe(false);
  });

  it('should return false for a 422 Unprocessable Entity error', () => {
    expect(defaultSorobanIsRetryable(new Error('422 Unprocessable Entity'))).toBe(false);
  });

  // 408 Request Timeout and 425 Too Early are retryable even though they're 4xx
  it('should return true for a 408 Request Timeout error', () => {
    expect(defaultSorobanIsRetryable(new Error('408 Request Timeout'))).toBe(true);
  });

  it('should return true for a 425 Too Early error', () => {
    expect(defaultSorobanIsRetryable(new Error('425 Too Early'))).toBe(true);
  });

  // Network / 5xx → retryable
  it('should return true for a 500 Internal Server Error', () => {
    expect(defaultSorobanIsRetryable(new Error('500 Internal Server Error'))).toBe(true);
  });

  it('should return true for a 503 Service Unavailable error', () => {
    expect(defaultSorobanIsRetryable(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('should return true for a generic network error', () => {
    expect(defaultSorobanIsRetryable(new Error('ECONNRESET'))).toBe(true);
  });

  it('should return true for a timeout error', () => {
    expect(defaultSorobanIsRetryable(new Error('connection timed out'))).toBe(true);
  });

  it('should return true for an unknown error (fail-safe)', () => {
    expect(defaultSorobanIsRetryable(new Error('something unexpected'))).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(defaultSorobanIsRetryable(new Error('HTTP 400 BAD REQUEST'))).toBe(false);
    expect(defaultSorobanIsRetryable(new Error('RATE LIMIT EXCEEDED'))).toBe(true);
  });
});
