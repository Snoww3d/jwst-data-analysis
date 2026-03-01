import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('Composite wizard', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'comp', fileCount: 3 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);
  });

  test('navigates to /composite via Composite button', async ({ page }) => {
    await page.getByRole('button', { name: /Composite/i }).click();
    await expect(page).toHaveURL(/\/composite/);
    await expect(page.locator('.wizard-page')).toBeVisible();
  });

  test('displays 2-step wizard stepper', async ({ page }) => {
    await page.getByRole('button', { name: /Composite/i }).click();
    await expect(page.locator('.wizard-stepper')).toBeVisible({ timeout: 10_000 });

    const steps = page.locator('.wizard-stepper .wizard-step');
    await expect(steps).toHaveCount(2);
    // First step should be active
    await expect(steps.first()).toHaveClass(/active/);
  });

  test('shows channel lanes on step 1', async ({ page }) => {
    await page.getByRole('button', { name: /Composite/i }).click();
    await expect(page.locator('.channel-lanes')).toBeVisible({ timeout: 10_000 });

    // Should have at least the default channel lanes (RGB preset starts with 3)
    const lanes = page.locator('.channel-lane');
    expect(await lanes.count()).toBeGreaterThanOrEqual(1);
  });

  test('shows image pool with available images', async ({ page }) => {
    await page.getByRole('button', { name: /Composite/i }).click();
    await expect(page.locator('.wizard-page')).toBeVisible();

    await expect(page.locator('.image-pool')).toBeVisible();
    // We uploaded 3 images — pool should show some cards
    const poolCards = page.locator('.image-pool .dnd-image-card');
    expect(await poolCards.count()).toBeGreaterThanOrEqual(1);
  });

  test('navigates between steps (forward and back)', async ({ page }) => {
    await page.getByRole('button', { name: /Composite/i }).click();
    await expect(page.locator('.wizard-stepper')).toBeVisible({ timeout: 10_000 });

    // Next should be disabled without images assigned
    const nextBtn = page.locator('.wizard-footer .btn-wizard.btn-primary');
    await expect(nextBtn).toBeDisabled();

    // Drag an image from the pool into the first channel lane
    const poolCard = page.locator('.image-pool .dnd-image-card').first();
    await expect(poolCard).toBeVisible({ timeout: 10_000 });
    const channelLane = page.locator('.channel-lane').first();
    await poolCard.dragTo(channelLane);

    // Next should now be enabled
    await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
    await nextBtn.click();

    // Step 2 should be active
    const steps = page.locator('.wizard-stepper .wizard-step');
    await expect(steps.nth(1)).toHaveClass(/active/);

    // Click Back to return to step 1
    const backBtn = page.locator('.wizard-footer .btn-wizard.btn-secondary');
    await backBtn.click();
    await expect(steps.first()).toHaveClass(/active/);
  });

  test('closes wizard via close button and navigates back', async ({ page }) => {
    await page.getByRole('button', { name: /Composite/i }).click();
    await expect(page.locator('.wizard-page')).toBeVisible();

    await page.locator('.wizard-page-container .btn-close').click();
    await expect(page).toHaveURL(/\/library/);
  });
});
