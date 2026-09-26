import { test, expect } from '@playwright/test';
import { stubNetwork } from './fixtures';

/**
 * Call lifecycle: feed → call detail → live pool (FE-042).
 *
 * Every wait here is an assertion on observable state. No arbitrary sleeps —
 * they are the reason E2E suites become both slow and flaky.
 */

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

test.describe('feed', () => {
  test('renders a list of calls', async ({ page }) => {
    await page.goto('/feed');

    const feed = page.getByTestId('feed-list');
    await expect(feed).toBeVisible();

    // At least one card resolves; the skeleton must be gone by then.
    await expect(page.getByTestId('call-card').first()).toBeVisible();
    await expect(page.getByTestId('feed-skeleton')).toHaveCount(0);
  });

  test('exposes feed tabs for switching views', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByTestId('feed-tabs')).toBeVisible();
  });

  test('has no horizontal overflow at this viewport', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByTestId('feed-list')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A couple of pixels of rounding is tolerable; a scrollbar is not.
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

test.describe('call detail', () => {
  test('opens a call from the feed and shows its header', async ({ page }) => {
    await page.goto('/feed');

    const firstCard = page.getByTestId('call-card').first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    await expect(page).toHaveURL(/\/calls\//);
    // The detail view is up once the market heading renders; the not-found
    // branch is what a broken id would produce instead.
    await expect(page.getByText('Market Detail')).toBeVisible();
    await expect(page.getByText(/call not found/i)).toHaveCount(0);
  });

  test('streams the live pool split', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    await page.goto('/feed');
    await page.getByTestId('call-card').first().click();
    await expect(page).toHaveURL(/\/calls\//);

    await expect(page.getByTestId('pool-bar')).toBeVisible();
    await expect(page.getByTestId('pool-bar-skeleton')).toHaveCount(0);

    // The socket is connected, so the live badge is showing.
    await expect(page.getByTestId('live-indicator')).toBeVisible();
  });

  test('lists participants once the socket delivers them', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'sidebar surfaces are desktop-only (hidden lg:block in AppLayout)',
    );
    await page.goto('/feed');
    await page.getByTestId('call-card').first().click();

    // Either populated or an explicit empty state — never a stuck skeleton.
    const list = page.getByTestId('participant-list');
    const empty = page.getByTestId('participant-empty');
    await expect(list.or(empty)).toBeVisible();
    await expect(page.getByTestId('participant-skeleton')).toHaveCount(0);
  });
});

test.describe('error handling', () => {
  test('shows a not-found state for an unknown call rather than hanging', async ({
    page,
  }) => {
    await page.goto('/calls/does-not-exist');
    await expect(page.getByText(/call not found/i)).toBeVisible();
  });
});
