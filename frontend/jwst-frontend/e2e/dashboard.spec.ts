import { test, expect } from '@playwright/test';
import { apiRegisterUser, loginWithTokens, ApiAuthResult } from './helpers';

let auth: ApiAuthResult;

test.describe('Dashboard controls and panels', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'dash');
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, auth);
  });

  test('shows Upload button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Upload Data' })).toBeVisible();
  });

  test('shows Search MAST toggle', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /(Search MAST|Hide MAST Search)/i })
    ).toBeVisible();
  });

  test('shows What\'s New toggle', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /(What's New|Hide What's New)/i })
    ).toBeVisible();
  });

  test('shows Lineage / By Target view toggles', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Lineage/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /By Target/i })).toBeVisible();
  });

  test('shows archive toggle', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /(Show Archived|Show Active)/i })
    ).toBeVisible();
  });

  test('opens MAST search panel', async ({ page }) => {
    const mastBtn = page.getByRole('button', { name: /(Search MAST|Hide MAST Search)/i });
    await mastBtn.click();
    await expect(page.locator('.mast-search')).toBeVisible();
  });

  test('shows search type radio buttons in MAST panel', async ({ page }) => {
    const mastBtn = page.getByRole('button', { name: /(Search MAST|Hide MAST Search)/i });
    await mastBtn.click();
    await expect(page.locator('.mast-search')).toBeVisible();
    await expect(page.locator('.search-type-selector')).toBeVisible();
    await expect(page.locator('.search-type-selector label')).toHaveCount(4);
  });

  test('shows search button in MAST panel', async ({ page }) => {
    const mastBtn = page.getByRole('button', { name: /(Search MAST|Hide MAST Search)/i });
    await mastBtn.click();
    await expect(page.locator('.search-button')).toBeVisible();
  });

  test('opens upload modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload Data' }).click();
    await expect(page.locator('.upload-modal')).toBeVisible();
    await expect(page.locator('.upload-content h3')).toHaveText('Upload JWST Data');
  });

  test('shows file input, data type, and submit in upload modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload Data' }).click();
    await expect(page.locator('.upload-modal')).toBeVisible();

    await expect(page.locator('#file-upload')).toBeAttached();
    await expect(page.locator('#data-type-select')).toBeVisible();
    await expect(page.locator('.form-actions button[type="submit"]')).toBeVisible();
    await expect(page.locator('.form-actions button[type="submit"]')).toHaveText('Upload');
  });
});
