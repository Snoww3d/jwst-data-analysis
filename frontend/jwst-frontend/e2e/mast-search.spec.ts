import { test, expect } from '@playwright/test';

test.describe('MAST search panel', () => {
  test.beforeEach(async ({ page }) => {
    // MAST search lives on the public /archive page — no login needed for search-only flows
    await page.goto('/archive');
    await expect(page.locator('.mast-search')).toBeVisible({ timeout: 10_000 });
  });

  test('renders archive page heading with MAST search panel', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Archive search/i })).toBeVisible();
    await expect(page.locator('.mast-search')).toBeVisible();
  });

  test('defaults to target name search type', async ({ page }) => {
    const selectedLabel = page.locator('.search-type-selector label.selected');
    await expect(selectedLabel).toContainText('Target Name');
  });

  test('switches between search types', async ({ page }) => {
    // Click on "Coordinates" radio
    const coordLabel = page.locator('.search-type-selector label').filter({ hasText: 'Coordinates' });
    await coordLabel.click();
    await expect(coordLabel).toHaveClass(/selected/);

    // Click on "Observation ID"
    const obsLabel = page.locator('.search-type-selector label').filter({ hasText: 'Observation ID' });
    await obsLabel.click();
    await expect(obsLabel).toHaveClass(/selected/);
  });

  test('shows radius input for target search', async ({ page }) => {
    // Target search is default — should show radius
    await expect(page.locator('input[placeholder*="Radius"]')).toBeVisible();
  });

  test('search button is visible and enabled', async ({ page }) => {
    const searchBtn = page.locator('.search-button');
    await expect(searchBtn).toBeVisible();
    await expect(searchBtn).toBeEnabled();
  });
});
