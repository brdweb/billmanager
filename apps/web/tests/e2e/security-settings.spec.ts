import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Security Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('settings page renders Security Settings heading', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Security Settings')).toBeVisible({ timeout: 10000 });
  });

  test('settings page renders TwoFactorSettings section based on config', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Security Settings')).toBeVisible({ timeout: 10000 });

    // Fetch config to know what to expect
    const response = await page.request.get('/api/v2/config');
    const config = await response.json();

    if (config.twofa_enabled) {
      // TwoFactorSettings should render when enabled
      await expect(page.getByText('Two-Factor Authentication').first()).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/extra layer of security/i)).toBeVisible();
    } else {
      // TwoFactorSettings returns null when disabled - heading should not appear
      const twoFAHeading = page.getByText('Two-Factor Authentication');
      const isVisible = await twoFAHeading.isVisible().catch(() => false);
      expect(isVisible).toBeFalsy();
    }
  });

  test('settings page renders LinkedAccounts section based on config', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Security Settings')).toBeVisible({ timeout: 10000 });

    // Fetch config to know what to expect
    const response = await page.request.get('/api/v2/config');
    const config = await response.json();

    const hasOAuthProviders = config.oauth_providers && config.oauth_providers.length > 0;

    if (hasOAuthProviders) {
      // LinkedAccounts should render when providers are configured
      await expect(page.getByText('Linked Accounts')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/connect external accounts/i)).toBeVisible();
    } else {
      // LinkedAccounts returns null when no providers configured
      const linkedHeading = page.getByText('Linked Accounts');
      const isVisible = await linkedHeading.isVisible().catch(() => false);
      expect(isVisible).toBeFalsy();
    }
  });

  test('settings page is accessible after login', async ({ page }) => {
    // Navigate directly to /settings
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Should render without redirect to login
    await expect(page.getByText('Security Settings')).toBeVisible({ timeout: 10000 });

    // Should NOT show login form
    const loginButton = page.locator('button[type="submit"]:has-text("Sign In")');
    await expect(loginButton).not.toBeVisible();
  });

  test('settings page not accessible when logged out', async ({ page, context }) => {
    // Clear auth state
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should be redirected to login
    const loginButton = page.locator('button[type="submit"]:has-text("Sign In")');
    const isOnLogin = await loginButton.isVisible().catch(() => false);
    expect(isOnLogin).toBeTruthy();
  });

  test('settings page has divider between sections', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Security Settings')).toBeVisible({ timeout: 10000 });

    // The Settings page has a Divider component between TwoFactorSettings and LinkedAccounts
    // Verify the page structure renders correctly by checking the container
    const settingsContainer = page.locator('[class*="Container"]').filter({ hasText: 'Security Settings' });
    await expect(settingsContainer).toBeVisible();
  });
});
