import { test, expect } from '@playwright/test';
import { stubNetwork } from './fixtures';

/**
 * Staking surface and multi-chain behaviour (FE-042).
 *
 * A headless browser has no injected wallet, so these assert the
 * *pre-connection* contract: the staking affordances are reachable, the chain
 * selector works, and nothing crashes or hangs when a wallet is absent. That
 * last part is the case real users hit first and the one most likely to
 * regress silently.
 */

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

async function openFirstCall(page: import('@playwright/test').Page) {
  await page.goto('/feed');
  await page.getByTestId('call-card').first().click();
  await expect(page).toHaveURL(/\/calls\//);
  await expect(page.getByText('Market Detail')).toBeVisible();
}

test.describe('staking surface', () => {
  test('offers both sides of the market', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    await openFirstCall(page);

    // The staking panel lives in the scrollable sidebar, so bring it into
    // view rather than asserting on whatever happens to be above the fold.
    const back = page.getByText('Back this Call');
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeVisible();
    await expect(page.getByText('Challenge').first()).toBeVisible();
  });

  test('shows the pool totals a staker needs before committing', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    await openFirstCall(page);

    const poolBar = page.getByTestId('pool-bar');
    await expect(poolBar).toBeVisible();
    // A pool rendered as a skeleton tells the user nothing about the odds.
    await expect(page.getByTestId('pool-bar-skeleton')).toHaveCount(0);
  });

  test('stays responsive when staking is attempted without a wallet', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    const crashes: string[] = [];
    page.on('pageerror', (e) => crashes.push(e.message));

    await openFirstCall(page);
    const back = page.getByText('Back this Call');
    await back.scrollIntoViewIfNeeded();
    await back.click();

    // Whatever the app chooses to do here, it must not throw and must leave
    // the page interactive.
    expect(crashes).toEqual([]);
    await expect(page.getByTestId('pool-bar')).toBeVisible();
  });
});

test.describe('multi-chain', () => {
  test('exposes the chain selector', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    await page.goto('/feed');
    await expect(page.getByTestId('chain-selector').first()).toBeVisible();
  });

  test('keeps the feed usable after switching chain', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    await page.goto('/feed');
    await expect(page.getByTestId('call-card').first()).toBeVisible();

    await page.getByTestId('chain-selector').first().click();

    // The feed must still render rather than blanking on the chain change.
    await expect(page.getByTestId('feed-list')).toBeVisible();
  });
});

test.describe('responsive layout', () => {
  test('renders the feed without horizontal overflow', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByTestId('feed-list')).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('renders the call detail without horizontal overflow', async ({ page }) => {
    await openFirstCall(page);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('keeps primary navigation reachable', async ({ page }) => {
    await page.goto('/feed');
    // Nav collapses at small widths, so assert on the link rather than a
    // particular chrome treatment.
    await expect(page.getByRole('link', { name: 'Explore' }).first()).toBeVisible();
  });
});

test.describe('error handling', () => {
  test('surfaces an empty feed rather than a spinner when the API returns nothing', async ({
    page,
  }) => {
    await page.route(
      (url) => url.host === '127.0.0.1:3001' && url.pathname.startsWith('/feed'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]',
        }),
    );

    await page.goto('/feed');
    await expect(page.getByTestId('feed-empty')).toBeVisible();
  });

  test('does not hang when the feed API fails', async ({ page }) => {
    await page.route(
      (url) => url.host === '127.0.0.1:3001' && url.pathname.startsWith('/feed'),
      (route) => route.fulfill({ status: 500, body: 'upstream error' }),
    );

    await page.goto('/feed');
    // A failed fetch must resolve to the empty state, not an endless skeleton.
    await expect(page.getByTestId('feed-empty')).toBeVisible();
  });
});
