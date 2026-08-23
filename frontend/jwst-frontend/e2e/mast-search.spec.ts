import { test, expect } from '@playwright/test';

test.describe('MAST search panel', () => {
  test.beforeEach(async ({ page }) => {
    // MAST search lives on the public /search page — no login needed for search-only flows
    await page.goto('/search');
    await expect(page.locator('.mast-search')).toBeVisible({ timeout: 10_000 });
  });

  test('renders search page heading with MAST search panel', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await expect(page.locator('.mast-search')).toBeVisible();
  });

  test('one smart input, no mode radios (MAST Search v2 Phase 2)', async ({ page }) => {
    await expect(page.locator('input.smart-search-input')).toBeVisible();
    await expect(page.locator('.search-type-selector')).toHaveCount(0);
  });

  test('interprets each Discover chip as the user types', async ({ page }) => {
    const input = page.locator('input.smart-search-input');
    const hint = page.locator('.smart-search-hint');
    const radius = page.getByLabel('Search radius (degrees)');

    await input.fill('NGC 3324');
    await expect(hint).toHaveText('Interpreted as: target name "NGC 3324"');
    await expect(radius).toBeVisible();

    await input.fill('10h 37m -58°');
    await expect(hint).toHaveText('Interpreted as: coordinates 159.25°, −58.00°');
    await expect(radius).toBeVisible();

    await input.fill('PID 2739');
    await expect(hint).toHaveText('Interpreted as: program 2739');
    await expect(radius).toBeHidden();

    await input.fill('jw02739-o001');
    await expect(hint).toHaveText('Interpreted as: observation ID jw02739-o001');
    await expect(radius).toBeHidden();
  });

  test('submitting pushes ?q= to the URL and Back restores it', async ({ page }) => {
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' })
    );
    const input = page.locator('input.smart-search-input');
    await input.fill('M16');
    await page.locator('.search-button').click();
    await expect(page).toHaveURL(/\/search\?q=M16$/);

    await input.fill('NGC 3324');
    await page.locator('.search-button').click();
    await expect(page).toHaveURL(/q=NGC\+3324/);

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=M16$/);
    await expect(input).toHaveValue('M16');
  });

  test('opening /search?q= runs the search and lists it under Recent', async ({ page }) => {
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' })
    );
    await page.goto('/search?q=PID+2739');
    await expect(page.locator('input.smart-search-input')).toHaveValue('PID 2739');
    await expect(page.locator('.smart-search-recent-chip', { hasText: 'PID 2739' })).toBeVisible();
  });

  test('search button is visible and enabled', async ({ page }) => {
    const searchBtn = page.locator('.search-button');
    await expect(searchBtn).toBeVisible();
    await expect(searchBtn).toBeEnabled();
  });
});
