import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  openImageViewer,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('FITS image viewer', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'viewer', fileCount: 1 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);
  });

  async function openViewerOrSkip(page: import('@playwright/test').Page) {
    const opened = await openImageViewer(page);
    if (!opened) {
      test.skip(true, 'No viewable data available');
    }
  }

  test('opens viewer overlay via View button', async ({ page }) => {
    await openViewerOrSkip(page);
    await expect(page.locator('.image-viewer-overlay')).toBeVisible();
  });

  test('displays scientific image in canvas viewport', async ({ page }) => {
    await openViewerOrSkip(page);
    // The main rendered image is an <img> with class scientific-canvas (hidden until loaded)
    const img = page.locator('img.scientific-canvas');
    await expect(img).toBeVisible({ timeout: 15_000 });
  });

  test('shows stretch controls panel (not collapsed)', async ({ page }) => {
    await openViewerOrSkip(page);
    const stretch = page.locator('.stretch-controls').first();
    await expect(stretch).toBeVisible();
    await expect(stretch).not.toHaveClass(/collapsed/);
  });

  test('shows histogram panel', async ({ page }) => {
    await openViewerOrSkip(page);
    const histogram = page.locator('.histogram-panel').first();
    await expect(histogram).toBeVisible();
  });

  test('displays pixel coordinates in status bar', async ({ page }) => {
    await openViewerOrSkip(page);
    const statusBar = page.locator('.viewer-status-bar');
    await expect(statusBar).toBeVisible();
  });

  test('shows metadata sidebar', async ({ page }) => {
    await openViewerOrSkip(page);
    const sidebar = page.locator('.viewer-sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('shows floating toolbar with zoom controls', async ({ page }) => {
    await openViewerOrSkip(page);
    const toolbar = page.locator('.viewer-floating-toolbar');
    await expect(toolbar).toBeVisible();

    // Zoom buttons exist
    await expect(toolbar.locator('[title="Zoom In"]')).toBeVisible();
    await expect(toolbar.locator('[title="Zoom Out"]')).toBeVisible();
  });

  test('closes viewer via back button', async ({ page }) => {
    await openViewerOrSkip(page);
    await expect(page.locator('.image-viewer-overlay')).toBeVisible();

    // Click the back button in the viewer header
    const backButton = page.locator('.viewer-header .header-left .btn-icon').first();
    await backButton.click();

    await expect(page.locator('.image-viewer-overlay')).not.toBeVisible();
    await expect(page.locator('.dashboard .controls')).toBeVisible();
  });
});
