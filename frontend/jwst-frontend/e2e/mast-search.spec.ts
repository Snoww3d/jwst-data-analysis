import { test, expect } from '@playwright/test';
import { apiRegisterUser, loginWithTokens, ApiAuthResult } from './helpers';

let auth: ApiAuthResult;

test.describe('MAST search panel', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'mast');
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, auth);

    // Open the MAST panel for every test (use specific toggle button class)
    const mastToggle = page.locator('button.mast-search-btn');
    await mastToggle.click();
    await expect(page.locator('.mast-search')).toBeVisible();
  });

  test('toggles MAST search panel open and close', async ({ page }) => {
    // Panel is already open from beforeEach — close it
    const mastToggle = page.locator('button.mast-search-btn');
    await mastToggle.click();
    await expect(page.locator('.mast-search')).not.toBeVisible();

    // Re-open
    await mastToggle.click();
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
