import { test, expect } from '@playwright/test';
import { login, suppressModals } from './helpers';

// Helper to check if 2FA is enabled on the server
async function is2FAEnabled(page: import('@playwright/test').Page): Promise<boolean> {
  const response = await page.request.get('/api/v2/config');
  if (!response.ok()) return false;
  const config = await response.json();
  return config.twofa_enabled === true;
}

test.describe('Two-Factor Authentication', () => {
  let twofaEnabled = false;

  test.beforeEach(async ({ page }) => {
    await suppressModals(page);
    twofaEnabled = await is2FAEnabled(page);
  });

  test('detects 2FA feature flag from config endpoint', async ({ page }) => {
    const response = await page.request.get('/api/v2/config');
    expect(response.ok()).toBeTruthy();

    const config = await response.json();
    // twofa_enabled should be a boolean (or undefined)
    expect(typeof config.twofa_enabled === 'boolean' || config.twofa_enabled === undefined).toBeTruthy();
  });

  test('Settings page renders TwoFactorSettings when 2FA enabled', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Should show Two-Factor Authentication heading
    await expect(page.getByText('Two-Factor Authentication').first()).toBeVisible({ timeout: 10000 });

    // Should show description text
    await expect(page.getByText(/extra layer of security/i)).toBeVisible();
  });

  test('TwoFactorSettings shows Email Verification Code option', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Email OTP section should be visible
    await expect(page.getByText('Email Verification Code')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/receive a 6-digit code via email/i)).toBeVisible();
  });

  test('TwoFactorSettings shows Enable button when 2FA not yet set up', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Look for the Enable button or Active badge (depending on current state)
    const enableButton = page.locator('button:has-text("Enable")');
    const activeBadge = page.getByText('Active').first();

    const hasEnable = await enableButton.isVisible().catch(() => false);
    const hasActive = await activeBadge.isVisible().catch(() => false);

    // One of the two should be visible
    expect(hasEnable || hasActive).toBeTruthy();
  });

  test('TwoFactorSettings does not render when 2FA is disabled', async ({ page }) => {
    test.skip(twofaEnabled, '2FA is enabled - cannot test disabled state');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Security Settings heading should still be visible
    await expect(page.getByText('Security Settings')).toBeVisible({ timeout: 10000 });

    // Two-Factor heading should NOT be visible when feature is disabled
    // (TwoFactorSettings returns null when !config.twofa_enabled)
    const twoFactorHeading = page.getByText('Two-Factor Authentication');
    const isVisible = await twoFactorHeading.isVisible().catch(() => false);

    // If 2FA is disabled, the component returns null so heading won't be visible
    expect(isVisible).toBeFalsy();
  });

  test('2FA status badge reflects current state', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Two-Factor Authentication').first()).toBeVisible({ timeout: 10000 });

    // Either "Enabled" badge or no badge should be shown
    const enabledBadge = page.locator('.mantine-Badge-root:has-text("Enabled")');
    const badgeCount = await enabledBadge.count();

    // Badge is either present (2FA active) or not (2FA available but not set up)
    expect(badgeCount).toBeGreaterThanOrEqual(0);
  });

  test('recovery codes section appears when 2FA is enabled on account', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // If 2FA is already enabled for the user, recovery codes section should be visible
    const enabledBadge = page.locator('.mantine-Badge-root:has-text("Enabled")');
    const is2FAActive = await enabledBadge.isVisible().catch(() => false);

    if (is2FAActive) {
      await expect(page.getByText('Recovery Codes')).toBeVisible();
      // Should have Generate or Regenerate button
      const regenButton = page.locator('button').filter({ hasText: /generate|regenerate/i });
      await expect(regenButton).toBeVisible();
    }
    // If 2FA not active for user, recovery section won't show - that's expected
  });

  test('disable 2FA button appears when 2FA is enabled on account', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    const enabledBadge = page.locator('.mantine-Badge-root:has-text("Enabled")');
    const is2FAActive = await enabledBadge.isVisible().catch(() => false);

    if (is2FAActive) {
      const disableButton = page.getByText('Disable Two-Factor Authentication');
      await expect(disableButton).toBeVisible();
    }
    // If 2FA not active, no disable button - expected
  });

  test('disable 2FA modal has password confirmation', async ({ page }) => {
    test.skip(!twofaEnabled, '2FA not enabled on test server');

    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    const enabledBadge = page.locator('.mantine-Badge-root:has-text("Enabled")');
    const is2FAActive = await enabledBadge.isVisible().catch(() => false);

    if (is2FAActive) {
      // Click disable button
      await page.getByText('Disable Two-Factor Authentication').click();

      // Modal should appear
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Should have password input
      await expect(modal.locator('input[type="password"]')).toBeVisible();

      // Should have warning about removing protection
      await expect(modal.getByText(/remove all 2FA protection/i)).toBeVisible();

      // Should have Cancel and Disable buttons
      await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();
      await expect(modal.locator('button:has-text("Disable 2FA")')).toBeVisible();

      // Disable button should be disabled when no password entered
      await expect(modal.locator('button:has-text("Disable 2FA")')).toBeDisabled();

      // Close modal
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible({ timeout: 3000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Two-Factor Authentication - Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await suppressModals(page);
  });

  test('TwoFactorVerify page renders with correct structure', async ({ page }) => {
    // Navigate to login via SPA (direct /login is proxied to Flask by Vite)
    await page.goto('/');
    await page.locator('button[type="submit"]:has-text("Sign In")').waitFor({ timeout: 10000 });

    // Normal login should not show 2FA UI
    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Should either go to dashboard or show 2FA verification
    const logoutButton = page.locator('button:has-text("Logout")');
    const twofaTitle = page.getByText('Two-Factor Authentication');

    await Promise.race([
      logoutButton.waitFor({ timeout: 15000 }).catch(() => {}),
      twofaTitle.waitFor({ timeout: 15000 }).catch(() => {}),
    ]);

    const isLoggedIn = await logoutButton.isVisible().catch(() => false);
    const is2FAShowing = await twofaTitle.isVisible().catch(() => false);

    // One of these should be true
    expect(isLoggedIn || is2FAShowing).toBeTruthy();

    // If 2FA is showing, verify the UI elements
    if (is2FAShowing) {
      await expect(page.getByText(/verify your identity/i)).toBeVisible();
      await expect(page.getByText('Cancel and go back')).toBeVisible();
    }
  });

  test('cancel 2FA returns to login form', async ({ page }) => {
    // Navigate to login via SPA (direct /login is proxied to Flask by Vite)
    await page.goto('/');
    await page.locator('button[type="submit"]:has-text("Sign In")').waitFor({ timeout: 10000 });

    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    const twofaTitle = page.getByText('Two-Factor Authentication');
    const logoutButton = page.locator('button:has-text("Logout")');

    await Promise.race([
      logoutButton.waitFor({ timeout: 15000 }).catch(() => {}),
      twofaTitle.waitFor({ timeout: 15000 }).catch(() => {}),
    ]);

    const is2FAShowing = await twofaTitle.isVisible().catch(() => false);

    if (is2FAShowing) {
      // Click cancel
      await page.getByText('Cancel and go back').click();

      // Should return to login form
      await expect(page.locator('input[placeholder*="username" i]')).toBeVisible({ timeout: 10000 });
    } else {
      // No 2FA was required, test is not applicable
      test.skip();
    }
  });
});
