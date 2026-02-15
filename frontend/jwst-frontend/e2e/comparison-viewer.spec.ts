import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('Comparison viewer', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'compare', fileCount: 2 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);
  });

  test('opens comparison image picker via Compare button', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();
    await expect(page.locator('.comparison-picker-overlay')).toBeVisible();
    await expect(page.locator('.comparison-picker-modal')).toBeVisible();
    await expect(page.locator('.comparison-picker-modal h2')).toHaveText(
      'Select Images to Compare'
    );
  });

  test('shows two image selection columns', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();
    await expect(page.locator('.comparison-picker-modal')).toBeVisible();

    const columns = page.locator('.comparison-picker-column');
    await expect(columns).toHaveCount(2);
    await expect(columns.first().locator('h3')).toHaveText('Image A');
    await expect(columns.last().locator('h3')).toHaveText('Image B');
  });

  test('shows selectable image items in picker', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();
    await expect(page.locator('.comparison-picker-modal')).toBeVisible();

    const items = page.locator('.comparison-picker-item');
    expect(await items.count()).toBeGreaterThanOrEqual(2);
  });

  test('selects images and enables Compare button', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();
    await expect(page.locator('.comparison-picker-modal')).toBeVisible();

    // Compare button should be disabled initially
    const compareBtn = page.locator('.comparison-picker-btn.primary');
    await expect(compareBtn).toBeDisabled();

    // Select first item in column A (first column)
    const columnA = page.locator('.comparison-picker-column').first();
    const columnB = page.locator('.comparison-picker-column').last();
    await columnA.locator('.comparison-picker-item').first().click();

    // Select first non-disabled item in column B
    const itemsB = columnB.locator('.comparison-picker-item:not(.disabled)');
    await itemsB.first().click();

    // Compare button should be enabled
    await expect(compareBtn).toBeEnabled();
  });

  test('launches comparison viewer overlay', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();
    await expect(page.locator('.comparison-picker-modal')).toBeVisible();

    // Select images
    const columnA = page.locator('.comparison-picker-column').first();
    const columnB = page.locator('.comparison-picker-column').last();
    await columnA.locator('.comparison-picker-item').first().click();
    const itemsB = columnB.locator('.comparison-picker-item:not(.disabled)');
    await itemsB.first().click();

    // Click Compare
    await page.locator('.comparison-picker-btn.primary').click();

    // Viewer overlay should appear
    await expect(page.locator('.comparison-viewer-overlay')).toBeVisible({ timeout: 10_000 });
  });

  test('defaults to blink mode with mode buttons', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();

    const columnA = page.locator('.comparison-picker-column').first();
    const columnB = page.locator('.comparison-picker-column').last();
    await columnA.locator('.comparison-picker-item').first().click();
    const itemsB = columnB.locator('.comparison-picker-item:not(.disabled)');
    await itemsB.first().click();
    await page.locator('.comparison-picker-btn.primary').click();

    await expect(page.locator('.comparison-viewer-overlay')).toBeVisible({ timeout: 10_000 });

    // Mode buttons should be visible
    const modeButtons = page.locator('.comparison-mode-btn');
    expect(await modeButtons.count()).toBe(3);

    // Blink should be active by default
    const blinkBtn = page.locator('.comparison-mode-btn').filter({ hasText: 'Blink' });
    await expect(blinkBtn).toHaveClass(/active/);
  });

  test('closes comparison viewer', async ({ page }) => {
    await page.getByRole('button', { name: /Compare/i }).click();

    const columnA = page.locator('.comparison-picker-column').first();
    const columnB = page.locator('.comparison-picker-column').last();
    await columnA.locator('.comparison-picker-item').first().click();
    const itemsB = columnB.locator('.comparison-picker-item:not(.disabled)');
    await itemsB.first().click();
    await page.locator('.comparison-picker-btn.primary').click();

    await expect(page.locator('.comparison-viewer-overlay')).toBeVisible({ timeout: 10_000 });

    // Close the viewer (back button in header)
    const closeBtn = page.locator('.comparison-header .btn-icon').first();
    await closeBtn.click();

    await expect(page.locator('.comparison-viewer-overlay')).not.toBeVisible();
  });
});
