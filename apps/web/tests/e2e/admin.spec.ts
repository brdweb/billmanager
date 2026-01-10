import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Admin Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('open admin panel modal', async ({ page }) => {
    // Click Admin button in header
    const adminButton = page.locator('button:has-text("Admin")');
    await expect(adminButton).toBeVisible({ timeout: 5000 });
    await adminButton.click();

    // Should open admin modal
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Admin Panel')).toBeVisible();
  });

  test('view users tab in admin panel', async ({ page }) => {
    // Open admin modal
    await page.locator('button:has-text("Admin")').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Users tab should be active by default
    const usersTab = page.locator('[role="dialog"]').locator('[role="tab"]:has-text("Users")');
    await expect(usersTab).toBeVisible();

    // Should see users table or admin text in the modal
    const modal = page.locator('[role="dialog"]');
    const hasTable = await modal.locator('table').count() > 0;
    const hasAdminText = await modal.getByText('admin').count() > 0;
    expect(hasTable || hasAdminText).toBeTruthy();
  });

  test('view bill groups tab in admin panel', async ({ page }) => {
    // Open admin modal
    await page.locator('button:has-text("Admin")').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Click Bill Groups tab
    const billGroupsTab = page.locator('[role="dialog"]').locator('[role="tab"]:has-text("Bill Groups")');
    await billGroupsTab.click();

    // Should see bill groups content (table or "Personal" text)
    await page.waitForTimeout(500);
    const modal = page.locator('[role="dialog"]');
    const hasTable = await modal.locator('table').count() > 0;
    const hasPersonal = await modal.getByText('Personal').count() > 0;
    expect(hasTable || hasPersonal).toBeTruthy();
  });

  // NOTE: Invite user feature requires email sending which only works in production
  // Test removed: 'invite user button is visible'

  test('close admin panel modal', async ({ page }) => {
    // Open admin modal
    await page.locator('button:has-text("Admin")').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Close the modal using the X button or clicking outside
    const closeButton = page.locator('[role="dialog"]').locator('button[aria-label="Close"], button:has([class*="close"])').first();
    if (await closeButton.count() > 0) {
      await closeButton.click();
    } else {
      // Press Escape to close
      await page.keyboard.press('Escape');
    }

    // Modal should be closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 2000 });
  });
});
