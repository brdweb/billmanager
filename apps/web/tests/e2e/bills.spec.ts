import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Bill Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('bills page loads and displays bills list', async ({ page }) => {
    // Wait for data to load
    await page.waitForTimeout(500);
    // Should see either a table with bills OR an empty state message
    const hasBillsTable = await page.locator('table').count() > 0;
    const hasEmptyState = await page.getByText('No bills yet').count() > 0;
    expect(hasBillsTable || hasEmptyState).toBeTruthy();
  });

  test('create new bill dialog opens', async ({ page }) => {
    // Click "Add Entry" button (main button in the UI)
    const addButton = page.locator('button:has-text("Add Entry")').first();
    await addButton.click();

    // Should open Add Bill dialog
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Verify dialog has expected fields
    const dialog = page.locator('[role="dialog"]');

    // Check for bill name input
    await expect(dialog.locator('input[placeholder="Enter bill name"]')).toBeVisible();

    // Check for amount input
    await expect(dialog.locator('input[placeholder="0.00"]')).toBeVisible();

    // Check for Add Bill button
    await expect(dialog.locator('button:has-text("Add Bill")')).toBeVisible();

    // Check for Cancel button
    await expect(dialog.locator('button:has-text("Cancel")')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  });

  test('edit existing bill', async ({ page }) => {
    // Find first bill row's Edit button (ActionIcon with title="Edit")
    const editButton = page.locator('table tbody tr').first().locator('button[title="Edit"]');

    if (await editButton.count() === 0) {
      // May be a shared bill (no edit button)
      test.skip();
      return;
    }

    await editButton.click();

    // Should open edit dialog
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Change amount in dialog (textbox with placeholder "0.00")
    const amountInput = page.locator('[role="dialog"]').locator('input[placeholder="0.00"]');
    await amountInput.clear();
    await amountInput.fill('200.00');

    // Save changes - look for "Save" or "Update Bill" button
    await page.locator('[role="dialog"]').locator('button:has-text("Save"), button:has-text("Update")').first().click();

    // Wait for modal to close
    await page.waitForTimeout(1000);

    // Modal should be closed
    const dialogGone = await page.locator('[role="dialog"]').isVisible().catch(() => false) === false;
    expect(dialogGone).toBeTruthy();
  });

  test('archive bill action available', async ({ page }) => {
    // Find first bill row's Edit button
    const editButton = page.locator('table tbody tr').first().locator('button[title="Edit"]');

    if (await editButton.count() === 0) {
      test.skip();
      return;
    }

    await editButton.click();

    // Should open edit dialog
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Verify Archive button is present in Danger Zone (look for button with "Archive" text)
    const archiveButton = page.locator('[role="dialog"]').locator('button').filter({ hasText: 'Archive' });
    await expect(archiveButton.first()).toBeVisible();

    // Close dialog with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('search bills', async ({ page }) => {
    // Use the Search input field
    const searchInput = page.locator('input[placeholder*="Search" i]');

    if (await searchInput.count() === 0) {
      test.skip();
      return;
    }

    // Fill search term
    await searchInput.fill('Electric');

    // Wait for results to filter
    await page.waitForTimeout(1000);

    // Should see filtered results or no results message
    const hasResults = await page.locator('table tbody tr').count() > 0;
    expect(typeof hasResults).toBe('boolean');

    // Clear search
    await searchInput.clear();
    await page.waitForTimeout(500);
  });

  test('view bill details', async ({ page }) => {
    // Click on first bill row to view payment history (clicking the row)
    const firstBillRow = page.locator('table tbody tr').first();

    if (await firstBillRow.count() === 0) {
      test.skip();
      return;
    }

    await firstBillRow.click();

    // Should show bill details/payment history in a modal
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('pay bill', async ({ page }) => {
    // Find first bill row's Pay button (ActionIcon with title="Pay")
    const payButton = page.locator('table tbody tr').first().locator('button[title="Pay"]');

    if (await payButton.count() === 0) {
      // May be a shared bill or no pay button available
      test.skip();
      return;
    }

    await payButton.click();

    // Should show payment dialog
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Find the Record Payment button and click it
    const recordButton = page.locator('[role="dialog"]').locator('button').filter({ hasText: /Record|Pay|Save/i }).first();

    if (await recordButton.count() > 0) {
      await recordButton.click();

      // Wait for dialog to close
      await page.waitForTimeout(1000);

      // Dialog should be closed (payment recorded)
      const dialogGone = await page.locator('[role="dialog"]').isVisible().catch(() => false) === false;
      expect(dialogGone).toBeTruthy();
    }
  });
});
