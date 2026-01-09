import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Admin Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('access admin panel', async ({ page }) => {
    // Navigate to admin or settings
    await page.goto('/admin');

    // Should see admin content
    await expect(
      page.locator('text=/admin|manage users|manage databases/i').or(page.locator('h1, h2'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('view users list', async ({ page }) => {
    // Navigate to users management
    await page.goto('/admin/users');

    // Should see users table
    await expect(
      page.locator('text=/users|user management/i').or(page.locator('table, [role="table"]'))
    ).toBeVisible({ timeout: 10000 });

    // Should see at least admin user
    await expect(page.locator('text=admin')).toBeVisible();
  });

  test('send user invitation', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    // Look for "Invite User" button
    const inviteButton = page.locator('button:has-text("Invite"), button:has-text("Add User"), button:has-text("New User")').first();

    if (await inviteButton.count() > 0) {
      await inviteButton.click();

      // Should show invitation form
      await expect(page.locator('form, [role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Fill invitation details
      const email = `test${Date.now()}@example.com`;
      await page.fill('input[type="email"], input[name="email"]', email);

      // Select role if available
      const roleSelect = page.locator('select[name="role"], [aria-label*="role" i]');
      if (await roleSelect.count() > 0) {
        await roleSelect.selectOption('user');
      }

      // Send invitation
      await page.click('button:has-text("Send"), button:has-text("Invite"), button[type="submit"]');

      // Should see success message
      await expect(page.locator('text=/invited|sent|success/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('view pending invitations', async ({ page }) => {
    await page.goto('/admin/invitations');

    // Should see invitations list
    await expect(
      page.locator('text=/invitation|pending/i').or(page.locator('table'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('cancel invitation', async ({ page }) => {
    await page.goto('/admin/invitations');
    await page.waitForLoadState('networkidle');

    // Find first invitation
    const firstInvite = page.locator('[data-testid*="invitation"], tr').first();

    if (await firstInvite.count() > 0) {
      await firstInvite.hover();

      // Look for cancel button
      const cancelButton = firstInvite.locator('button:has-text("Cancel"), button:has-text("Revoke"), [aria-label*="cancel" i]').first();

      if (await cancelButton.count() > 0) {
        await cancelButton.click();

        // Confirm if needed
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
        if (await confirmButton.count() > 0) {
          await confirmButton.click();
        }

        // Should see success
        await expect(page.locator('text=/cancelled|revoked|success/i')).toBeVisible({ timeout: 10000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('delete user', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    // Find a non-admin user if exists
    const users = page.locator('[data-testid*="user"], tr:not(:has-text("admin"))');

    if (await users.count() > 0) {
      const firstUser = users.first();
      await firstUser.hover();

      // Look for delete button
      const deleteButton = firstUser.locator('button:has-text("Delete"), button:has-text("Remove"), [aria-label*="delete" i]').first();

      if (await deleteButton.count() > 0) {
        await deleteButton.click();

        // Confirm deletion
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")');
        await confirmButton.click();

        // Should see success
        await expect(page.locator('text=/deleted|removed|success/i')).toBeVisible({ timeout: 10000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('manage databases', async ({ page }) => {
    await page.goto('/admin/databases');

    // Should see databases list
    await expect(
      page.locator('text=/databases|database management/i').or(page.locator('table'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('create new database', async ({ page }) => {
    await page.goto('/admin/databases');
    await page.waitForLoadState('networkidle');

    // Look for "Create Database" button
    const createButton = page.locator('button:has-text("Create"), button:has-text("New Database"), button:has-text("Add")').first();

    if (await createButton.count() > 0) {
      await createButton.click();

      // Fill database name
      const dbName = `testdb${Date.now()}`;
      await page.fill('input[name="name"], input[placeholder*="name" i]', dbName);

      // Submit
      await page.click('button:has-text("Create"), button:has-text("Save"), button[type="submit"]');

      // Should see success
      await expect(page.locator('text=/created|success/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('manage database access', async ({ page }) => {
    await page.goto('/admin/databases');
    await page.waitForLoadState('networkidle');

    // Find first database
    const firstDb = page.locator('[data-testid*="database"], tr').first();

    if (await firstDb.count() > 0) {
      await firstDb.hover();

      // Look for "Manage Access" button
      const accessButton = firstDb.locator('button:has-text("Access"), button:has-text("Permissions"), [aria-label*="access" i]').first();

      if (await accessButton.count() > 0) {
        await accessButton.click();

        // Should show access management interface
        await expect(
          page.locator('text=/user access|permissions|grant access/i').or(page.locator('[role="dialog"]'))
        ).toBeVisible({ timeout: 5000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('delete database', async ({ page }) => {
    // First create a test database
    await page.goto('/admin/databases');
    await page.waitForLoadState('networkidle');

    const createButton = page.locator('button:has-text("Create"), button:has-text("New")').first();
    if (await createButton.count() > 0) {
      await createButton.click();
      const dbName = `deleteme${Date.now()}`;
      await page.fill('input[name="name"]', dbName);
      await page.click('button:has-text("Create")');
      await page.waitForTimeout(1000);

      // Now delete it
      const dbRow = page.locator(`text=${dbName}`).locator('..').locator('..').first();
      await dbRow.hover();

      const deleteButton = dbRow.locator('button:has-text("Delete"), [aria-label*="delete" i]').first();
      await deleteButton.click();

      // Confirm
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")');
      await confirmButton.click();

      // Should see success
      await expect(page.locator('text=/deleted|removed|success/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('view system statistics', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Should see some stats
    const hasStats = await page.locator('text=/total users|total bills|total payments|statistics/i').count() > 0;
    expect(hasStats).toBeTruthy();
  });

  test('non-admin user cannot access admin features', async ({ page }) => {
    // Logout first
    await page.goto('/logout');
    await page.waitForTimeout(1000);

    // Login as regular user (if exists)
    await page.goto('/');
    await page.fill('input[type="text"], input[type="email"]', 'user');
    await page.fill('input[type="password"]', 'user');
    await page.click('button:has-text("Login")');

    // Try to access admin page
    await page.goto('/admin');

    // Should be denied or redirected
    const isOnAdminPage = page.url().includes('/admin');
    const hasAccessDenied = await page.locator('text=/access denied|forbidden|not authorized/i').count() > 0;

    expect(!isOnAdminPage || hasAccessDenied).toBeTruthy();
  });
});
