import { test, expect } from '@playwright/test';

test.describe('Application Smoke Tests', () => {
    test('should load the application', async ({ page }) => {
        await page.goto('/');

        // Verify title contains relevant keywords
        await expect(page).toHaveTitle(/JWST|Astronomy/i);
    });

    test('should render main dashboard layout', async ({ page }) => {
        await page.goto('/');

        // Check for main dashboard container or header
        // Using a broad selector initially to ensure it catches the main structure
        await expect(page.locator('h1')).toBeVisible();

        // Check for "Search MAST" button which is a core feature
        await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    });

    test('should not display authentication errors on initial load', async ({ page }) => {
        // This test catches the scenario where backend auth is enabled
        // but frontend doesn't have login UI yet (Task #72)
        await page.goto('/');

        // Wait for the page to settle (API calls to complete)
        await page.waitForTimeout(2000);

        // Verify no error message is displayed
        // The error component shows "Error" heading and "Request failed with status 401"
        const errorHeading = page.locator('text=Error');
        const authError = page.locator('text=401');

        // Neither should be visible on a healthy dashboard
        await expect(errorHeading).not.toBeVisible();
        await expect(authError).not.toBeVisible();
    });

    test('should load data without API errors', async ({ page }) => {
        // Monitor network requests for API failures
        const apiErrors: string[] = [];

        page.on('response', (response) => {
            if (response.url().includes('/api/') && response.status() >= 400) {
                apiErrors.push(`${response.status()} ${response.url()}`);
            }
        });

        await page.goto('/');

        // Wait for API calls to complete
        await page.waitForTimeout(3000);

        // Verify no API errors occurred (especially 401 Unauthorized)
        expect(apiErrors).toEqual([]);
    });
});
