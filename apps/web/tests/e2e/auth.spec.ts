import { test, expect } from '@playwright/test';
import { suppressModals } from './helpers';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress modals but don't auto-login - auth tests manage their own login flow
    await suppressModals(page);
    await page.goto('/');
    await page.locator('button[type="submit"]:has-text("Sign In")').waitFor({ timeout: 10000 });
  });

  test('successful login flow', async ({ page }) => {
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible({ timeout: 10000 });

    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Should see logged-in UI
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Should see dashboard content
    await expect(page.getByText(/dashboard|upcoming|overdue|total/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('failed login with invalid credentials', async ({ page }) => {
    await page.fill('input[placeholder*="username" i]', 'invalid_user');
    await page.fill('input[placeholder*="password" i]', 'wrong_password');
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Should show error message
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[role="alert"]').filter({ hasText: /invalid/i })).toBeVisible();

    // Should still be on login page
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible();
  });

  test('empty credentials validation', async ({ page }) => {
    await page.click('button[type="submit"]:has-text("Sign In")');

    await page.waitForTimeout(1000);
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible();
  });

  test('logout functionality', async ({ page }) => {
    // Login first
    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Click logout
    await page.click('button:has-text("Logout")');

    // Should show login form again
    await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible({ timeout: 10000 });
  });

  test('session persistence after page reload', async ({ page }) => {
    await page.fill('input[placeholder*="username" i]', 'admin');
    await page.fill('input[placeholder*="password" i]', 'admin');
    await page.click('button[type="submit"]:has-text("Sign In")');

    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });

    // Reload page
    await page.reload();

    // Should still be logged in
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });
  });

  test('protected routes redirect to login', async ({ page, context }) => {
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());

    await page.goto('/bills');

    const pageContent = await page.content();
    const hasAuthError = pageContent.includes('Authentication required') || pageContent.includes('error');
    const hasLoginForm = await page.locator('button[type="submit"]:has-text("Sign In")').isVisible().catch(() => false);

    expect(hasAuthError || hasLoginForm).toBeTruthy();
  });
});
