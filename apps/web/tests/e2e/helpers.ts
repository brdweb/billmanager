import { Page, expect } from '@playwright/test';

/**
 * Helper function to login to the application
 * When using storageState (shared auth), this just navigates and verifies auth.
 * For fresh logins (like auth.spec.ts), it performs full login flow.
 */
export async function login(page: Page, username: string = 'admin', password: string = 'admin') {
  await page.goto('/');

  // Check if already logged in (storageState scenario)
  const logoutButton = page.locator('button:has-text("Logout")');
  const signInButton = page.locator('button[type="submit"]:has-text("Sign In")');

  // Wait for either login form or logout button to appear
  await Promise.race([
    logoutButton.waitFor({ timeout: 5000 }).catch(() => {}),
    signInButton.waitFor({ timeout: 5000 }).catch(() => {}),
  ]);

  // If already logged in, just verify and dismiss telemetry dialog if present
  if (await logoutButton.isVisible().catch(() => false)) {
    await expect(logoutButton).toBeVisible({ timeout: 5000 });

    // Dismiss telemetry dialog if it appears
    const telemetryDialog = page.locator('[role="dialog"]:has-text("Usage Statistics")');
    if (await telemetryDialog.isVisible().catch(() => false)) {
      const optOutButton = telemetryDialog.locator('button:has-text("Opt Out")');
      if (await optOutButton.isVisible().catch(() => false)) {
        await optOutButton.click();
      }
      await expect(telemetryDialog).not.toBeVisible({ timeout: 5000 });
    }
    return;
  }

  // Otherwise, perform full login
  await signInButton.waitFor({ timeout: 10000 });
  await page.fill('input[placeholder*="username" i]', username);
  await page.fill('input[placeholder*="password" i]', password);
  await page.click('button[type="submit"]:has-text("Sign In")');
  await expect(logoutButton).toBeVisible({ timeout: 15000 });

  // Dismiss telemetry dialog if it appears
  const telemetryDialog = page.locator('[role="dialog"]:has-text("Usage Statistics")');
  if (await telemetryDialog.isVisible().catch(() => false)) {
    // Click "Opt Out" or "Accept & Continue" button to dismiss
    const optOutButton = telemetryDialog.locator('button:has-text("Opt Out")');
    if (await optOutButton.isVisible().catch(() => false)) {
      await optOutButton.click();
    }
    // Wait for dialog to close
    await expect(telemetryDialog).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Helper to wait for navigation and load state
 */
export async function waitForNavigation(page: Page, urlPattern?: RegExp) {
  if (urlPattern) {
    await page.waitForURL(urlPattern, { timeout: 10000 });
  }
  await page.waitForLoadState('domcontentloaded');
}
