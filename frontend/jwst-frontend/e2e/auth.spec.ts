/**
 * E2E tests for authentication flows
 *
 * These tests require the full application stack to be running:
 * - Frontend (localhost:3000)
 * - Backend (localhost:5001)
 * - MongoDB
 */

import { test, expect } from '@playwright/test';
import { uniqueId } from './helpers';

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');

      await expect(page.getByRole('heading', { name: 'JWST Data Analysis' })).toBeVisible();
      await expect(page.getByText('Sign in to your account')).toBeVisible();
      await expect(page.getByLabel('Username')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create one' })).toBeVisible();
    });

    test('should show error for empty username', async ({ page }) => {
      await page.goto('/login');

      await page.getByLabel('Password').fill('somepassword');
      await page.getByRole('button', { name: 'Sign In' }).click();

      await expect(page.getByText('Username or email is required')).toBeVisible();
    });

    test('should show error for empty password', async ({ page }) => {
      await page.goto('/login');

      await page.getByLabel('Username').fill('someuser');
      await page.getByRole('button', { name: 'Sign In' }).click();

      await expect(page.getByText('Password is required')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');

      await page.getByLabel('Username').fill('nonexistentuser');
      await page.getByLabel('Password').fill('wrongpassword');
      await page.getByRole('button', { name: 'Sign In' }).click();

      await expect(page.getByText('Invalid username or password')).toBeVisible();
    });

    test('should navigate to register page', async ({ page }) => {
      await page.goto('/login');

      await page.getByRole('link', { name: 'Create one' }).click();

      await expect(page).toHaveURL('/register');
      await expect(page.getByText('Create your account')).toBeVisible();
    });
  });

  test.describe('Register Page', () => {
    test('should display registration form', async ({ page }) => {
      await page.goto('/register');

      await expect(page.getByRole('heading', { name: 'JWST Data Analysis' })).toBeVisible();
      await expect(page.getByText('Create your account')).toBeVisible();
      await expect(page.getByLabel('Username')).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Confirm Password')).toBeVisible();
      await expect(page.getByLabel('Display Name')).toBeVisible();
      await expect(page.getByLabel('Organization')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
    });

    test('should show error for short username', async ({ page }) => {
      await page.goto('/register');

      await page.getByLabel('Username').fill('ab');
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password', { exact: true }).fill('password123');
      await page.getByLabel('Confirm Password').fill('password123');
      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.getByText('Username must be at least 3 characters')).toBeVisible();
    });

    test('should show error for invalid email', async ({ page }) => {
      await page.goto('/register');

      await page.getByLabel('Username').fill('testuser');
      await page.getByLabel('Email').fill('invalidemail');
      await page.getByLabel('Password', { exact: true }).fill('password123');
      await page.getByLabel('Confirm Password').fill('password123');
      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.getByText('Please enter a valid email address')).toBeVisible();
    });

    test('should show error for short password', async ({ page }) => {
      await page.goto('/register');

      await page.getByLabel('Username').fill('testuser');
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password', { exact: true }).fill('short');
      await page.getByLabel('Confirm Password').fill('short');
      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    });

    test('should show error for mismatched passwords', async ({ page }) => {
      await page.goto('/register');

      await page.getByLabel('Username').fill('testuser');
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password', { exact: true }).fill('password123');
      await page.getByLabel('Confirm Password').fill('differentpassword');
      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.getByText('Passwords do not match')).toBeVisible();
    });

    test('should navigate to login page', async ({ page }) => {
      await page.goto('/register');

      await page.getByRole('link', { name: 'Sign in' }).click();

      await expect(page).toHaveURL('/login');
      await expect(page.getByText('Sign in to your account')).toBeVisible();
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect to login when accessing protected route', async ({ page }) => {
      await page.goto('/');

      // Should redirect to login
      await expect(page).toHaveURL('/login');
    });

    test('should redirect to login when accessing any protected path', async ({ page }) => {
      await page.goto('/some-protected-path');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Full Authentication Flow', () => {
    test('should register, logout, and login successfully', async ({ page }) => {
      const username = `e2etest_${uniqueId()}`;
      const email = `${username}@example.com`;
      const password = 'TestPassword123';

      // Step 1: Register
      await page.goto('/register');

      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm Password').fill(password);
      await page.getByLabel('Display Name').fill('E2E Test User');
      await page.getByLabel('Organization').fill('Test Organization');
      await page.getByRole('button', { name: 'Create Account' }).click();

      // Should redirect to dashboard after registration
      await expect(page).not.toHaveURL(/\/(login|register)/);

      // Should show user menu with username
      await expect(page.getByText('E2E Test User')).toBeVisible();

      // Step 2: Logout
      // Click on user menu to open dropdown
      await page.getByText('E2E Test User').click();
      await page.getByText('Sign Out').click();

      // Should redirect to login
      await expect(page).toHaveURL('/login');

      // Step 3: Login with the registered credentials
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign In' }).click();

      // Should redirect to dashboard after login
      await expect(page).not.toHaveURL(/\/(login|register)/);

      // Should show user menu again
      await expect(page.getByText('E2E Test User')).toBeVisible();
    });

    test('should persist authentication across page refresh', async ({ page }) => {
      const username = `e2etest_${uniqueId()}`;
      const email = `${username}@example.com`;
      const password = 'TestPassword123';

      // Register a new user
      await page.goto('/register');

      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm Password').fill(password);
      await page.getByRole('button', { name: 'Create Account' }).click();

      // Wait for dashboard
      await expect(page).not.toHaveURL(/\/(login|register)/);

      // Refresh the page
      await page.reload();

      // Should still be authenticated
      await expect(page).not.toHaveURL(/\/(login|register)/);
    });
  });

  test.describe('User Menu', () => {
    test('should display user information in dropdown', async ({ page }) => {
      const username = `e2etest_${uniqueId()}`;
      const email = `${username}@example.com`;
      const password = 'TestPassword123';
      const displayName = 'Menu Test User';
      const organization = 'Menu Test Org';

      // Register
      await page.goto('/register');

      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm Password').fill(password);
      await page.getByLabel('Display Name').fill(displayName);
      await page.getByLabel('Organization').fill(organization);
      await page.getByRole('button', { name: 'Create Account' }).click();

      // Wait for dashboard
      await expect(page).not.toHaveURL(/\/(login|register)/);

      // Open user menu
      await page.getByText(displayName).click();

      // Check dropdown content
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByText(organization)).toBeVisible();
      await expect(page.getByText('Sign Out')).toBeVisible();
    });
  });
});
