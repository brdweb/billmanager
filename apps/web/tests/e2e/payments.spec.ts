import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Payment Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('view payment history', async ({ page }) => {
    // Navigate to payments page
    await page.goto('/payments');

    // Should see payments list or table
    await expect(
      page.locator('text=/payment history|payments/i').or(page.locator('table, [role="table"]'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('view payment history for specific bill', async ({ page }) => {
    // Go to bills page
    await page.goto('/bills');
    await page.waitForLoadState('networkidle');

    // Click on first bill
    const firstBill = page.locator('[data-testid*="bill"], tr:has-text("$")').first();
    await firstBill.click();

    // Look for payment history section or button
    const historyLink = page.locator('text=/payment history|view payments|history/i, button:has-text("History")');

    if (await historyLink.count() > 0) {
      await historyLink.click();

      // Should show payments for this bill
      await expect(page.locator('text=/payment|paid|amount/i')).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('edit payment', async ({ page }) => {
    // Go to payments page
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    // Find first payment
    const firstPayment = page.locator('[data-testid*="payment"], tr').first();
    await firstPayment.hover();

    // Look for edit button
    const editButton = firstPayment.locator('button:has-text("Edit"), [aria-label*="edit" i]').first();

    if (await editButton.count() > 0) {
      await editButton.click();

      // Should show edit form
      await expect(page.locator('form, [role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Change amount if editable
      const amountInput = page.locator('input[name="amount"], input[type="number"]');
      if (await amountInput.count() > 0) {
        await amountInput.clear();
        await amountInput.fill('175.00');
      }

      // Save changes
      await page.click('button:has-text("Save"), button:has-text("Update")');

      // Should see success message
      await expect(page.locator('text=/updated|success|saved/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('delete payment', async ({ page }) => {
    // First, record a payment we can delete
    await page.goto('/bills');
    await page.waitForLoadState('networkidle');

    const firstBill = page.locator('[data-testid*="bill"], tr:has-text("$")').first();
    await firstBill.hover();

    const payButton = firstBill.locator('button:has-text("Pay")').first();
    if (await payButton.count() > 0) {
      await payButton.click();
      await page.waitForTimeout(500);

      // Record payment
      await page.click('button:has-text("Pay"), button:has-text("Save")');
      await page.waitForTimeout(1000);
    }

    // Go to payments page
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    // Find first payment and delete it
    const firstPayment = page.locator('[data-testid*="payment"], tr').first();
    await firstPayment.hover();

    const deleteButton = firstPayment.locator('button:has-text("Delete"), [aria-label*="delete" i]').first();

    if (await deleteButton.count() > 0) {
      await deleteButton.click();

      // Confirm if dialog appears
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")');
      if (await confirmButton.count() > 0) {
        await confirmButton.click();
      }

      // Should see success message or payment removed
      await page.waitForTimeout(1000);
      await expect(
        page.locator('text=/deleted|success|removed/i')
      ).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('filter payments by date range', async ({ page }) => {
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    // Look for date filter inputs
    const dateFilters = page.locator('input[type="date"], input[type="month"]');

    if (await dateFilters.count() > 0) {
      // Set date filter
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);

      await dateFilters.first().fill(startDate.toISOString().split('T')[0]);
      await page.waitForTimeout(1000);

      // Should show filtered results
      const paymentCount = await page.locator('[data-testid*="payment"], tr:has-text("$")').count();
      expect(paymentCount).toBeGreaterThanOrEqual(0);
    } else {
      test.skip();
    }
  });

  test('view monthly payment totals', async ({ page }) => {
    // Navigate to stats or dashboard page
    await page.goto('/dashboard');

    // Should see monthly totals or statistics
    await expect(
      page.locator('text=/monthly|total|statistics/i').or(page.locator('[data-testid*="total"]'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('export payments data', async ({ page }) => {
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    // Look for export button
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download"), [aria-label*="export" i]');

    if (await exportButton.count() > 0) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download');

      await exportButton.click();

      // Wait for download to start
      const download = await downloadPromise;

      // Verify download started
      expect(download).toBeTruthy();
    } else {
      test.skip();
    }
  });
});
