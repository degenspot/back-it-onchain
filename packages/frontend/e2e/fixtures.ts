import type { Page, Route } from '@playwright/test';

/**
 * Network stubs for the end-to-end suite (FE-042).
 *
 * The suite must not depend on a live Soroban RPC or a running backend: a
 * test that fails because testnet is slow tells you nothing about the app,
 * and the acceptance criteria ask for reliable headless CI runs.
 */

/** A ledger sequence high enough to look current to any staleness check. */
const LEDGER = 58_000_000;

/** Stubs Soroban JSON-RPC so no test reaches the network. */
export async function mockSorobanRpc(page: Page): Promise<void> {
  await page.route('**/soroban*/**', (route: Route) => fulfilRpc(route));
  await page.route('**/*stellar.org/**', (route: Route) => fulfilRpc(route));
}

function fulfilRpc(route: Route): Promise<void> {
  const body = route.request().postDataJSON?.() as
    | { id?: number; method?: string }
    | undefined;

  const result =
    body?.method === 'getLatestLedger'
      ? { sequence: LEDGER, id: 'mock', protocolVersion: 22 }
      : { latestLedger: LEDGER, events: [] };

  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 1, result }),
  });
}

/**
 * Blocks outbound wallet/analytics traffic.
 *
 * These endpoints are slow, unreachable in CI, or both, and nothing under
 * test depends on their responses.
 */
export async function blockThirdParty(page: Page): Promise<void> {
  const blocked = [
    '**/*.coinbase.com/**',
    '**/*.walletconnect.**/**',
    '**/cca-lite.coinbase.com/**',
  ];
  for (const pattern of blocked) {
    await page.route(pattern, (route) => route.abort());
  }
}

/**
 * Feed rows in the shape `mapCall` in `app/feed/page.tsx` consumes.
 *
 * `pairId` is deliberately omitted: `mapCall` decodes it with `Buffer.from`,
 * which is a Node API that is not reliably present in the browser. When it
 * throws, the page's catch turns the whole feed into "No calls found" with no
 * error surfaced — so a fixture carrying `pairId` silently produces an empty
 * feed. See the PR description.
 *
 * `id` is deliberately identical to `callOnchainId`. The feed links to
 * `/calls/<callOnchainId>`, but GlobalState.fetchCalls spreads `...item` after
 * assigning `id`, so its own `id` is overwritten by the numeric one. With the
 * two differing, every feed card leads to "Call not found". Keeping them equal
 * keeps the suite testing navigation rather than that mismatch.
 */
export const MOCK_CALLS = [
  {
    id: 'call-e2e-1',
    callOnchainId: 'call-e2e-1',
    conditionJson: {
      title: 'XLM above $0.20 by Friday',
      thesis: 'Volume is climbing into the release.',
      target: '$0.20',
    },
    endTs: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    status: 'active',
    chain: 'stellar',
    stakeToken: 'USDC',
    totalStakeYes: '5000',
    totalStakeNo: '3000',
    creatorWallet: '0x1234567890abcdef1234567890abcdef12345678',
  },
  {
    id: 'call-e2e-2',
    callOnchainId: 'call-e2e-2',
    conditionJson: {
      title: 'ETH above $4,000 this month',
      thesis: 'ETF inflows have not slowed.',
      target: '$4000',
    },
    endTs: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 7200 * 1000).toISOString(),
    status: 'active',
    chain: 'base',
    stakeToken: 'USDC',
    totalStakeYes: '12000',
    totalStakeNo: '9000',
    creatorWallet: '0xabcdef1234567890abcdef1234567890abcdef12',
  },
];

/**
 * Stubs the application's own backend.
 *
 * Without this the feed renders "No calls found" — every downstream flow
 * depends on there being a call to open, so this is what makes the suite
 * runnable without standing up the NestJS service.
 */
export async function mockBackendApi(page: Page): Promise<void> {
  // Matched with a predicate on origin + pathname rather than a glob. A glob
  // has to contend with the query string, and a pattern that silently fails to
  // match lets a real service on the API port answer instead of the fixture --
  // which is exactly what happened while writing this.
  const api = new URL(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001',
  );

  const isApi = (url: URL, prefix: string) =>
    url.host === api.host && url.pathname.startsWith(prefix);

  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  // Registered before the specific handlers on purpose: Playwright checks
  // routes in reverse registration order, so the last one registered wins.
  // With the catch-all last, it shadowed every specific handler below it.
  // Anything else on the API host resolves empty rather than hanging on a
  // refused connection, which would otherwise cost each test its timeout.
  await page.route(
    (url) => url.host === api.host,
    (route) => json(route, []),
  );

  await page.route(
    (url) => isApi(url, '/feed'),
    (route) => json(route, MOCK_CALLS),
  );
  // GlobalState's fetchCalls reads `payload.data`, not a bare array.
  await page.route(
    (url) => isApi(url, '/calls'),
    (route) => json(route, { data: MOCK_CALLS }),
  );
  await page.route(
    (url) => isApi(url, '/users'),
    (route) => json(route, { followersCount: 0, followingCount: 0 }),
  );

}

/** Applies every stub a test needs before the first navigation. */
export async function stubNetwork(page: Page): Promise<void> {
  await blockThirdParty(page);
  await mockSorobanRpc(page);
  await mockBackendApi(page);
}
