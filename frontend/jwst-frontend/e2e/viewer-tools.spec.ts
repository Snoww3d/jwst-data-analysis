import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  openImageViewer,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('Viewer tools: regions, annotations, WCS grid, curves', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'tools', fileCount: 1 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);

    const opened = await openImageViewer(page);
    if (!opened) {
      test.skip(true, 'No viewable data available');
    }
  });

  test('shows rectangle and ellipse region tool buttons', async ({ page }) => {
    const headerRight = page.locator('.header-right');
    await expect(headerRight.locator('[title="Rectangle Region"]')).toBeVisible();
    await expect(headerRight.locator('[title="Ellipse Region"]')).toBeVisible();
  });

  test('toggles region mode on and off', async ({ page }) => {
    const rectBtn = page.locator('.header-right [title="Rectangle Region"]');
    await rectBtn.click();
    await expect(rectBtn).toHaveClass(/active/);

    await rectBtn.click();
    await expect(rectBtn).not.toHaveClass(/active/);
  });

  test('shows annotation tool buttons', async ({ page }) => {
    const headerRight = page.locator('.header-right');
    await expect(headerRight.locator('[title="Text Label"]')).toBeVisible();
    await expect(headerRight.locator('[title="Arrow"]')).toBeVisible();
    await expect(headerRight.locator('[title="Circle / Ellipse"]')).toBeVisible();
  });

  test('activates text annotation mode', async ({ page }) => {
    const textBtn = page.locator('.header-right [title="Text Label"]');
    await textBtn.click();
    await expect(textBtn).toHaveClass(/active/);
  });

  test('toggles annotation mode off', async ({ page }) => {
    const textBtn = page.locator('.header-right [title="Text Label"]');
    await textBtn.click();
    await expect(textBtn).toHaveClass(/active/);

    await textBtn.click();
    await expect(textBtn).not.toHaveClass(/active/);
  });

  test('toggles WCS grid (skip if unavailable)', async ({ page }) => {
    const wcsBtn = page.locator('.viewer-floating-toolbar [title="Toggle WCS Grid"]');

    if ((await wcsBtn.count()) === 0) {
      // WCS not available for this image — check the disabled variant exists instead
      const disabledBtn = page.locator('.viewer-floating-toolbar [title="WCS not available"]');
      await expect(disabledBtn).toBeVisible();
      return;
    }

    await wcsBtn.click();
    await expect(wcsBtn).toHaveClass(/active/);

    await wcsBtn.click();
    await expect(wcsBtn).not.toHaveClass(/active/);
  });

  test('shows curves editor panel', async ({ page }) => {
    const curvesPanel = page.locator('.curves-editor');
    await expect(curvesPanel).toBeVisible();
  });

  test('shows curve presets', async ({ page }) => {
    // Ensure curves editor is expanded (click header if collapsed)
    const curvesPanel = page.locator('.curves-editor');
    if (await curvesPanel.evaluate((el) => el.classList.contains('collapsed'))) {
      await page.locator('.curves-editor-header').click();
    }

    const presets = page.locator('.curves-presets .curves-preset-btn');
    await expect(presets.first()).toBeVisible();
    // Should have multiple presets
    expect(await presets.count()).toBeGreaterThanOrEqual(3);
  });
});
