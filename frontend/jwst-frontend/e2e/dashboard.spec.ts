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

  test('shows Search MAST link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Search MAST/i })).toBeVisible();
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

  test('Search MAST link navigates to /archive', async ({ page }) => {
    await page.getByRole('link', { name: /Search MAST/i }).click();
    await expect(page).toHaveURL(/\/archive/);
    await expect(page.locator('.mast-search')).toBeVisible();
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

  test('Composite button navigates to /composite', async ({ page }) => {
    const compositeBtn = page.getByRole('button', { name: /Composite/i }).first();
    await expect(compositeBtn).toBeVisible();
    await expect(compositeBtn).toBeEnabled();
    await compositeBtn.click();
    await expect(page).toHaveURL(/\/composite/);
  });

  test('WCS Mosaic button navigates to /mosaic', async ({ page }) => {
    await page.getByRole('button', { name: /WCS Mosaic/i }).click();
    await expect(page).toHaveURL(/\/mosaic/);
  });
});
