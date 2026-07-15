import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Admin Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('open admin settings page', async ({ page }) => {
    const adminButton = page.locator('button:has-text("Admin")');
    await expect(adminButton).toBeVisible({ timeout: 10000 });
    await adminButton.click();

    await expect(page).toHaveURL(/\/settings\?tab=users/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
  });

  test('view users tab in settings page', async ({ page }) => {
    await page.locator('button:has-text("Admin")').click();
    await expect(page).toHaveURL(/\/settings\?tab=users/);

    const usersTab = page.locator('[role="tab"]:has-text("Users")');
    await expect(usersTab).toHaveAttribute('aria-selected', 'true');
    // Should see admin user listed
    await expect(page.getByText('admin').first()).toBeVisible({ timeout: 5000 });
  });

  test('view bill groups tab in settings page', async ({ page }) => {
    await page.locator('button:has-text("Admin")').click();
    await expect(page).toHaveURL(/\/settings\?tab=users/);

    const billGroupsTab = page.locator('[role="tab"]').filter({ hasText: /bill group|database/i });

    if (await billGroupsTab.count() > 0) {
      await billGroupsTab.first().click();
      await page.waitForTimeout(500);

      // Should see bill groups content
      const hasContent = await page.locator('table').count() > 0 ||
        await page.getByText(/test_bills|Test Bills|Personal/i).count() > 0;
      expect(hasContent).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('admin settings page participates in browser navigation', async ({ page }) => {
    await page.locator('button:has-text("Admin")').click();
    await expect(page).toHaveURL(/\/settings\?tab=users/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
});
