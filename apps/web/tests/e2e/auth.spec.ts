import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh on login page
    await page.goto('/');
    // Wait for login form to be ready instead of networkidle
    await page.locator('button[type="submit"]:has-text("Sign In")').waitFor({ timeout: 10000 });
  });

  test('successful login flow', async ({ page }) => {
    // Wait for login form to be visible (check for submit button specifically)
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible({ timeout: 10000 });

    // Fill login form - Mantine inputs need different selectors
    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');

    // Submit login (use specific submit button selector)
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Should see logged-in UI (Logout button appears after successful login)
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Should see dashboard or bills content (check for Dashboard heading - first match)
    await expect(page.locator('h6').filter({ hasText: /Dashboard|Bills/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('failed login with invalid credentials', async ({ page }) => {
    // Try to login with wrong credentials
    await page.fill('input[placeholder*="username" i]', 'invalid_user');
    await page.fill('input[placeholder*="password" i]', 'wrong_password');

    await page.click('button[type="submit"]:has-text("Sign In")');

    // Should show error message (check for alert role element containing error text)
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[role="alert"]').filter({ hasText: /invalid/i })).toBeVisible();

    // Should still be on login page (login form should still be visible)
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible();
  });

  test('empty credentials validation', async ({ page }) => {
    // Try to submit empty form
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Should show validation errors or not submit (check form is still visible)
    await page.waitForTimeout(1000);
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible();
  });

  test('logout functionality', async ({ page }) => {
    // Login first
    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Wait for successful login (Logout button appears)
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Click logout
    await page.click('button:has-text("Logout")');

    // Should show login form again after logout
    await expect(page.locator('input[placeholder*="password" i]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible();
  });

  test('session persistence after page reload', async ({ page }) => {
    // Login
    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Wait for successful login
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Reload page
    await page.reload();

    // Should still be logged in (Logout button should reappear after reload)
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Should NOT see login form
    const loginFormVisible = await page.locator('button[type="submit"]:has-text("Sign In")').isVisible().catch(() => false);
    expect(loginFormVisible).toBeFalsy();
  });

  test('protected routes redirect to login', async ({ page, context }) => {
    // Clear any existing auth state from previous tests
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Try to access protected route directly without being logged in
    await page.goto('/bills');

    // App should either:
    // 1. Show login form (redirected to login page)
    // 2. Show authentication error (JSON error response)
    const pageContent = await page.content();
    const hasAuthError = pageContent.includes('Authentication required') || pageContent.includes('error');
    const hasLoginForm = await page.locator('button[type="submit"]:has-text("Sign In")').isVisible().catch(() => false);

    // Either should be true (app prevents unauthorized access)
    expect(hasAuthError || hasLoginForm).toBeTruthy();

    // Should NOT see dashboard/bills content (logout button)
    const logoutVisible = await page.locator('button:has-text("Logout")').isVisible().catch(() => false);
    expect(logoutVisible).toBeFalsy();
  });
});
