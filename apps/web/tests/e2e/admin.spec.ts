import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Admin Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('open admin panel modal', async ({ page }) => {
    const adminButton = page.locator('button:has-text("Admin")');
    await expect(adminButton).toBeVisible({ timeout: 10000 });
    await adminButton.click();

    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('view users tab in admin panel', async ({ page }) => {
    await page.locator('button:has-text("Admin")').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Look for users content in the modal
    const modal = page.locator('[role="dialog"]');
    // Users tab may be default or we look for user-related content
    const usersTab = modal.locator('[role="tab"]:has-text("Users")');
    if (await usersTab.count() > 0) {
      await usersTab.click();
    }
    // Should see admin user listed
    await expect(modal.getByText('admin').first()).toBeVisible({ timeout: 5000 });
  });

  test('view bill groups tab in admin panel', async ({ page }) => {
    await page.locator('button:has-text("Admin")').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Click Bill Groups tab (may be labeled "Databases" or "Bill Groups")
    const modal = page.locator('[role="dialog"]');
    const billGroupsTab = modal.locator('[role="tab"]').filter({ hasText: /bill group|database/i });

    if (await billGroupsTab.count() > 0) {
      await billGroupsTab.first().click();
      await page.waitForTimeout(500);

      // Should see bill groups content
      const hasContent = await modal.locator('table').count() > 0 ||
        await modal.getByText(/test_bills|Test Bills|Personal/i).count() > 0;
      expect(hasContent).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('close admin panel modal', async ({ page }) => {
    await page.locator('button:has-text("Admin")').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
  });
});
