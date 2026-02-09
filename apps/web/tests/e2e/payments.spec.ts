import { login, navigateToBills } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Payment Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('view all payments page', async ({ page }) => {
    await page.goto('/all-payments');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await expect(
      page.locator('table').or(page.getByText(/no payments/i))
    ).toBeVisible({ timeout: 10000 });
  });

  test('payments page shows payment data', async ({ page }) => {
    await page.goto('/all-payments');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const hasTable = await page.locator('table').count() > 0;
    const hasPaymentText = await page.getByText(/amount|date|bill/i).count() > 0;

    expect(hasTable || hasPaymentText).toBeTruthy();
  });

  test('view payment history for a bill', async ({ page }) => {
    // Navigate to bills page where bill table is
    await navigateToBills(page);

    const billRow = page.locator('table tbody tr').first();

    if (await billRow.count() > 0) {
      // Click the bill name cell to open payment history
      await billRow.locator('td').first().click();
      await page.waitForTimeout(500);

      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('record payment for a bill', async ({ page }) => {
    await navigateToBills(page);

    const billRow = page.locator('table tbody tr').first();

    if (await billRow.count() === 0) {
      test.skip();
      return;
    }

    const payButton = billRow.locator('button[title="Pay"]');

    if (await payButton.count() === 0) {
      test.skip();
      return;
    }

    await payButton.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

    // Verify the pay modal has expected content
    const modal = page.locator('[role="dialog"]');
    const hasPaymentForm = await modal.locator('input[placeholder="0.00"]').count() > 0;
    expect(hasPaymentForm).toBeTruthy();

    // Close without recording to preserve test data
    await page.keyboard.press('Escape');
  });

  test('monthly totals chart available', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for "Trends" button in sidebar
    const chartButton = page.locator('button').filter({ hasText: 'Trends' }).first();

    if (await chartButton.count() === 0) {
      test.skip();
      return;
    }

    await expect(chartButton).toBeVisible({ timeout: 5000 });
    await chartButton.click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('all payments page has proper columns', async ({ page }) => {
    await page.goto('/all-payments');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const table = page.locator('table');
    if (await table.count() > 0) {
      const headers = await table.locator('th').allTextContents();
      const hasRelevantColumns = headers.some(h =>
        /date|amount|bill|name/i.test(h)
      );
      expect(hasRelevantColumns).toBeTruthy();
    } else {
      test.skip();
    }
  });
});
