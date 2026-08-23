import { test, expect } from '@playwright/test';

/**
 * /archive was the MAST search route until it took the nav "Search" slot
 * (MAST Search v2, Phase 1). Old links must keep working and carry their
 * query string so deep links survive.
 */
test.describe('/archive → /search redirect', () => {
  test('redirects a bare /archive to /search', async ({ page }) => {
    await page.goto('/archive');
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.locator('.mast-search')).toBeVisible({ timeout: 10_000 });
  });

  test('preserves the query string', async ({ page }) => {
    await page.goto('/archive?q=x');
    await expect(page).toHaveURL(/\/search\?q=x$/);
    await expect(page.locator('.mast-search')).toBeVisible({ timeout: 10_000 });
  });

  test('replaces history so Back does not bounce through /archive', async ({ page }) => {
    await page.goto('/');
    await page.goto('/archive?q=x');
    await expect(page).toHaveURL(/\/search\?q=x$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
});
