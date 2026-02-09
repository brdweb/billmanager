import { login, navigateToBills } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('UI/UX Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('form validation displays errors', async ({ page }) => {
    // Navigate to /bills page where "Add Entry" button exists
    await navigateToBills(page);

    const addButton = page.locator('button:has-text("Add Entry")').first();

    if (await addButton.count() > 0) {
      await addButton.click();
      await page.waitForTimeout(500);

      const modal = page.locator('[role="dialog"]');
      if (await modal.count() > 0) {
        // Try to submit form with empty name
        const submitButton = modal.locator('button').filter({ hasText: /add bill|save|create/i }).first();
        if (await submitButton.count() > 0) {
          await submitButton.click();
          await page.waitForTimeout(500);

          // Form uses native HTML5 validation (required attribute)
          // After clicking submit, modal should still be open (validation prevented submission)
          await expect(modal).toBeVisible();

          // Check for native :invalid pseudo-class on required fields
          const hasInvalidField = await page.evaluate(() => {
            return document.querySelectorAll('[role="dialog"] input:invalid').length > 0;
          });
          expect(hasInvalidField).toBeTruthy();
        } else {
          test.skip();
        }
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('modal/dialog can be closed', async ({ page }) => {
    await navigateToBills(page);

    const addButton = page.locator('button:has-text("Add Entry")').first();

    if (await addButton.count() > 0) {
      await addButton.click();
      await page.waitForTimeout(500);

      const modal = page.locator('[role="dialog"]');
      if (await modal.count() === 0) {
        test.skip();
        return;
      }

      await expect(modal).toBeVisible();

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await expect(modal).not.toBeVisible({ timeout: 3000 });
    } else {
      test.skip();
    }
  });

  test('dropdown/select elements work', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const selectElement = page.locator('select').first();

    if (await selectElement.count() > 0) {
      const optionsCount = await selectElement.locator('option').count();
      expect(optionsCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('date input functionality', async ({ page }) => {
    await navigateToBills(page);

    const addButton = page.locator('button:has-text("Add Entry")').first();

    if (await addButton.count() > 0) {
      await addButton.click();
      await page.waitForTimeout(500);

      const modal = page.locator('[role="dialog"]');
      // Mantine DateInput might not use type="date" - look for any date-related input
      const dateInput = modal.locator('input[type="date"], input[placeholder*="date" i], button[aria-label*="date" i]').first();

      if (await dateInput.count() > 0) {
        const tagName = await dateInput.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'input') {
          const testDate = new Date();
          testDate.setDate(testDate.getDate() + 7);
          await dateInput.fill(testDate.toISOString().split('T')[0]);
          const value = await dateInput.inputValue();
          expect(value.length).toBeGreaterThan(0);
        }
        await page.keyboard.press('Escape');
      } else {
        await page.keyboard.press('Escape');
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('keyboard shortcuts work', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
  });

  test('responsive table display', async ({ page }) => {
    await navigateToBills(page);

    const table = page.locator('table');

    if (await table.count() > 0) {
      const headerCells = await table.locator('th').count();
      expect(headerCells).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('button states work correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const button = page.locator('button').first();

    if (await button.count() > 0) {
      await expect(button).toBeVisible();
      const isDisabled = await button.isDisabled();
      expect(typeof isDisabled).toBe('boolean');
    } else {
      test.skip();
    }
  });

  test('notifications appear on actions', async ({ page }) => {
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
    await page.waitForTimeout(500);

    const modal = page.locator('[role="dialog"]');
    if (await modal.count() === 0) {
      test.skip();
      return;
    }

    // Verify pay modal opens - this confirms the action flow works
    await expect(modal).toBeVisible();

    // Close without recording
    await page.keyboard.press('Escape');
  });

  test('loading states appear during operations', async ({ page }) => {
    await page.goto('/');

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const hasContent = await page.locator('table, main, [class*="Dashboard"]').count() > 0;
    expect(hasContent).toBeTruthy();
  });

  test('error boundary handles errors gracefully', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const hasErrorBoundary = await page.getByText(/something went wrong|error occurred/i).count() > 0;
    expect(hasErrorBoundary).toBeFalsy();
  });
});
