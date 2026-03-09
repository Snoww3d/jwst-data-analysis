import { test, expect, Route } from '@playwright/test';
import { apiRegisterUser, loginWithTokens, ApiAuthResult } from './helpers';

let auth: ApiAuthResult;

/**
 * Mock MAST search results for a target with multiple instruments/filters.
 */
const MOCK_OBSERVATIONS = {
  results: [
    {
      obs_id: 'jw02731-o001_t001_nircam_clear-f444w',
      target_name: 'Carina Nebula',
      instrument_name: 'NIRCAM/IMAGE',
      filters: 'F444W',
      t_exptime: 128.8,
      calib_level: 3,
    },
    {
      obs_id: 'jw02731-o001_t001_nircam_clear-f200w',
      target_name: 'Carina Nebula',
      instrument_name: 'NIRCAM/IMAGE',
      filters: 'F200W',
      t_exptime: 128.8,
      calib_level: 3,
    },
    {
      obs_id: 'jw02731-o001_t001_miri_f560w',
      target_name: 'Carina Nebula',
      instrument_name: 'MIRI/IMAGE',
      filters: 'F560W',
      t_exptime: 55.5,
      calib_level: 3,
    },
  ],
  total: 3,
};

/**
 * Mock recipe suggestions matching the mock observations.
 */
const MOCK_RECIPES = {
  target: null,
  recipes: [
    {
      name: '3-filter NIRCAM+MIRI',
      rank: 1,
      filters: ['F444W', 'F200W', 'F560W'],
      colorMapping: { F444W: '#ff0000', F200W: '#00ff00', F560W: '#0000ff' },
      instruments: ['NIRCAM/IMAGE', 'MIRI/IMAGE'],
      requiresMosaic: false,
      estimatedTimeSeconds: 24,
      observationIds: null,
      description:
        'Stars and dust \u2014 full near- to mid-infrared wavelength coverage',
    },
    {
      name: '2-filter NIRCAM/IMAGE',
      rank: 2,
      filters: ['F444W', 'F200W'],
      colorMapping: { F444W: '#ff0000', F200W: '#00ff00' },
      instruments: ['NIRCAM/IMAGE'],
      requiresMosaic: false,
      estimatedTimeSeconds: 16,
      observationIds: null,
      description: 'All 2 NIRCAM/IMAGE filters for maximum detail',
    },
  ],
};

async function mockTargetDetailAPIs(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/mast/search/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_OBSERVATIONS),
    });
  });

  await page.route('**/api/discovery/suggest-recipes', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RECIPES),
    });
  });
}

test.describe('Target detail page', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'tgt');
  });

  test.beforeEach(async ({ page }) => {
    await mockTargetDetailAPIs(page);
    await loginWithTokens(page, auth, '/target/Carina%20Nebula');
    await page.waitForSelector('.target-detail', { state: 'visible', timeout: 15_000 });
    // Wait for data to load (past skeleton state)
    await page.waitForSelector('.target-detail-summary', { state: 'visible', timeout: 15_000 });
  });

  test('shows target name as page heading', async ({ page }) => {
    await expect(page.locator('.target-detail h2')).toHaveText('Carina Nebula');
  });

  test('shows back link to discovery home', async ({ page }) => {
    const backLink = page.locator('.back-link');
    await expect(backLink).toBeVisible();
    await expect(backLink).toContainText('Back to Discovery');
    expect(await backLink.getAttribute('href')).toBe('/');
  });

  test('shows observation count and recipe count in summary', async ({ page }) => {
    const summary = page.locator('.target-detail-summary');
    await expect(summary).toContainText('3 observations found');
    await expect(summary).toContainText('2 composite recipes suggested');
  });

  test('renders Suggested Composites section with recipe cards', async ({ page }) => {
    await expect(page.locator('.target-detail-section-header')).toHaveText('Suggested Composites');
    const recipeCards = page.locator('.recipe-card');
    await expect(recipeCards).toHaveCount(2);
  });

  test('first recipe card is marked as recommended', async ({ page }) => {
    const firstCard = page.locator('.recipe-card').first();
    await expect(firstCard).toHaveClass(/recipe-card-recommended/);
    await expect(firstCard.locator('.recipe-card-badge')).toHaveText('Recommended');
  });

  test('recipe card shows name, filter chips, instruments, and time', async ({ page }) => {
    const firstCard = page.locator('.recipe-card').first();
    await expect(firstCard.locator('.recipe-card-name')).toHaveText('3-filter NIRCAM+MIRI');

    // Filter chips
    const chips = firstCard.locator('.recipe-filter-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toContainText('F444W');
    await expect(chips.nth(1)).toContainText('F200W');
    await expect(chips.nth(2)).toContainText('F560W');

    // Color swatches should be present
    const swatches = firstCard.locator('.recipe-filter-swatch');
    await expect(swatches).toHaveCount(3);

    // Instruments
    await expect(firstCard.locator('.recipe-card-meta')).toContainText('NIRCAM/IMAGE + MIRI/IMAGE');

    // Estimated time
    await expect(firstCard.locator('.recipe-card-meta')).toContainText('~24 seconds');
  });

  test('recipe card has color bar with segments per filter', async ({ page }) => {
    const firstCard = page.locator('.recipe-card').first();
    const segments = firstCard.locator('.recipe-color-bar-segment');
    await expect(segments).toHaveCount(3);
  });

  test('recipe card CTA links to guided create page', async ({ page }) => {
    const cta = page.locator('.recipe-card').first().locator('.recipe-card-cta');
    await expect(cta).toHaveText('Create This Composite');
    const href = await cta.getAttribute('href');
    expect(href).toContain('/create?target=');
    expect(href).toContain('Carina');
    expect(href).toContain('recipe=');
  });

  test('shows collapsible observation list', async ({ page }) => {
    const toggle = page.locator('.observation-list-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Available Observations');
    await expect(toggle).toContainText('3');
  });

  test('expanding observation list reveals table with rows', async ({ page }) => {
    const toggle = page.locator('.observation-list-toggle');
    await toggle.click();

    const table = page.locator('.observation-list-table');
    await expect(table).toBeVisible();

    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);
  });
});

test.describe('Target detail — empty state', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'tgt-empty');
  });

  test('shows empty state when no observations found', async ({ page }) => {
    await page.route('**/api/mast/search/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], total: 0 }),
      });
    });

    await loginWithTokens(page, auth, '/target/Nonexistent%20Target');
    await expect(page.locator('.target-detail-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.target-detail-empty')).toContainText(
      'No observations found for this target'
    );
  });
});

test.describe('Target detail — error state', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'tgt-err');
  });

  test('shows error with retry button when API fails', async ({ page }) => {
    await page.route('**/api/mast/search/**', async (route: Route) => {
      await route.fulfill({ status: 503, body: 'Service Unavailable' });
    });

    await loginWithTokens(page, auth, '/target/Carina%20Nebula');
    await expect(page.locator('.target-detail-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.target-detail-retry')).toBeVisible();
    await expect(page.locator('.target-detail-retry')).toHaveText('Try Again');
  });
});

test.describe('Target detail — no recipes state', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'tgt-norec');
  });

  test('shows message when observations exist but no recipes generated', async ({ page }) => {
    await page.route('**/api/mast/search/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_OBSERVATIONS),
      });
    });

    await page.route('**/api/discovery/suggest-recipes', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ target: null, recipes: [] }),
      });
    });

    await loginWithTokens(page, auth, '/target/Carina%20Nebula');
    await expect(page.locator('.target-detail-no-recipes')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.target-detail-no-recipes')).toContainText(
      'No composite recipes could be generated'
    );
  });
});
