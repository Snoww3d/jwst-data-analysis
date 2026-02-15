import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('Mosaic wizard', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'mosaic', fileCount: 2 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);
  });

  test('opens wizard modal via WCS Mosaic button', async ({ page }) => {
    await page.getByRole('button', { name: /WCS Mosaic/i }).click();
    await expect(page.locator('.mosaic-wizard-backdrop')).toBeVisible();
    await expect(page.locator('.mosaic-wizard-modal')).toBeVisible();
  });

  test('displays 2-step wizard stepper', async ({ page }) => {
    await page.getByRole('button', { name: /WCS Mosaic/i }).click();
    await expect(page.locator('.mosaic-wizard-modal')).toBeVisible();

    const steps = page.locator('.wizard-stepper .wizard-step');
    await expect(steps).toHaveCount(2);
    await expect(steps.first()).toHaveClass(/active/);
  });

  test('shows file selection cards on step 1', async ({ page }) => {
    await page.getByRole('button', { name: /WCS Mosaic/i }).click();
    await expect(page.locator('.mosaic-wizard-modal')).toBeVisible();

    // Wait for image cards to load
    const cards = page.locator('.mosaic-image-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('enables Next when 2+ files selected', async ({ page }) => {
    await page.getByRole('button', { name: /WCS Mosaic/i }).click();
    await expect(page.locator('.mosaic-wizard-modal')).toBeVisible();

    const cards = page.locator('.mosaic-image-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Select first two cards
    await cards.nth(0).click();
    await cards.nth(1).click();

    // Next button should be enabled
    const nextBtn = page.locator('.wizard-footer .btn-wizard.btn-primary');
    await expect(nextBtn).toBeEnabled();
  });

  test('navigates to step 2 and shows generate button', async ({ page }) => {
    await page.getByRole('button', { name: /WCS Mosaic/i }).click();
    await expect(page.locator('.mosaic-wizard-modal')).toBeVisible();

    const cards = page.locator('.mosaic-image-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Select 2 images
    await cards.nth(0).click();
    await cards.nth(1).click();

    // Go to step 2
    const nextBtn = page.locator('.wizard-footer .btn-wizard.btn-primary');
    await nextBtn.click();

    // Step 2 active
    const steps = page.locator('.wizard-stepper .wizard-step');
    await expect(steps.nth(1)).toHaveClass(/active/);

    // Generate button visible
    const generateBtn = page.locator('.btn-wizard.btn-generate');
    await expect(generateBtn).toBeVisible();
  });
});
