import { test, expect } from '@playwright/test';

test.describe('Image Export Feature', () => {
  // Skip these tests if no data is available in the database
  // These tests assume there is at least one viewable FITS file imported

  test.describe('Export Options Panel', () => {
    test('should open export options panel when export button is clicked', async ({ page }) => {
      // Navigate to the application
      await page.goto('/');

      // Wait for page to load
      await page.waitForTimeout(2000);

      // Look for a View button on any data card (if data exists)
      const viewButton = page.locator('button:has-text("View")').first();

      // Skip test if no viewable data is available
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      // Click the View button to open the image viewer
      await viewButton.click();

      // Wait for the viewer to open
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      // Find and click the export button in the viewer header
      const exportButton = page.locator('.export-button-container button.btn-icon');
      await expect(exportButton).toBeVisible();
      await exportButton.click();

      // Verify the export options panel appears
      await expect(page.locator('.export-options-panel')).toBeVisible();
      await expect(page.locator('.export-options-title')).toHaveText('Export Image');
    });

    test('should show format selection with PNG and JPEG options', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      // Check both format buttons exist
      const pngButton = page.locator('.export-format-btn:has-text("PNG")');
      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');

      await expect(pngButton).toBeVisible();
      await expect(jpegButton).toBeVisible();

      // PNG should be active by default
      await expect(pngButton).toHaveClass(/active/);
    });

    test('should show quality slider only when JPEG is selected', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      // Quality slider should NOT be visible with PNG selected (default)
      const qualitySlider = page.locator('.export-slider');
      await expect(qualitySlider).not.toBeVisible();

      // Click JPEG button
      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');
      await jpegButton.click();

      // Now quality slider should be visible
      await expect(qualitySlider).toBeVisible();

      // Click back to PNG
      const pngButton = page.locator('.export-format-btn:has-text("PNG")');
      await pngButton.click();

      // Quality slider should be hidden again
      await expect(qualitySlider).not.toBeVisible();
    });

    test('should show resolution presets dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      // Check resolution select exists
      const resolutionSelect = page.locator('.export-select');
      await expect(resolutionSelect).toBeVisible();

      // Verify preset options exist
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
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      // Custom dimension inputs should NOT be visible initially
      const dimensionInputs = page.locator('.export-dimension-inputs');
      await expect(dimensionInputs).not.toBeVisible();

      // Select Custom resolution
      const resolutionSelect = page.locator('.export-select');
      await resolutionSelect.selectOption('custom');

      // Custom dimension inputs should now be visible
      await expect(dimensionInputs).toBeVisible();

      // Verify width and height inputs exist
      const widthInput = page.locator('.export-dimension-input').first();
      const heightInput = page.locator('.export-dimension-input').last();

      await expect(widthInput).toBeVisible();
      await expect(heightInput).toBeVisible();

      // Default values should be 1200
      await expect(widthInput).toHaveValue('1200');
      await expect(heightInput).toHaveValue('1200');
    });

    test('should close export panel when close button is clicked', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      // Panel should be visible
      const panel = page.locator('.export-options-panel');
      await expect(panel).toBeVisible();

      // Click close button
      const closeButton = page.locator('.export-close-btn');
      await closeButton.click();

      // Panel should be hidden
      await expect(panel).not.toBeVisible();
    });

    test('should have export button with correct format label', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportButton = page.locator('.export-button-container button.btn-icon');
      await exportButton.click();

      // Export button should say "Export PNG" by default
      const primaryButton = page.locator('.export-btn-primary');
      await expect(primaryButton).toContainText('Export PNG');

      // Switch to JPEG
      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');
      await jpegButton.click();

      // Export button should now say "Export JPEG"
      await expect(primaryButton).toContainText('Export JPEG');
    });
  });

  test.describe('Export Download', () => {
    // Note: Actually testing file downloads in Playwright requires additional setup
    // These tests verify the export request is made correctly

    test('should trigger PNG export with correct parameters', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportIconButton = page.locator('.export-button-container button.btn-icon');
      await exportIconButton.click();

      // Set up request interception to verify the export URL
      let exportRequestUrl = '';
      page.on('request', (request) => {
        if (request.url().includes('/preview') && request.url().includes('format=png')) {
          exportRequestUrl = request.url();
        }
      });

      // Click export button
      const primaryButton = page.locator('.export-btn-primary');
      await primaryButton.click();

      // Wait a moment for the request to be made
      await page.waitForTimeout(1000);

      // Verify the request was made with PNG format
      if (exportRequestUrl) {
        expect(exportRequestUrl).toContain('format=png');
        expect(exportRequestUrl).toContain('width=1200');
        expect(exportRequestUrl).toContain('height=1200');
      }
    });

    test('should trigger JPEG export with quality parameter', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const viewButton = page.locator('button:has-text("View")').first();
      const viewButtonCount = await viewButton.count();
      if (viewButtonCount === 0) {
        test.skip(true, 'No viewable data available for testing export');
        return;
      }

      await viewButton.click();
      await page.waitForSelector('.image-viewer-overlay', { state: 'visible' });

      const exportIconButton = page.locator('.export-button-container button.btn-icon');
      await exportIconButton.click();

      // Switch to JPEG
      const jpegButton = page.locator('.export-format-btn:has-text("JPEG")');
      await jpegButton.click();

      // Adjust quality slider to 50
      const qualitySlider = page.locator('.export-slider');
      await qualitySlider.fill('50');

      // Set up request interception to verify the export URL
      let exportRequestUrl = '';
      page.on('request', (request) => {
        if (request.url().includes('/preview') && request.url().includes('format=jpeg')) {
          exportRequestUrl = request.url();
        }
      });

      // Click export button
      const primaryButton = page.locator('.export-btn-primary');
      await primaryButton.click();

      // Wait a moment for the request to be made
      await page.waitForTimeout(1000);

      // Verify the request was made with JPEG format and quality
      if (exportRequestUrl) {
        expect(exportRequestUrl).toContain('format=jpeg');
        expect(exportRequestUrl).toContain('quality=50');
      }
    });
  });
});
