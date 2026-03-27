/**
 * retryable.decorator.spec.ts
 *
 * Tests for the @Retryable() method decorator:
 *   - Shorthand usage: @Retryable(maxAttempts)
 *   - Full config usage: @Retryable({ ... })
 *   - Correct retry count, success forwarding, error propagation
 *   - operationName defaults to "ClassName.methodName"
 *   - defaultSorobanIsRetryable is wired in automatically
 *   - Original method name is preserved on the descriptor
 */

import { RpcExhaustedError, RpcNonRetryableError } from '../common/rpc/rpc-retry.util';
import { Retryable } from './retryable.decorator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runs all pending fake timers until the supplied promise settles. */
async function drainTimers(promise: Promise<unknown>) {
  let settled = false;
  promise.then(() => (settled = true)).catch(() => (settled = true));
  while (!settled) {
    await Promise.resolve();
    jest.runAllTimers();
    await Promise.resolve();
  }
}

// ─── Test classes ─────────────────────────────────────────────────────────────

class ServiceWithShorthand {
  public callCount = 0;
  public shouldFail = true;

  @Retryable(3)
  async fetchData(): Promise<string> {
    this.callCount++;
    if (this.shouldFail && this.callCount < 3) throw new Error('transient');
    return 'result';
  }
}

class ServiceWithOptions {
  public callCount = 0;

  @Retryable({ maxAttempts: 2, baseDelayMs: 0, jitter: 0 })
  async alwaysFails(): Promise<never> {
    this.callCount++;
    throw new Error('always-fail');
  }
}

class ServiceWithOperationName {
  @Retryable({ maxAttempts: 1, operationName: 'custom:op', baseDelayMs: 0 })
  async myMethod(): Promise<never> {
    throw new Error('fail');
  }
}

class ServiceThrowsNonRetryable {
  public callCount = 0;

  @Retryable(5)
  async call(): Promise<never> {
    this.callCount++;
    throw new RpcNonRetryableError('logic error');
  }
}

class ServiceWith4xxError {
  public callCount = 0;

  @Retryable(5)
  async call(): Promise<never> {
    this.callCount++;
    throw new Error('400 Bad Request');
  }
}

class ServiceReturnsValue {
  @Retryable(3)
  async compute(x: number): Promise<number> {
    return x * 2;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('@Retryable decorator', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // ── Shorthand: @Retryable(n) ────────────────────────────────────────────────

  describe('shorthand usage @Retryable(n)', () => {
    it('should resolve with the return value of the decorated method', async () => {
      const svc = new ServiceReturnsValue();
      await expect(svc.compute(7)).resolves.toBe(14);
    });

    it('should succeed after transient failures within the attempt budget', async () => {
      const svc = new ServiceWithShorthand();
      const promise = svc.fetchData();
      await drainTimers(promise);
      await expect(promise).resolves.toBe('result');
      expect(svc.callCount).toBe(3);
    });

    it('should throw RpcExhaustedError when all attempts are exhausted', async () => {
      class AlwaysFailService {
        @Retryable({ maxAttempts: 3, baseDelayMs: 0, jitter: 0 })
        async doThing(): Promise<never> {
          throw new Error('never succeeds');
        }
      }
      const svc = new AlwaysFailService();
      const promise = svc.doThing();
      await drainTimers(promise);
      await expect(promise).rejects.toBeInstanceOf(RpcExhaustedError);
    });

    it('should forward all arguments to the original method', async () => {
      const svc = new ServiceReturnsValue();
      await expect(svc.compute(5)).resolves.toBe(10);
    });

    it('should preserve the method name on the wrapped descriptor', () => {
      const svc = new ServiceReturnsValue();
      expect(svc.compute.name).toBe('compute');
    });
  });

  // ── Full config: @Retryable({ ... }) ───────────────────────────────────────

  describe('full config usage @Retryable(options)', () => {
    it('should respect maxAttempts from options', async () => {
      const svc = new ServiceWithOptions();
      const promise = svc.alwaysFails();
      await drainTimers(promise);
      await expect(promise).rejects.toBeInstanceOf(RpcExhaustedError);
      expect(svc.callCount).toBe(2); // maxAttempts: 2
    });

    it('should use the custom operationName in the exhausted error', async () => {
      const svc = new ServiceWithOperationName();
      await expect(svc.myMethod()).rejects.toMatchObject({
        operation: 'custom:op',
      });
    });
  });

  // ── Default operationName ──────────────────────────────────────────────────

  describe('default operationName', () => {
    it('should default operationName to "ClassName.methodName"', async () => {
      class MyService {
        @Retryable({ maxAttempts: 1, baseDelayMs: 0 })
        async doWork(): Promise<never> {
          throw new Error('fail');
        }
      }
      const svc = new MyService();
      await expect(svc.doWork()).rejects.toMatchObject({
        operation: 'MyService.doWork',
      });
    });
  });

  // ── Integration with defaultSorobanIsRetryable ─────────────────────────────

  describe('defaultSorobanIsRetryable wiring', () => {
    it('should stop immediately on RpcNonRetryableError (single attempt)', async () => {
      const svc = new ServiceThrowsNonRetryable();
      await expect(svc.call()).rejects.toBeInstanceOf(RpcNonRetryableError);
      expect(svc.callCount).toBe(1);
    });

    it('should stop retrying on a 400 Bad Request (non-retryable 4xx)', async () => {
      const svc = new ServiceWith4xxError();
      const promise = svc.call();
      await drainTimers(promise);
      await expect(promise).rejects.toBeInstanceOf(RpcNonRetryableError);
      expect(svc.callCount).toBe(1);
    });
  });

  // ── Method context (`this`) ────────────────────────────────────────────────

  describe('method context binding', () => {
    it('should preserve the correct `this` context inside the decorated method', async () => {
      class ContextService {
        public value = 42;

        @Retryable(1)
        async getValue(): Promise<number> {
          return this.value;
        }
      }
      const svc = new ContextService();
      await expect(svc.getValue()).resolves.toBe(42);
    });

    it('should work when the method is called on a subclass instance', async () => {
      class Base {
        @Retryable(1)
        async greet(): Promise<string> {
          return 'hello';
        }
      }
      class Child extends Base {}
      const child = new Child();
      await expect(child.greet()).resolves.toBe('hello');
    });
  });
});
