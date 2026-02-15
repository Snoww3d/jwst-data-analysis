import { test, expect, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const uniqueId = () => randomUUID().replace(/-/g, '').slice(0, 12);

async function registerAndOpenDashboard(page: Page): Promise<void> {
  const id = uniqueId();
  const username = `uxe2e_${id}`;
  const email = `${username}@example.com`;
  const password = 'TestPassword123';

  await page.goto('/register');

  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel(/^Confirm Password/).fill(password);
  await page.getByLabel('Display Name').fill(`UX E2E ${id}`);
  await page.getByLabel('Organization').fill('E2E Lab');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page).not.toHaveURL(/\/(login|register)/);
  await expect(page.locator('.dashboard .controls')).toBeVisible();
}

async function openViewerIfAvailable(page: Page): Promise<boolean> {
  const byTargetButton = page.getByRole('button', { name: /By Target/i });
  if ((await byTargetButton.count()) > 0) {
    await byTargetButton.click();
  }

  const viewButton = page.locator('.view-file-btn:not(.disabled)').first();
  if ((await viewButton.count()) === 0) {
    return false;
  }

  await viewButton.click();
  await expect(page.locator('.image-viewer-overlay')).toBeVisible();
  return true;
}

test.describe('UX regression coverage', () => {
  test('renders dashboard controls in grouped hierarchy', async ({ page }) => {
    await registerAndOpenDashboard(page);

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
    await registerAndOpenDashboard(page);

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
      await registerAndOpenDashboard(page);

      const opened = await openViewerIfAvailable(page);
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
      await registerAndOpenDashboard(page);

      const opened = await openViewerIfAvailable(page);
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
