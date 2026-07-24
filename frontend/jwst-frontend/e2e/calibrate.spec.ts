import { test, expect } from '@playwright/test';

/**
 * Calibration recipes (#1709 PRs 7-8).
 *
 * The gallery reads the engine's seeded recipes (loaded at engine startup),
 * so no auth or mocking is needed for browse/config. The run itself is
 * exercised by the engine's own test suite — starting real pipeline jobs is
 * out of scope for E2E.
 */

test.describe('Calibration recipes', () => {
  test('gallery lists the seeded recipes', async ({ page }) => {
    await page.goto('/calibrate');
    await expect(page.getByRole('heading', { name: 'Calibration Recipes' })).toBeVisible();
    const cards = page.getByTestId('calibration-recipe-card');
    await expect(cards).toHaveCount(3);
    await expect(page.getByText('NIRCam Imaging (uncal → i2d mosaic)')).toBeVisible();
    await expect(page.getByText('Pipeline v', { exact: false })).toBeVisible();
  });

  test('recipe card opens the run configuration page', async ({ page }) => {
    await page.goto('/calibrate');
    await page
      .getByTestId('calibration-recipe-card')
      .filter({ hasText: 'MIRI Imaging' })
      .getByRole('link', { name: 'Configure & run' })
      .click();
    await expect(page).toHaveURL(/\/calibrate\/seed-miri-imaging$/);
    await expect(page.getByRole('heading', { name: 'Stages' })).toBeVisible();
    // Seeded parameters are editable rows.
    await expect(page.getByLabel('Step for parameter 1')).toHaveValue('jump');
    await expect(page.getByRole('button', { name: 'Run calibration' })).toBeEnabled();
  });

  test('mocked run start shows the progress view', async ({ page }) => {
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
    await expect(page.getByRole('heading', { name: 'Run progress' })).toBeVisible();
    await expect(page.getByText('running image2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  });
});
