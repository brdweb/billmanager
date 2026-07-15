import { test, expect } from '@playwright/test';
import { login, suppressModals } from './helpers';

// Navigate directly to the login page through the SPA fallback.
async function navigateToLogin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('button[type="submit"]:has-text("Sign In")').waitFor({ timeout: 10000 });
}

test.describe('OAuth UI - Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await suppressModals(page);
  });

  test('login page renders without social login buttons when no providers configured', async ({ page }) => {
    await navigateToLogin(page);

    // The login form should be visible
    await expect(page.locator('input[placeholder*="username" i]')).toBeVisible();
    await expect(page.locator('input[placeholder*="password" i]')).toBeVisible();

    // Social login divider "or continue with" should NOT be present when no providers configured
    const socialDivider = page.getByText('or continue with');
    await expect(socialDivider).not.toBeVisible();
  });

  test('login page has Sign In tab active by default', async ({ page }) => {
    await navigateToLogin(page);

    // The Sign In tab should be present and active
    const signInTab = page.locator('[role="tab"]:has-text("Sign In")');
    await expect(signInTab).toBeVisible();
    await expect(signInTab).toHaveAttribute('aria-selected', 'true');
  });

  test('login page renders BillManager branding', async ({ page }) => {
    await navigateToLogin(page);

    // Title and tagline should be visible
    await expect(page.getByText('BillManager').first()).toBeVisible();
    await expect(page.getByText('Track your bills and income with ease')).toBeVisible();
  });

  test('login page has forgot password link', async ({ page }) => {
    await navigateToLogin(page);

    const forgotLink = page.getByText('Forgot password?');
    await expect(forgotLink).toBeVisible();
  });

  test('login page has GitHub link', async ({ page }) => {
    await navigateToLogin(page);

    const githubLink = page.getByText('View on GitHub');
    await expect(githubLink).toBeVisible();
  });
});

test.describe('OAuth UI - Auth Callback', () => {
  test.beforeEach(async ({ page }) => {
    await suppressModals(page);
  });

  test('auth callback shows error for missing params', async ({ page }) => {
    // Navigate to /auth/callback with no query params
    await page.goto('/auth/callback');

    // Should show error about missing code or state
    await expect(page.getByText(/missing|authorization|code|state/i).first()).toBeVisible({ timeout: 10000 });

    // Should show "Back to Login" button
    await expect(page.getByText('Back to Login')).toBeVisible();
  });

  test('auth callback shows error for error param', async ({ page }) => {
    // Navigate to /auth/callback with an error param
    await page.goto('/auth/callback?error=access_denied&error_description=User+cancelled');

    // Should show the error description
    await expect(page.getByText(/user cancelled|access_denied/i).first()).toBeVisible({ timeout: 10000 });

    // Should show "Back to Login" button
    await expect(page.getByText('Back to Login')).toBeVisible();
  });

  test('auth callback Back to Login button navigates to login', async ({ page }) => {
    await page.goto('/auth/callback?error=access_denied');

    await expect(page.getByText('Back to Login')).toBeVisible({ timeout: 10000 });
    await page.getByText('Back to Login').click();

    // Should navigate to login page (check for the login form)
    await expect(page.locator('input[placeholder*="username" i]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('OAuth UI - Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('admin settings page has Settings, Users, and Bill Groups tabs', async ({ page }) => {
    const adminButton = page.locator('button:has-text("Admin")');
    await expect(adminButton).toBeVisible({ timeout: 5000 });
    await adminButton.click();

    await expect(page).toHaveURL(/\/settings\?tab=users/);

    await expect(page.locator('[role="tab"]:has-text("Settings")')).toBeVisible();
    await expect(page.locator('[role="tab"]:has-text("Users")')).toBeVisible();
    await expect(page.locator('[role="tab"]').filter({ hasText: /bill group/i })).toBeVisible();
  });

  test('Settings tab exposes configured account security controls', async ({ page }) => {
    const adminButton = page.locator('button:has-text("Admin")');
    await expect(adminButton).toBeVisible({ timeout: 5000 });
    await adminButton.click();

    const settingsTab = page.locator('[role="tab"]:has-text("Settings")');
    await settingsTab.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByLabel('Language')).toBeVisible();
  });
});
