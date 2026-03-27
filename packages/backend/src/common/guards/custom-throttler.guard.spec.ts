/**
 * custom-throttler.guard.spec.ts
 *
 * Tests for CustomThrottlerGuard:
 *   - generateKey  → throttle key construction from context
 *   - getTracker   → tracker string fallback chain
 *
 * Both methods share the same priority chain:
 *   req.user.id  >  req.user.wallet  >  x-user-wallet header  >  req.ip
 */

import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './custom-throttler.guard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal mock ExecutionContext whose HTTP request can be customised. */
function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

/**
 * Instantiate CustomThrottlerGuard without a real NestJS module.
 * We supply the minimum constructor arguments required by ThrottlerGuard.
 */
function buildGuard(): CustomThrottlerGuard {
  const options: ThrottlerModuleOptions = {
    throttlers: [{ name: 'default', ttl: 60_000, limit: 10 }],
  };
  const storage: ThrottlerStorage = {
    increment: jest.fn(),
    getRecord: jest.fn().mockResolvedValue([]),
  } as unknown as ThrottlerStorage;

  return new CustomThrottlerGuard(options, storage, null as any);
}

// ─── generateKey ──────────────────────────────────────────────────────────────

describe('CustomThrottlerGuard.generateKey', () => {
  let guard: CustomThrottlerGuard;

  beforeEach(() => {
    guard = buildGuard();
  });

  it('should prefer req.user.id as the tracker', () => {
    const ctx = buildContext({
      user: { id: 'user-123', wallet: '0xWallet' },
      headers: { 'x-user-wallet': '0xHeader' },
      ip: '1.2.3.4',
    });
    const key = (guard as any).generateKey(ctx, 'tracker', 'throttlerName');
    expect(key).toBe('throttlerName:user-123');
  });

  it('should fall back to req.user.wallet when id is absent', () => {
    const ctx = buildContext({
      user: { wallet: '0xWallet' },
      headers: { 'x-user-wallet': '0xHeader' },
      ip: '1.2.3.4',
    });
    const key = (guard as any).generateKey(ctx, 'tracker', 'throttlerName');
    expect(key).toBe('throttlerName:0xWallet');
  });

  it('should fall back to x-user-wallet header when user is absent', () => {
    const ctx = buildContext({
      headers: { 'x-user-wallet': '0xHeaderWallet' },
      ip: '1.2.3.4',
    });
    const key = (guard as any).generateKey(ctx, 'tracker', 'throttlerName');
    expect(key).toBe('throttlerName:0xHeaderWallet');
  });

  it('should fall back to req.ip when no user or wallet header is present', () => {
    const ctx = buildContext({ headers: {}, ip: '5.6.7.8' });
    const key = (guard as any).generateKey(ctx, 'tracker', 'throttlerName');
    expect(key).toBe('throttlerName:5.6.7.8');
  });

  it('should use the throttlerName as the key prefix', () => {
    const ctx = buildContext({ headers: {}, ip: '9.9.9.9' });
    const key = (guard as any).generateKey(ctx, 'tracker', 'short');
    expect(key).toMatch(/^short:/);
  });

  it('should ignore user.wallet when user.id is present', () => {
    const ctx = buildContext({
      user: { id: 'id-wins', wallet: '0xShouldNotBeUsed' },
      headers: {},
      ip: '0.0.0.0',
    });
    const key = (guard as any).generateKey(ctx, 'tracker', 'throttler');
    expect(key).not.toContain('0xShouldNotBeUsed');
    expect(key).toContain('id-wins');
  });

  it('should not include the tracker string in the key value', () => {
    // The `trackerString` param passed to generateKey is ignored in favour of the
    // request-derived tracker — the key must be `${throttlerName}:${tracker}`.
    const ctx = buildContext({ headers: {}, ip: '1.1.1.1' });
    const key = (guard as any).generateKey(ctx, 'ignored-tracker-string', 'myThrottler');
    expect(key).not.toContain('ignored-tracker-string');
    expect(key).toBe('myThrottler:1.1.1.1');
  });
});

// ─── getTracker ───────────────────────────────────────────────────────────────

describe('CustomThrottlerGuard.getTracker', () => {
  let guard: CustomThrottlerGuard;

  beforeEach(() => {
    guard = buildGuard();
  });

  it('should return req.user.id when present', async () => {
    const req = { user: { id: 'uid-1', wallet: '0xW' }, headers: { 'x-user-wallet': '0xH' }, ip: '0.0.0.1' };
    await expect((guard as any).getTracker(req)).resolves.toBe('uid-1');
  });

  it('should return req.user.wallet when id is absent', async () => {
    const req = { user: { wallet: '0xWallet' }, headers: { 'x-user-wallet': '0xH' }, ip: '0.0.0.2' };
    await expect((guard as any).getTracker(req)).resolves.toBe('0xWallet');
  });

  it('should return the x-user-wallet header when user is absent', async () => {
    const req = { headers: { 'x-user-wallet': '0xHeaderWallet' }, ip: '0.0.0.3' };
    await expect((guard as any).getTracker(req)).resolves.toBe('0xHeaderWallet');
  });

  it('should return req.ip as the final fallback', async () => {
    const req = { headers: {}, ip: '192.168.1.1' };
    await expect((guard as any).getTracker(req)).resolves.toBe('192.168.1.1');
  });

  it('should return undefined (falsy) when no identifier is available', async () => {
    const req = { headers: {} };
    const result = await (guard as any).getTracker(req);
    expect(result).toBeFalsy();
  });

  it('should resolve to a string (not a promise object)', async () => {
    const req = { headers: {}, ip: '10.0.0.1' };
    const result = await (guard as any).getTracker(req);
    expect(typeof result).toBe('string');
  });
});
