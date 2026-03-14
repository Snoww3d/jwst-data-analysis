import { Page, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const BACKEND_URL = 'http://localhost:5001';
export const TEST_PASSWORD = 'TestPassword123';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the shared FITS fixture used for seeding data. */
export const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'e2e',
  'mast',
  'e2e-test-obs',
  'test_mirimage_i2d.fits'
);

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

/** 8-char random hex string for test isolation. */
export function uniqueId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/* ------------------------------------------------------------------ */
/*  API helpers (headless — no browser needed)                         */
/* ------------------------------------------------------------------ */

export interface ApiAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  username: string;
  user: Record<string, unknown>;
}

/**
 * Register a new user via the backend API.
 * Returns tokens + user info for injection into localStorage.
 */
export async function apiRegisterUser(
  request: APIRequestContext,
  prefix = 'e2e'
): Promise<ApiAuthResult> {
  const id = uniqueId();
  const username = `${prefix}_${id}`;

  const res = await request.post(`${BACKEND_URL}/api/auth/register`, {
    data: {
      username,
      email: `${username}@example.com`,
      password: TEST_PASSWORD,
      displayName: `E2E ${id}`,
      organization: 'E2E Lab',
    },
  });

  if (!res.ok()) {
    throw new Error(`API register failed (${res.status()}): ${await res.text()}`);
  }

  const body = await res.json();
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresAt,
    username,
    user: body.user,
  };
}

export interface UploadResult {
  id: string;
  fileName: string;
}

/**
 * Upload the shared FITS fixture via the backend API.
 * Requires a valid access token.
 * Each upload gets a unique filename to avoid per-user duplicate key conflicts.
 */
export async function apiUploadFixture(
  request: APIRequestContext,
  accessToken: string
): Promise<UploadResult> {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  const uniqueName = `test_mirimage_${uniqueId()}_i2d.fits`;

  const res = await request.post(`${BACKEND_URL}/api/jwstdata/upload`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    multipart: {
      File: { name: uniqueName, mimeType: 'application/octet-stream', buffer },
      DataType: 'image',
    },
  });

  if (!res.ok()) {
    throw new Error(`API upload failed (${res.status()}): ${await res.text()}`);
  }

  const body = await res.json();
  return { id: body.id, fileName: body.fileName };
}

export interface SeedResult extends ApiAuthResult {
  dataIds: UploadResult[];
}

/**
 * Register a user and upload N FITS fixtures in one call.
 */
export async function seedUserWithData(
  request: APIRequestContext,
  opts: { prefix?: string; fileCount?: number } = {}
): Promise<SeedResult> {
  const { prefix = 'e2e', fileCount = 1 } = opts;

  const auth = await apiRegisterUser(request, prefix);
  const dataIds: UploadResult[] = [];

  for (let i = 0; i < fileCount; i++) {
    dataIds.push(await apiUploadFixture(request, auth.accessToken));
  }

  return { ...auth, dataIds };
}

/* ------------------------------------------------------------------ */
/*  Browser helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Inject auth tokens into localStorage so the app treats the browser
 * as authenticated without going through the login UI.
 */
export async function injectAuthTokens(
  page: Page,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    user: Record<string, unknown>;
  }
): Promise<void> {
  await page.evaluate(
    ({ accessToken, refreshToken, expiresAt, user }) => {
      localStorage.setItem('jwst_auth_token', accessToken);
      localStorage.setItem('jwst_refresh_token', refreshToken);
      localStorage.setItem('jwst_expires_at', expiresAt);
      localStorage.setItem('jwst_user', JSON.stringify(user));
    },
    tokens
  );
}

/**
 * Full one-shot helper: register via API, navigate to `/`, inject tokens,
 * and wait for the dashboard controls to appear.
 */
export async function setupAuthenticatedDashboard(
  page: Page,
  request: APIRequestContext,
  opts: { prefix?: string; fileCount?: number } = {}
): Promise<SeedResult> {
  const seed = await seedUserWithData(request, opts);
  await loginWithTokens(page, seed);
  return seed;
}

/**
 * Inject tokens and navigate to the library/dashboard.
 * Uses a two-step approach to avoid race conditions:
 * 1. Navigate to /login to establish page context on the app origin
 * 2. Inject tokens into localStorage
 * 3. Navigate to destination — app finds tokens and renders the page
 *
 * @param dest - URL to navigate to after injecting tokens (default: '/library')
 */
export async function loginWithTokens(
  page: Page,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    user: Record<string, unknown>;
  },
  dest = '/library'
): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await injectAuthTokens(page, tokens);
  await page.goto(dest);
  if (dest === '/library') {
    await page.waitForSelector('.dashboard .controls', { state: 'visible', timeout: 15_000 });
  }
}

/**
 * From an authenticated dashboard with data, open a viewable image in
 * the FITS viewer. When `fileName` is provided the helper targets that
 * specific file (avoiding stale public data from previous test runs).
 * Returns `true` if a viewer was opened, `false` if no viewable files exist.
 */
export async function openImageViewer(page: Page, fileName?: string): Promise<boolean> {
  // Wait for data cards to render
  await page.waitForTimeout(1000);

  // The default Lineage view nests file cards inside collapsible processing
  // levels that start collapsed — cards aren't in the DOM until expanded.
  // Switch to "By Target" which renders flat .data-card elements for all files.
  const byTargetBtn = page.getByRole('button', { name: /By Target/i });
  if ((await byTargetBtn.count()) > 0) {
    await byTargetBtn.click();
    await page.waitForTimeout(1000);
  }

  let viewButton;

  if (fileName) {
    const card = page.locator('.data-card', { hasText: fileName }).first();
    if ((await card.count()) === 0) {
      return false;
    }
    viewButton = card.locator('.view-file-btn:not(:disabled)');
  } else {
    viewButton = page.locator('.view-file-btn:not(:disabled)').first();
  }

  if ((await viewButton.count()) === 0) {
    return false;
  }

  await viewButton.click();
  await page.waitForSelector('.image-viewer-overlay', { state: 'visible', timeout: 15_000 });

  // Wait for the preview image to finish loading (or an error to appear).
  // The image has display:none while loading, so waiting for it to become
  // visible confirms the processing engine has returned a preview.
  await Promise.race([
    page.waitForSelector('img.scientific-canvas', { state: 'visible', timeout: 30_000 }),
    page.waitForSelector('.viewer-error-state', { state: 'visible', timeout: 30_000 }),
  ]);

  return true;
}
