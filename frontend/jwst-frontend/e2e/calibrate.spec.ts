import { test, expect } from '@playwright/test';

/**
 * Calibration (#1709 PRs 7-8, reshaped by the #1733 data-first redesign).
 *
 * The gallery reads the engine's seeded recipes (loaded at engine startup),
 * so no auth or mocking is needed for browse/config. The run itself is
 * exercised by the engine's own test suite — starting real pipeline jobs is
 * out of scope for E2E.
 */

test.describe('Calibration', () => {
  test('/calibrate is the run ledger', async ({ page }) => {
    // Data-first IA (#1738): runs are the unit, not the recipe catalog.
    await page.goto('/calibrate');
    // exact: the signed-out empty state also contains "calibration runs".
    await expect(
      page.getByRole('heading', { name: 'Calibration runs', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '+ New run' })).toBeVisible();
  });

  test('recipes live on their own surface and list the seeded recipes', async ({ page }) => {
    await page.goto('/calibrate/recipes');
    await expect(page.getByRole('heading', { name: 'Calibration Recipes' })).toBeVisible();
    const cards = page.getByTestId('calibration-recipe-card');
    await expect(cards).toHaveCount(3);
    await expect(page.getByText('NIRCam Imaging (uncal → i2d mosaic)')).toBeVisible();
    await expect(page.getByText('Pipeline v', { exact: false })).toBeVisible();
  });

  test('recipe card opens the run configuration page', async ({ page }) => {
    await page.goto('/calibrate/recipes');
    await page
      .getByTestId('calibration-recipe-card')
      .filter({ hasText: 'MIRI Imaging' })
      .getByRole('link', { name: 'Configure & run' })
      .click();
    await expect(page).toHaveURL(/\/calibrate\/seed-miri-imaging$/);
    await expect(page.getByRole('heading', { name: 'Stages' })).toBeVisible();
    // Seeded parameters render as curated controls now (#1737), not raw rows.
    // exact: the row's Remove button is aria-labelled "Remove <param label>".
    await expect(page.getByLabel('Jump detection — CPU cores', { exact: true })).toHaveValue(
      'half'
    );
    // The stage timeline explains the pipeline rather than listing identifiers (#1736).
    await expect(page.getByText('_uncal → _rate')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run calibration' })).toBeEnabled();
  });

  test('starting a run hands off to the run URL and shows progress', async ({ page }) => {
    // Intercept engine calls so no real pipeline job starts.
    await page.route('**/api/calibration/runs', (route) =>
      route.fulfill({ json: { jobId: 'e2e-job-1' }, status: 202 })
    );
    await page.route('**/api/jobs/e2e-job-1', (route) =>
      route.fulfill({
        json: {
          jobId: 'e2e-job-1',
          type: 'calibration',
          status: 'running',
          cancelRequested: false,
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          finishedAt: null,
          progress: {
            stages: [
              { name: 'detector1', status: 'done' },
              { name: 'image2', status: 'running' },
              { name: 'image3', status: 'pending' },
            ],
            currentStage: 'image2',
            message: 'running image2',
            downloadPct: null,
          },
          logTail: ['Step flat_field running with args'],
          result: null,
          error: null,
          request: {},
        },
      })
    );
    await page.goto('/calibrate/seed-nircam-imaging');
    await expect(page.getByRole('button', { name: 'Run calibration' })).toBeEnabled();
    await page.getByRole('button', { name: 'Run calibration' }).click();

    // The run gets its own durable URL (#1734) rather than living in page state.
    await expect(page).toHaveURL(/\/calibrate\/runs\/e2e-job-1$/);
    await expect(page.getByRole('heading', { name: 'Run progress' })).toBeVisible();
    await expect(page.getByText('running image2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  });
});
