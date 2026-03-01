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

  test('renders hero section with title and search bar', async ({ page }) => {
    await expect(page.locator('.discovery-hero h2')).toHaveText(
      "Explore the Universe Through Webb's Eyes"
    );
    await expect(page.locator('.discovery-hero-sub')).toContainText(
      'Choose a target and create your own composite image'
    );
    await expect(page.locator('.discovery-search')).toBeVisible();
    await expect(page.locator('.discovery-search-field')).toBeVisible();
    await expect(page.locator('.discovery-search-btn')).toBeVisible();
  });

  test('displays featured targets section header', async ({ page }) => {
    await expect(page.locator('.discovery-section-header')).toHaveText('Featured Targets');
  });

  test('renders target cards for all featured targets', async ({ page }) => {
    const cards = page.locator('.target-card');
    await expect(cards).toHaveCount(3);
  });

  test('target card shows name, category info, and potential badge', async ({ page }) => {
    const firstCard = page.locator('.target-card').first();
    await expect(firstCard.locator('.target-card-name')).toHaveText('Carina Nebula');
    await expect(firstCard.locator('.target-card-catalog')).toHaveText('NGC 3372');
    await expect(firstCard.locator('.target-card-potential')).toBeVisible();
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
    await expect(page.locator('.discovery-error')).toContainText('Failed to load featured targets');
  });

  test('navigation bar shows Discover and My Library links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Discover', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Library' })).toBeVisible();
  });
});
