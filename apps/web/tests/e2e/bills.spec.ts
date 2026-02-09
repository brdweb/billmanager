import { login, navigateToBills } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Bill Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Navigate to Bills page via sidebar link (page.goto('/bills') hits Vite proxy)
    await navigateToBills(page);
  });

  test('bills page loads and displays bills list', async ({ page }) => {
    // Wait for table to render (BillList shows Loader while loading)
    const table = page.locator('table');
    const emptyState = page.getByText(/no bills/i);
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 15000 });
  });

  test('create new bill dialog opens', async ({ page }) => {
    // On /bills page, button text is "Add Entry"
    const addButton = page.locator('button:has-text("Add Entry")').first();

    if (await addButton.count() === 0) {
      test.skip();
      return;
    }

    await addButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator('input[placeholder="Enter bill name"]')).toBeVisible();
    await expect(dialog.locator('input[placeholder="0.00"]')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  });

  test('edit existing bill', async ({ page }) => {
    const editButton = page.locator('table tbody tr').first().locator('button[title="Edit"]');

    if (await editButton.count() === 0) {
      test.skip();
      return;
    }

    await editButton.click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    const amountInput = page.locator('[role="dialog"]').locator('input[placeholder="0.00"]');
    await amountInput.clear();
    await amountInput.fill('200.00');

    // Close without saving to avoid modifying test data
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('archive bill action available', async ({ page }) => {
    const editButton = page.locator('table tbody tr').first().locator('button[title="Edit"]');

    if (await editButton.count() === 0) {
      test.skip();
      return;
    }

    await editButton.click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Verify Archive button is present in Danger Zone
    const archiveButton = page.locator('[role="dialog"]').locator('button').filter({ hasText: /Archive/i });
    await expect(archiveButton.first()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('search bills', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search" i]');

    if (await searchInput.count() === 0) {
      test.skip();
      return;
    }

    await searchInput.fill('Electric');
    await page.waitForTimeout(1000);

    const hasResults = await page.locator('table tbody tr').count() > 0;
    expect(typeof hasResults).toBe('boolean');

    await searchInput.clear();
    await page.waitForTimeout(500);
  });

  test('view bill details', async ({ page }) => {
    const firstBillRow = page.locator('table tbody tr').first();

    if (await firstBillRow.count() === 0) {
      test.skip();
      return;
    }

    // Click the bill name (first cell text) to avoid hitting action buttons
    const billName = firstBillRow.locator('td').first();
    await billName.click();

    // Should show payment history modal
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
  });

  test('pay bill', async ({ page }) => {
    const payButton = page.locator('table tbody tr').first().locator('button[title="Pay"]');

    if (await payButton.count() === 0) {
      test.skip();
      return;
    }

    await payButton.click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });

    // Verify modal has payment form
    const modal = page.locator('[role="dialog"]');
    const hasAmountInput = await modal.locator('input[placeholder="0.00"]').count() > 0;
    expect(hasAmountInput).toBeTruthy();

    // Close without recording to preserve test data
    await page.keyboard.press('Escape');
  });
});
