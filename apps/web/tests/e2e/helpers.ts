import { Page, expect } from '@playwright/test';

/**
 * Dismiss any blocking modals (Release Notes, Telemetry) that appear after login.
 */
async function dismissModals(page: Page) {
  // Dismiss Release Notes modal if it appears
  const releaseNotesModal = page.locator('[role="dialog"]:has-text("Release Notes")');
  if (await releaseNotesModal.isVisible({ timeout: 2000 }).catch(() => false)) {
    const closeButton = releaseNotesModal.locator('button:has-text("Close")');
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(releaseNotesModal).not.toBeVisible({ timeout: 3000 });
  }

  // Dismiss telemetry dialog if it appears
  const telemetryDialog = page.locator('[role="dialog"]:has-text("Usage Statistics")');
  if (await telemetryDialog.isVisible().catch(() => false)) {
    const optOutButton = telemetryDialog.locator('button:has-text("Opt Out")');
    if (await optOutButton.isVisible().catch(() => false)) {
      await optOutButton.click();
    }
    await expect(telemetryDialog).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Suppress the Release Notes and Telemetry modals by setting localStorage
 * before the page loads. Call this before navigating to a page.
 */
export async function suppressModals(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('billmanager_seen_version', '3.8.1');
  });
}

/**
 * Helper function to login to the application.
 * Suppresses release notes and telemetry modals automatically.
 */
export async function login(page: Page, username: string = 'admin', password: string = 'admin') {
  // Suppress modals before page load
  await suppressModals(page);

  await page.goto('/');

  const logoutButton = page.locator('button:has-text("Logout")');
  const signInButton = page.locator('button[type="submit"]:has-text("Sign In")');

  // Wait for either login form or logout button to appear
  await Promise.race([
    logoutButton.waitFor({ timeout: 5000 }).catch(() => {}),
    signInButton.waitFor({ timeout: 5000 }).catch(() => {}),
  ]);

  // If already logged in, verify and return
  if (await logoutButton.isVisible().catch(() => false)) {
    await dismissModals(page);
    return;
  }

  // Otherwise, perform full login
  await signInButton.waitFor({ timeout: 10000 });
  await page.fill('input[placeholder*="username" i]', username);
  await page.fill('input[placeholder*="password" i]', password);
  await page.click('button[type="submit"]:has-text("Sign In")');
  await expect(logoutButton).toBeVisible({ timeout: 15000 });

  // Dismiss any modals that appear after login
  await dismissModals(page);
}

/**
 * Navigate to the Bills page using sidebar link (client-side routing).
 * Direct page.goto('/bills') hits the Vite proxy which forwards to Flask API.
 * This helper clicks the sidebar NavLink instead, triggering React Router navigation.
 */
export async function navigateToBills(page: Page) {
  const billsLink = page.locator('[class*="NavLink"]').filter({ hasText: /^Bills$/ }).first();
  await billsLink.click();
  await page.waitForURL(/\/bills/, { timeout: 5000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
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
