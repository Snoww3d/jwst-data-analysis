import { test, expect, Page, Route } from '@playwright/test';
import { apiRegisterUser, loginWithTokens, uniqueId, ApiAuthResult } from './helpers';

let auth: ApiAuthResult;

/**
 * Generate mock MAST search results with unique observation IDs per test run.
 * This prevents "Imported" button state caused by matching obs_ids that were
 * imported in previous test runs (data persists in MongoDB across runs).
 */
function createMockSearchResults(suffix: string) {
  return {
    results: [
      {
        obs_id: `jw99999-o001_t001_nircam_clear-f444w-${suffix}`,
        target_name: 'NGC 3132',
        instrument_name: 'NIRCAM',
        filters: 'F444W',
        t_exptime: 128.8,
        t_min: 60123.5,
        calib_level: 3,
      },
      {
        obs_id: `jw99999-o001_t001_nircam_clear-f200w-${suffix}`,
        target_name: 'NGC 3132',
        instrument_name: 'NIRCAM',
        filters: 'F200W',
        t_exptime: 128.8,
        t_min: 60123.5,
        calib_level: 3,
      },
    ],
    total: 2,
  };
}

/** Unique suffix per test suite run — prevents obs_id collisions with prior runs. */
const testRunSuffix = uniqueId();
const MOCK_SEARCH_RESULTS = createMockSearchResults(testRunSuffix);

async function mockSearchRoute(page: Page): Promise<void> {
  await page.route('**/api/mast/search/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SEARCH_RESULTS),
    });
  });
}

async function mockImportRoute(page: Page): Promise<Route[]> {
  const intercepted: Route[] = [];
  await page.route('**/api/mast/import', async (route: Route) => {
    intercepted.push(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'mock-job-001',
        obsId: MOCK_SEARCH_RESULTS.results[0].obs_id,
        status: 'started',
      }),
    });
  });
  return intercepted;
}

test.describe('MAST download UI', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'mast-dl');
  });

  test.beforeEach(async ({ page }) => {
    await loginWithTokens(page, auth);

    // Open the MAST panel
    const mastToggle = page.locator('button.mast-search-btn');
    await expect(mastToggle).toBeVisible({ timeout: 10_000 });
    await mastToggle.click();
    await expect(page.locator('.mast-search')).toBeVisible({ timeout: 10_000 });
  });

  test('shows download source dropdown with three options', async ({ page }) => {
    const select = page.locator('.download-source-select');
    await expect(select).toBeVisible();

    // Verify all three options exist
    const options = select.locator('option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText('Auto (S3 preferred)');
    await expect(options.nth(1)).toHaveText('S3 Direct');
    await expect(options.nth(2)).toHaveText('HTTP (MAST)');
  });

  test('defaults to Auto download source', async ({ page }) => {
    const select = page.locator('.download-source-select');
    await expect(select).toHaveValue('auto');
  });

  test('can switch download source to S3 and HTTP', async ({ page }) => {
    const select = page.locator('.download-source-select');

    await select.selectOption('s3');
    await expect(select).toHaveValue('s3');

    await select.selectOption('http');
    await expect(select).toHaveValue('http');

    await select.selectOption('auto');
    await expect(select).toHaveValue('auto');
  });

  test('search results show Import button per row', async ({ page }) => {
    await mockSearchRoute(page);

    // Perform a search
    const searchInput = page.locator('input.search-input-main');
    await searchInput.fill('NGC 3132');
    await page.locator('.search-button').click();

    // Wait for results
    await expect(page.locator('.results-table tbody tr')).toHaveCount(2);

    // Each row should have an Import button
    const importButtons = page.locator('.results-table .import-btn');
    await expect(importButtons).toHaveCount(2);
    await expect(importButtons.first()).toHaveText('Import');
    await expect(importButtons.first()).toBeEnabled();
  });

  test('Import button triggers API call with selected download source', async ({ page }) => {
    await mockSearchRoute(page);

    // Switch to S3 source
    await page.locator('.download-source-select').selectOption('s3');

    // Perform a search
    const searchInput = page.locator('input.search-input-main');
    await searchInput.fill('NGC 3132');
    await page.locator('.search-button').click();
    await expect(page.locator('.results-table tbody tr')).toHaveCount(2);

    // Intercept the import API call
    const importPromise = page.waitForRequest(
      (req) => req.url().includes('/api/mast/import') && req.method() === 'POST'
    );

    // Also mock the import response so the UI doesn't error
    await mockImportRoute(page);

    // Mock the progress polling endpoint
    await page.route('**/api/mast/import-progress/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: 'mock-job-001',
          obsId: MOCK_SEARCH_RESULTS.results[0].obs_id,
          stage: 'discovering',
          progress: 0,
          status: 'running',
        }),
      });
    });

    // Click first Import button
    await page.locator('.results-table .import-btn').first().click();

    // Verify the API call included downloadSource
    const importRequest = await importPromise;
    const body = importRequest.postDataJSON();
    expect(body.downloadSource).toBe('s3');
    expect(body.obsId).toBe(MOCK_SEARCH_RESULTS.results[0].obs_id);
  });

  test('Import button shows Importing state while active', async ({ page }) => {
    await mockSearchRoute(page);

    const searchInput = page.locator('input.search-input-main');
    await searchInput.fill('NGC 3132');
    await page.locator('.search-button').click();
    await expect(page.locator('.results-table tbody tr')).toHaveCount(2);

    // Mock import to respond after a delay
    await page.route('**/api/mast/import', async (route: Route) => {
      // Delay response so we can observe the "Importing..." state
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: 'mock-job-002',
          obsId: MOCK_SEARCH_RESULTS.results[0].obs_id,
          status: 'started',
        }),
      });
    });

    await page.route('**/api/mast/import-progress/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: 'mock-job-002',
          obsId: MOCK_SEARCH_RESULTS.results[0].obs_id,
          stage: 'discovering',
          progress: 0,
          status: 'running',
        }),
      });
    });

    // Click Import
    await page.locator('.results-table .import-btn').first().click();

    // Button should show "Importing..." and be disabled
    const firstImportBtn = page.locator('.results-table tbody tr').first().locator('.import-btn');
    await expect(firstImportBtn).toHaveText('Importing...');
    await expect(firstImportBtn).toBeDisabled();
  });

  test('bulk import button appears when results are selected', async ({ page }) => {
    await mockSearchRoute(page);

    const searchInput = page.locator('input.search-input-main');
    await searchInput.fill('NGC 3132');
    await page.locator('.search-button').click();
    await expect(page.locator('.results-table tbody tr')).toHaveCount(2);

    // No bulk button initially
    await expect(page.locator('.bulk-import-btn')).not.toBeVisible();

    // Select first checkbox
    await page.locator('.results-table tbody tr').first().locator('input[type="checkbox"]').check();

    // Bulk import button should appear
    const bulkBtn = page.locator('.bulk-import-btn');
    await expect(bulkBtn).toBeVisible();
    await expect(bulkBtn).toContainText('Import Selected (1)');

    // Select second checkbox
    await page.locator('.results-table tbody tr').nth(1).locator('input[type="checkbox"]').check();
    await expect(bulkBtn).toContainText('Import Selected (2)');
  });

  test('download source label is visible and descriptive', async ({ page }) => {
    const label = page.locator('.download-source-label .toggle-label');
    await expect(label).toBeVisible();
    await expect(label).toHaveText('Download source:');
  });
});
