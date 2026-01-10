import { test as setup, expect } from '@playwright/test';

const authFile = '/tmp/billmanager-test-results/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('/');

  // Wait for login form
  await page.locator('button[type="submit"]:has-text("Sign In")').waitFor({ timeout: 10000 });

  // Fill credentials
  await page.fill('input[placeholder*="username" i]', 'admin');
  await page.fill('input[placeholder*="password" i]', 'admin');

  // Submit login
  await page.click('button[type="submit"]:has-text("Sign In")');

  // Wait for successful login
  await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

  // Wait for main content to load (table with bills)
  await page.waitForLoadState('networkidle');

  // Save storage state (localStorage, sessionStorage, cookies)
  await page.context().storageState({ path: authFile });
});
