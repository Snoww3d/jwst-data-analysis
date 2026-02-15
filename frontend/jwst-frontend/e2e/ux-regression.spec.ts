import { test, expect } from '@playwright/test';
import {
  seedUserWithData,
  loginWithTokens,
  openImageViewer,
  SeedResult,
} from './helpers';

let seed: SeedResult;

test.describe('UX regression coverage', () => {
  test.beforeAll(async ({ request }) => {
    seed = await seedUserWithData(request, { prefix: 'uxe2e', fileCount: 1 });
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, seed);
  });

  test('renders dashboard controls in grouped hierarchy', async ({ page }) => {
    const filtersRow = page.locator('.controls-row-filters');
    const primaryActionsRow = page.locator('.controls-row-primary-actions');
    const secondaryActionsRow = page.locator('.controls-row-secondary-actions');
    const analysisActionsRow = page.locator('.controls-row-analysis-actions');

    await expect(filtersRow).toBeVisible();
    await expect(primaryActionsRow).toBeVisible();
    await expect(secondaryActionsRow).toBeVisible();
    await expect(analysisActionsRow).toBeVisible();

    await expect(primaryActionsRow.getByRole('button', { name: 'Upload Data' })).toBeVisible();
    await expect(
      primaryActionsRow.getByRole('button', { name: /(Search MAST|Hide MAST Search)/i })
    ).toBeVisible();
    await expect(
      primaryActionsRow.getByRole('button', { name: /(What's New|Hide What's New)/i })
    ).toBeVisible();

    await expect(secondaryActionsRow.getByRole('button', { name: /Lineage/i })).toBeVisible();
    await expect(secondaryActionsRow.getByRole('button', { name: /By Target/i })).toBeVisible();
    await expect(
      secondaryActionsRow.getByRole('button', { name: /(Show Archived|Show Active)/i })
    ).toBeVisible();

    await expect(analysisActionsRow.getByRole('button', { name: /Composite/i })).toBeVisible();
    await expect(analysisActionsRow.getByRole('button', { name: /WCS Mosaic/i })).toBeVisible();
    await expect(analysisActionsRow.getByRole('button', { name: /Compare/i })).toBeVisible();
  });

  test('shows labeled destructive controls in lineage view', async ({ page }) => {
    const observationDeleteLabel = page
      .locator('.lineage-header .delete-observation-btn .action-label')
      .first();

    if ((await observationDeleteLabel.count()) === 0) {
      test.skip(
        true,
        'No non-manual observation groups available for destructive-action assertions'
      );
      return;
    }

    await expect(observationDeleteLabel).toHaveText('Delete');

    const levelArchiveLabel = page.locator('.lineage-level .archive-btn .action-label').first();
    const levelDeleteLabel = page.locator('.lineage-level .delete-btn .action-label').first();

    await expect(levelArchiveLabel).toHaveText('Archive');
    await expect(levelDeleteLabel).toHaveText('Delete');
  });

  test.describe('mobile compact viewer', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('enables compact layout and content-first panel defaults', async ({ page }) => {
      const opened = await openImageViewer(page);
      if (!opened) {
        test.skip(true, 'No viewable files available for compact-viewer assertions');
        return;
      }

      const viewerGrid = page.locator('.advanced-fits-viewer-grid');
      await expect(viewerGrid).toHaveClass(/compact-layout/);

      await expect(page.locator('.stretch-controls').first()).toHaveClass(/collapsed/);
      await expect(page.locator('.histogram-panel').first()).toHaveClass(/collapsed/);
      await expect(page.locator('.viewer-sidebar')).toHaveClass(/collapsed/);
      await expect(page.locator('.export-options-panel')).toHaveCount(0);
    });
  });

  test.describe('desktop viewer', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('keeps desktop layout when viewport exceeds compact threshold', async ({ page }) => {
      const opened = await openImageViewer(page);
      if (!opened) {
        test.skip(true, 'No viewable files available for desktop-viewer assertions');
        return;
      }

      const viewerGrid = page.locator('.advanced-fits-viewer-grid');
      await expect(viewerGrid).not.toHaveClass(/compact-layout/);
      await expect(page.locator('.stretch-controls').first()).not.toHaveClass(/collapsed/);
    });
  });
});
