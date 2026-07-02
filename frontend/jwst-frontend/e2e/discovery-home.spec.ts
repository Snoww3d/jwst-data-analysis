import { test, expect, Route } from '@playwright/test';
import { apiRegisterUser, loginWithTokens, ApiAuthResult } from './helpers';

let auth: ApiAuthResult;

/**
 * Mock featured targets response with a small deterministic set.
 */
const MOCK_FEATURED_TARGETS = [
  {
    name: 'Carina Nebula',
    catalogId: 'NGC 3372',
    category: 'nebula',
    description: 'Star-forming region in the southern sky.',
    instruments: ['NIRCAM', 'MIRI'],
    filterCount: 6,
    compositePotential: 'great',
    thumbnail: null,
    mastSearchParams: { target: 'Carina Nebula' },
  },
  {
    name: "Stephan's Quintet",
    catalogId: 'HCG 92',
    category: 'galaxy',
    description: 'Compact galaxy group.',
    instruments: ['NIRCAM'],
    filterCount: 4,
    compositePotential: 'good',
    thumbnail: null,
    mastSearchParams: { target: "Stephan's Quintet" },
  },
  {
    name: 'Southern Ring Nebula',
    catalogId: 'NGC 3132',
    category: 'nebula',
    description: 'Planetary nebula.',
    instruments: ['NIRCAM', 'MIRI'],
    filterCount: 3,
    compositePotential: 'limited',
    thumbnail: null,
    mastSearchParams: { target: 'NGC 3132' },
  },
];

async function mockFeaturedTargets(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/discovery/featured', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_FEATURED_TARGETS),
    });
  });
}

test.describe('Discovery home page', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'disco');
  });

  test.beforeEach(async ({ page }) => {
    await mockFeaturedTargets(page);
    await loginWithTokens(page, auth, '/');
    await page.waitForSelector('.discovery-home', { state: 'visible', timeout: 10_000 });
  });

  test('renders search console with headline, search bar, and example chips', async ({ page }) => {
    await expect(page.locator('.search-console-title')).toHaveText(
      'Explore the universe through Webb’s eyes.'
    );
    await expect(page.locator('.search-console-subtitle')).toContainText(
      'Search public JWST observations'
    );
    await expect(page.locator('.discovery-search')).toBeVisible();
    await expect(page.locator('.discovery-search-field')).toBeVisible();
    await expect(page.locator('.discovery-search-btn')).toBeVisible();
    await expect(page.locator('.search-console-example-chip')).toHaveCount(4);
  });

  test('example chip populates the search field', async ({ page }) => {
    await page.locator('.search-console-example-chip', { hasText: 'M16' }).click();
    await expect(page.locator('.discovery-search-field')).toHaveValue('M16');
  });

  test('spotlight shows the first great-potential target as hero', async ({ page }) => {
    const spotlight = page.locator('.spotlight');
    await expect(spotlight).toBeVisible();
    await expect(spotlight.locator('.spotlight-eyebrow')).toContainText('Target of the week');
    await expect(spotlight.locator('.spotlight-title')).toHaveText('Carina Nebula');
    await expect(spotlight.locator('.spotlight-mini')).toHaveCount(2);
  });

  test('displays featured targets section header with count', async ({ page }) => {
    await expect(page.locator('.discovery-section-header')).toHaveText('Featured targets');
    await expect(page.locator('.discovery-section-count')).toHaveText('3 of 3 targets');
  });

  test('renders target cards for all featured targets', async ({ page }) => {
    const cards = page.locator('.target-card');
    await expect(cards).toHaveCount(3);
  });

  test('filter chips derive from data and filter the grid', async ({ page }) => {
    const chips = page.locator('.filter-chip');
    await expect(chips).toHaveCount(4); // All targets, Best potential, Nebulae, Galaxies

    await page.locator('.filter-chip', { hasText: 'Galaxies' }).click();
    await expect(page.locator('.target-card')).toHaveCount(1);
    await expect(page.locator('.target-card-name')).toHaveText("Stephan's Quintet");
    await expect(page.locator('.discovery-section-count')).toHaveText('1 of 3 targets');

    await page.locator('.filter-chip', { hasText: 'Best potential' }).click();
    await expect(page.locator('.target-card')).toHaveCount(1);
    await expect(page.locator('.target-card-name')).toHaveText('Carina Nebula');

    await page.locator('.filter-chip', { hasText: 'All targets' }).click();
    await expect(page.locator('.target-card')).toHaveCount(3);
  });

  test('typing in the search field filters the grid live', async ({ page }) => {
    await page.locator('.discovery-search-field').fill('southern');
    await expect(page.locator('.target-card')).toHaveCount(1);
    await expect(page.locator('.target-card-name')).toHaveText('Southern Ring Nebula');
  });

  test('shows no-match message when search matches nothing', async ({ page }) => {
    await page.locator('.discovery-search-field').fill('zzz-no-such-target');
    await expect(page.locator('.discovery-no-matches')).toHaveText('No targets match your search.');
    await expect(page.locator('.target-card')).toHaveCount(0);
  });

  test('target card shows name, category info, and potential pill', async ({ page }) => {
    const firstCard = page.locator('.target-card').first();
    await expect(firstCard.locator('.target-card-name')).toHaveText('Carina Nebula');
    await expect(firstCard.locator('.target-card-catalog')).toHaveText('NGC 3372');
    await expect(firstCard.locator('.potential-pill')).toBeVisible();
    await expect(firstCard.locator('.instrument-badge')).toHaveCount(2);
  });

  test('target cards link to target detail page', async ({ page }) => {
    const firstCard = page.locator('.target-card').first();
    const href = await firstCard.getAttribute('href');
    expect(href).toContain('/target/');
    expect(href).toContain('Carina');
  });

  test('clicking a target card navigates to target detail', async ({ page }) => {
    // Mock the target detail APIs so navigation doesn't fail
    await page.route('**/api/mast/search/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], total: 0 }),
      });
    });

    await page.locator('.target-card').first().click();
    await page.waitForURL(/\/target\//);
    await expect(page.locator('.target-detail')).toBeVisible();
  });

  test('spotlight hero links to the target detail page', async ({ page }) => {
    const href = await page.locator('.spotlight-hero').getAttribute('href');
    expect(href).toContain('/target/');
    expect(href).toContain('Carina');
  });

  test('search bar navigates to target detail on submit', async ({ page }) => {
    // Mock APIs for navigated page
    await page.route('**/api/mast/search/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], total: 0 }),
      });
    });

    const searchField = page.locator('.discovery-search-field');
    await searchField.fill('M31');
    await page.locator('.discovery-search-btn').click();

    await page.waitForURL(/\/target\/M31/);
  });

  test('shows error state when featured targets fail to load', async ({ page }) => {
    // Re-navigate with a failing mock
    await page.route('**/api/discovery/featured', async (route: Route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/');
    await expect(page.locator('.discovery-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.discovery-retry')).toBeVisible();
  });

  test('navigation bar shows Discover, Search, and My Library links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Discover', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Library' })).toBeVisible();
  });
});
