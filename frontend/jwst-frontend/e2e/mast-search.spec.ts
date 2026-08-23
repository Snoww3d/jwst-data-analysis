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

/**
 * MAST Search v2 Phase 5 — sky map + browse-first empty state.
 *
 * The Aladin bundle is NOT fetched from the CDN in e2e: `page.route`
 * fulfills the loader's script request with a tiny inert stub (below), so
 * these tests are deterministic offline and never depend on WebGL in the
 * CI browser. Everything the tests assert (empty-state panels, the split
 * toggle, the row highlight class) is app code, not Aladin behaviour —
 * Aladin's own API surface is covered by the unit tests' recording stub.
 */
const ALADIN_STUB = `window.A = {
  init: Promise.resolve(),
  aladin: () => ({
    on() {}, addOverlay() {}, addMOC() {}, gotoRaDec() {}, setFoV() {},
    getFov: () => [180, 90], getRaDec: () => [0, 0], getSize: () => [800, 600],
    setBaseImageLayer() {}, setProjection() {},
    select() {}, fire() {},
    pix2world: (x, y) => [x / 10, y / 10],
    angularDist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) / 10,
  }),
  graphicOverlay: () => ({ addFootprints() {}, removeAll() {}, reportChange() {} }),
  footprintsFromSTCS: () => [],
  MOCFromJSON: () => ({ show() {}, hide() {} }),
  HiPS: (id) => ({ id }),
  polygon: () => ({}),
  circle: () => ({}),
};`;

const CARINA_ROW = {
  obs_id: 'jw02731-o001_t017_miri_f770w',
  target_name: 'NGC 3324',
  instrument_name: 'MIRI/IMAGE',
  s_region: 'POLYGON 151.7538 -40.4086 151.7925 -40.4290 151.7524 -40.4729 151.7137 -40.4524',
  t_obs_release: 60000,
};

test.describe('MAST search sky map (Phase 5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/aladin.js', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: ALADIN_STUB })
    );
    await page.route('**/api/mast/coverage*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shape: 'grid',
          nside: 64,
          cells: [[3, 2]],
          total: 2,
          generated_at: '2026-08-23T00:00:00+00:00',
          stale: false,
        }),
      })
    );
    await page.route('**/api/mast/whats-new', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ search_type: 'recent', results: [CARINA_ROW], result_count: 1 }),
      })
    );
  });

  test("empty state: What's New, the invitation copy, and the map instead of a blank page", async ({
    page,
  }) => {
    await page.goto('/search');
    await expect(page.getByText('Explore the JWST sky')).toBeVisible();
    await expect(page.getByText('Pan the sky, pick a recent release, or type a target.')).toBeVisible();
    await expect(page.getByText("What's New on MAST")).toBeVisible();
    await expect(page.getByText('NGC 3324')).toBeVisible();
    // the map pane mounted (stub Aladin ready → survey selector is ours)
    await expect(page.getByLabel('Background survey')).toBeVisible();
  });

  test('split view toggles from the toolbar and lands in the URL', async ({ page }) => {
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ search_type: 'target', results: [CARINA_ROW], result_count: 1 }),
      })
    );
    await page.goto('/search?q=NGC+3324');
    await expect(page.getByText('Search Results (1)')).toBeVisible();
    await expect(page.getByText('Explore the JWST sky')).toBeHidden();

    const split = page.getByRole('button', { name: 'Split' });
    await expect(split).toBeEnabled();
    await split.click();
    await expect(page).toHaveURL(/view=split/);
    await expect(page.getByRole('button', { name: 'Fit map to results' })).toBeVisible();
    await expect(page.locator('.sky-map')).toBeVisible();

    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(page).not.toHaveURL(/view=split/);
  });

  test('hovering a result row adds the highlight class (map linkage)', async ({ page }) => {
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ search_type: 'target', results: [CARINA_ROW], result_count: 1 }),
      })
    );
    await page.goto('/search?q=NGC+3324&view=split');
    const row = page.locator(`#obs-${CARINA_ROW.obs_id}`);
    await expect(row).toBeVisible();
    await row.hover();
    await expect(row).toHaveClass(/highlighted/);
    await page.locator('.results-count').hover();
    await expect(row).not.toHaveClass(/highlighted/);
  });

  test('region deep link shows only the clipped rows and the removable chip (Phase 6)', async ({
    page,
  }) => {
    const FAR_ROW = {
      ...CARINA_ROW,
      obs_id: 'jw-far-away',
      target_name: 'Far away',
      s_region: 'POLYGON 10.0 10.0 10.1 10.0 10.1 10.1 10.0 10.1',
    };
    await page.route('**/api/mast/search/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          search_type: 'coordinates',
          results: [CARINA_ROW, FAR_ROW],
          result_count: 2,
        }),
      })
    );
    // A polygon around the Carina footprint; the far row is clipped away.
    await page.goto('/search?region=poly:151.6,-40.5;151.9,-40.5;151.9,-40.3;151.6,-40.3');
    await expect(page.getByText('Search Results (1)')).toBeVisible();
    await expect(page.getByText('REGION: POLYGON · 4 VTX', { exact: false })).toBeVisible();
    await expect(page.locator(`#obs-${CARINA_ROW.obs_id}`)).toBeVisible();
    await expect(page.locator('#obs-jw-far-away')).toBeHidden();

    // Removing the chip clears the region and returns to the empty state.
    await page.getByRole('button', { name: 'Remove the drawn region' }).click();
    await expect(page).not.toHaveURL(/region=/);
    await expect(page.getByText('Explore the JWST sky')).toBeVisible();
  });
});
