import { test, expect } from '@playwright/test';
import {
  apiRegisterUser,
  injectAuthTokens,
  loginWithTokens,
  ApiAuthResult,
} from './helpers';

let auth: ApiAuthResult;

test.describe('Session persistence and token handling', () => {
  test.beforeAll(async ({ request }) => {
    auth = await apiRegisterUser(request, 'sess');
  });

  test('redirects to login when accessing protected route with no tokens', async ({ page }) => {
    await page.goto('/library');
    await expect(page).toHaveURL(/\/login/);
  });

  test('stays authenticated after page reload', async ({ page }) => {
    await loginWithTokens(page, auth);
    await page.reload();
    await expect(page).not.toHaveURL(/\/(login|register)/);
    await expect(page.locator('.dashboard .controls')).toBeVisible({ timeout: 15_000 });
  });

  test('auto-refreshes when access token is expired but refresh token is valid', async ({
    page,
    request,
  }) => {
    // Get fresh tokens
    const freshAuth = await apiRegisterUser(request, 'refresh');

    // Navigate to login first to establish page context
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    // Inject tokens with an expired access token time
    await page.evaluate(
      ({ accessToken, refreshToken, user }) => {
        localStorage.setItem('jwst_auth_token', accessToken);
        localStorage.setItem('jwst_refresh_token', refreshToken);
        // Set expiry to the past to trigger refresh
        localStorage.setItem('jwst_expires_at', new Date(Date.now() - 60_000).toISOString());
        localStorage.setItem('jwst_user', JSON.stringify(user));
      },
      freshAuth
    );

    // Navigate to library — app should detect expired token and refresh.
    // The refresh path involves retryRefreshToken which can take up to ~5s on
    // retries (1s + 3s delays), so we give generous timeouts.
    await page.goto('/library');

    // Should still end up on dashboard (refresh succeeded)
    await expect(page).not.toHaveURL(/\/(login|register)/, { timeout: 15_000 });
    await expect(page.locator('.dashboard .controls')).toBeVisible({ timeout: 15_000 });
  });

  test('redirects to login when all tokens are cleared', async ({ page }) => {
    await loginWithTokens(page, auth);
    await expect(page.locator('.dashboard .controls')).toBeVisible();

    // Clear all tokens
    await page.evaluate(() => {
      localStorage.removeItem('jwst_auth_token');
      localStorage.removeItem('jwst_refresh_token');
      localStorage.removeItem('jwst_user');
      localStorage.removeItem('jwst_expires_at');
    });

    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });
});
