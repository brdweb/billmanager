import { test, expect } from '@playwright/test';

test.describe('Bill Management', () => {
  // Uses shared auth state from auth.setup.ts - no login needed
  test.beforeEach(async ({ page }) => {
    // Navigate to the app - already authenticated via storageState
    await page.goto('/');
    // Wait for dashboard to be fully loaded (auth state should already be present)
    await expect(page.locator('button:has-text("Logout")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('h6').filter({ hasText: /Dashboard|Bills/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('bills page loads and displays bills list', async ({ page }) => {
    // Wait for data to load - table should appear
    await page.waitForTimeout(500);
    // Should see table or list of bills
    const hasBills = await page.locator('table, [role="table"], [role="grid"]').count() > 0 ||
                     await page.locator('[data-testid*="bill"], [class*="bill-item"]').count() > 0;
    expect(hasBills).toBeTruthy();
  });

  test('create new bill', async ({ page }) => {
    // Click "Add Entry" button (main button in the UI)
    const addButton = page.locator('button:has-text("Add Entry")').first();
    await addButton.click();

    // Should open Add Bill dialog
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Fill in bill details
    const billName = `Test Bill ${Date.now()}`;

    // Fill Bill Name (textbox with placeholder "Enter bill name")
    await page.locator('[role="dialog"]').locator('input[placeholder="Enter bill name"]').fill(billName);

    // Fill Amount (textbox with placeholder "0.00")
    await page.locator('[role="dialog"]').locator('input[placeholder="0.00"]').fill('150.00');

    // Select due date - click on the date picker button and select the 15th
    const datePickerButton = page.locator('[role="dialog"]').locator('button:has-text("Select date")');
    await datePickerButton.click();

    // Wait for date picker popover to open
    await page.waitForTimeout(500);

    // Find the date picker dialog (it's a separate dialog from the main Add Bill dialog)
    // Click on the 15th - the button has accessible name "15 January 2026"
    const dateCell = page.getByRole('button', { name: '15 January 2026' });
    await dateCell.click();

    // Click "Add Bill" button to submit
    await page.locator('[role="dialog"]').locator('button:has-text("Add Bill")').click();

    // Wait for success message (toast notification)
    await expect(page.locator('text=Bill created successfully')).toBeVisible({ timeout: 5000 });

    // Dialog should be closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 2000 });
  });

  test('edit existing bill', async ({ page }) => {
    // Find first data row (skip header row using nth)
    const firstBillRow = page.getByRole('row').nth(1);

    // Click Edit button (icon button with aria-label)
    await firstBillRow.getByRole('button', { name: 'Edit' }).click();

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
    // Find first bill row and click Edit
    const firstBillRow = page.getByRole('row').nth(1);
    await firstBillRow.getByRole('button', { name: 'Edit' }).click();

    // Should open edit dialog
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Verify Archive button is present in Danger Zone
    const archiveButton = page.locator('[role="dialog"]').getByRole('button', { name: 'Archive' });
    await expect(archiveButton).toBeVisible();

    // Verify Delete Permanently button is present
    const deleteButton = page.locator('[role="dialog"]').getByRole('button', { name: 'Delete Permanently' });
    await expect(deleteButton).toBeVisible();

    // Close dialog
    await page.locator('[role="dialog"]').locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(500);
  });

  test('search bills', async ({ page }) => {
    // Use the Search input field
    const searchInput = page.locator('input[placeholder*="Search" i]');

    // Fill search term
    await searchInput.fill('Electric');

    // Wait for results to filter
    await page.waitForTimeout(1000);

    // Should see filtered results showing Electric bill
    const electricVisible = await page.locator('text=Electric').first().isVisible();
    expect(electricVisible).toBeTruthy();

    // Clear search
    await searchInput.clear();
    await page.waitForTimeout(500);
  });

  test('view bill details', async ({ page }) => {
    // Click on first bill row to view details (click the name cell)
    const firstBillRow = page.getByRole('row').nth(1);
    const firstBillNameCell = firstBillRow.getByRole('cell').first();
    await firstBillNameCell.click();

    // Should show bill details in a modal
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('pay bill', async ({ page }) => {
    // Find first bill row (skip header)
    const firstBillRow = page.getByRole('row').nth(1);
    await firstBillRow.hover();

    // Look for "Pay" button (icon button with aria-label)
    const payButton = firstBillRow.getByRole('button', { name: 'Pay' });

    if (await payButton.count() > 0) {
      await payButton.click();

      // Should show payment dialog
      await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

      // Fill payment date if editable
      const dateInput = page.locator('[role="dialog"]').locator('input[type="date"]').first();
      if (await dateInput.count() > 0) {
        await dateInput.fill(new Date().toISOString().split('T')[0]);
      }

      // Submit payment
      await page.locator('[role="dialog"]').locator('button:has-text("Pay"), button:has-text("Save"), button[type="submit"]').first().click();

      // Wait for dialog to close
      await page.waitForTimeout(1000);

      // Dialog should be closed (payment recorded)
      const dialogGone = await page.locator('[role="dialog"]').isVisible().catch(() => false) === false;
      expect(dialogGone).toBeTruthy();
    } else {
      test.skip();
    }
  });
});
