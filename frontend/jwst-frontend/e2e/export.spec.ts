import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  openImageViewer,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('Image Export Feature', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'export', fileCount: 1 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);
  });

  async function openViewerOrSkip(page: import('@playwright/test').Page) {
    const opened = await openImageViewer(page);
    if (!opened) {
      test.skip(true, 'No viewable data available for testing export');
    }
  }

  test.describe('Export Options Panel', () => {
    test('should open export options panel when export button is clicked', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await expect(exportButton).toBeVisible();
      await exportButton.click();

      await expect(page.locator('.export-options-panel')).toBeVisible();
      await expect(page.locator('.export-options-title')).toHaveText('Export Image');
    });

    test('should show format selection with PNG and JPEG options', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      const pngButton = page.locator('.export-format-btn:has-text("PNG")');
      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');

      await expect(pngButton).toBeVisible();
      await expect(jpegButton).toBeVisible();
      await expect(pngButton).toHaveClass(/active/);
    });

    test('should show quality slider only when JPEG is selected', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      const qualitySlider = page.locator('.export-slider');
      await expect(qualitySlider).not.toBeVisible();

      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');
      await jpegButton.click();
      await expect(qualitySlider).toBeVisible();

      const pngButton = page.locator('.export-format-btn:has-text("PNG")');
      await pngButton.click();
      await expect(qualitySlider).not.toBeVisible();
    });

    test('should show resolution presets dropdown', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      const resolutionSelect = page.locator('.export-select');
      await expect(resolutionSelect).toBeVisible();

      await expect(resolutionSelect.locator('option[value="standard"]')).toHaveText(
        'Standard (1200px)'
      );
      await expect(resolutionSelect.locator('option[value="high"]')).toHaveText('High (2048px)');
      await expect(resolutionSelect.locator('option[value="maximum"]')).toHaveText(
        'Maximum (4096px)'
      );
      await expect(resolutionSelect.locator('option[value="custom"]')).toHaveText('Custom');
    });

    test('should show custom dimension inputs when Custom resolution is selected', async ({
      page,
    }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      const dimensionInputs = page.locator('.export-dimension-inputs');
      await expect(dimensionInputs).not.toBeVisible();

      const resolutionSelect = page.locator('.export-select');
      await resolutionSelect.selectOption('custom');

      await expect(dimensionInputs).toBeVisible();

      const widthInput = page.locator('.export-dimension-input').first();
      const heightInput = page.locator('.export-dimension-input').last();

      await expect(widthInput).toBeVisible();
      await expect(heightInput).toBeVisible();
      await expect(widthInput).toHaveValue('1200');
      await expect(heightInput).toHaveValue('1200');
    });

    test('should close export panel when close button is clicked', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      const panel = page.locator('.export-options-panel');
      await expect(panel).toBeVisible();

      const closeButton = page.locator('.export-close-btn');
      await closeButton.click();
      await expect(panel).not.toBeVisible();
    });

    test('should have export button with correct format label', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      const primaryButton = page.locator('.export-btn-primary');
      await expect(primaryButton).toContainText('Export PNG');

      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');
      await jpegButton.click();
      await expect(primaryButton).toContainText('Export JPEG');
    });
  });

  test.describe('Export Download', () => {
    test('should trigger PNG export with correct parameters', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportIconButton = page.locator('.export-button-container button.btn-icon');
      await exportIconButton.click();

      let exportRequestUrl = '';
      page.on('request', (request) => {
        if (request.url().includes('/preview') && request.url().includes('format=png')) {
          exportRequestUrl = request.url();
        }
      });

      const primaryButton = page.locator('.export-btn-primary');
      await primaryButton.click();
      await page.waitForTimeout(2000);

      expect(exportRequestUrl).toContain('format=png');
      expect(exportRequestUrl).toContain('width=1200');
      expect(exportRequestUrl).toContain('height=1200');
    });

    test('should trigger JPEG export with quality parameter', async ({ page }) => {
      await openViewerOrSkip(page);

      const exportIconButton = page.locator('.export-button-container button.btn-icon');
      await exportIconButton.click();

      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');
      await jpegButton.click();

      const qualitySlider = page.locator('.export-slider');
      await qualitySlider.fill('50');

      let exportRequestUrl = '';
      page.on('request', (request) => {
        if (request.url().includes('/preview') && request.url().includes('format=jpeg')) {
          exportRequestUrl = request.url();
        }
      });

      const primaryButton = page.locator('.export-btn-primary');
      await primaryButton.click();
      await page.waitForTimeout(2000);

      expect(exportRequestUrl).toContain('format=jpeg');
      expect(exportRequestUrl).toContain('quality=50');
    });
  });
});
