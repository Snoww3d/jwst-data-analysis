import { test, expect } from '@playwright/test';

test.describe('MAST search panel', () => {
  test.beforeEach(async ({ page }) => {
    // MAST search lives on the public /search page — no login needed for search-only flows
    await page.goto('/search');
    await expect(page.locator('.mast-search')).toBeVisible({ timeout: 10_000 });
  });

  test('renders search page heading with MAST search panel', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await expect(page.locator('.mast-search')).toBeVisible();
  });

  test('one smart input, no mode radios (MAST Search v2 Phase 2)', async ({ page }) => {
    await expect(page.locator('input.smart-search-input')).toBeVisible();
    await expect(page.locator('.search-type-selector')).toHaveCount(0);
  });

  test('interprets each Discover chip as the user types', async ({ page }) => {
    const input = page.locator('input.smart-search-input');
    const hint = page.locator('.smart-search-hint');
    const radius = page.getByLabel('Search radius (degrees)');

    await input.fill('NGC 3324');
    await expect(hint).toHaveText('Interpreted as: target name "NGC 3324"');
    await expect(radius).toBeVisible();

    await input.fill('10h 37m -58°');
    await expect(hint).toHaveText('Interpreted as: coordinates 159.25°, −58.00°');
    await expect(radius).toBeVisible();

    await input.fill('PID 2739');
    await expect(hint).toHaveText('Interpreted as: program 2739');
    await expect(radius).toBeHidden();

    await input.fill('jw02739-o001');
    await expect(hint).toHaveText('Interpreted as: observation ID jw02739-o001');
    await expect(radius).toBeHidden();
  });

  test('submitting pushes ?q= to the URL and Back restores it', async ({ page }) => {
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' })
    );
    const input = page.locator('input.smart-search-input');
    const recent = (q: string) => page.locator('.smart-search-recent-chip', { hasText: q });
    await input.fill('M16');
    await page.locator('.search-button').click();
    await expect(page).toHaveURL(/\/search\?q=M16$/);
    // The recent chip appears once the URL-driven search effect has run for
    // this entry; going Back before that would race React Router's
    // transition and skip the entry entirely.
    await expect(recent('M16')).toBeVisible();

    await input.fill('NGC 3324');
    await page.locator('.search-button').click();
    await expect(page).toHaveURL(/q=NGC\+3324/);
    await expect(recent('NGC 3324')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=M16$/);
    await expect(input).toHaveValue('M16');
  });

  test('opening /search?q= runs the search and lists it under Recent', async ({ page }) => {
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' })
    );
    await page.goto('/search?q=PID+2739');
    await expect(page.locator('input.smart-search-input')).toHaveValue('PID 2739');
    await expect(page.locator('.smart-search-recent-chip', { hasText: 'PID 2739' })).toBeVisible();
  });

  test('facet-only search: a URL with filters and no query runs and shows chips (Phase 4)', async ({
    page,
  }) => {
    let facetBody: Record<string, unknown> | null = null;
    await page.route('**/api/mast/search/facets', (route) => {
      facetBody = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          search_type: 'facets',
          results: [{ obs_id: 'jw01234-o001_t001_miri_ch1', instrument_name: 'MIRI/IFU' }],
          result_count: 1,
          default_window_applied: true,
        }),
      });
    });
    await page.goto('/search?inst=MIRI&dpt=cube');
    await expect(page.locator('input.smart-search-input')).toHaveValue('');
    const chips = page.getByRole('list', { name: 'Active filters' });
    await expect(chips.getByText('MIRI')).toBeVisible();
    await expect(chips.getByText('CUBE')).toBeVisible();
    await expect(chips.getByText('LAST 90 DAYS')).toBeVisible();
    await expect(page.getByText('Search Results (1)')).toBeVisible();
    expect(facetBody).toMatchObject({
      filters: { instrument_name: ['MIRI*'], dataproduct_type: ['cube'] },
      calibLevel: [3],
    });

    // the rail reflects the URL and Apply is idle until the draft changes
    const apply = page.getByRole('button', { name: 'Apply filters' });
    await expect(apply).toBeDisabled();
    await page
      .getByRole('group', { name: 'Instrument' })
      .getByRole('button', { name: 'NIRCam' })
      .click();
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page).toHaveURL(/inst=MIRI&inst=NIRCAM&dpt=cube/);
  });

  test('search button is visible and enabled', async ({ page }) => {
    const searchBtn = page.locator('.search-button');
    await expect(searchBtn).toBeVisible();
    await expect(searchBtn).toBeEnabled();
  });
});
