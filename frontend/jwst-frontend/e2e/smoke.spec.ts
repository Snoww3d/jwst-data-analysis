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
});
