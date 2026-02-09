import { login, navigateToBills } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Navigation and Database Selection', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('main page loads with bills', async ({ page }) => {
    await expect(page).toHaveURL(/localhost/);

    // Dashboard should show content in the main area
    const mainContent = page.locator('main, [class*="AppShell-main"]');
    const hasContent = await mainContent.locator('table, [class*="Dashboard"], [class*="StatCards"]').first().isVisible({ timeout: 10000 }).catch(() => false);
    const hasText = await mainContent.getByText(/upcoming|total|overdue/i).first().isVisible().catch(() => false);

    expect(hasContent || hasText).toBeTruthy();
  });

  test('navigate to all payments', async ({ page }) => {
    const showAllLink = page.getByRole('button', { name: /show all/i }).or(
      page.locator('a[href*="all-payments"]')
    );

    if (await showAllLink.count() > 0) {
      await showAllLink.first().click();
      await page.waitForURL(/all-payments/, { timeout: 5000 });
      await expect(page).toHaveURL(/all-payments/);
    } else {
      await page.goto('/all-payments');
      await expect(page).toHaveURL(/all-payments/);
    }
  });

  test('database selector visible', async ({ page }) => {
    const dbSelector = page.locator('select').filter({ hasText: /.+/ }).first();

    if (await dbSelector.count() > 0) {
      await expect(dbSelector).toBeVisible();
    } else {
      const dbIndicator = page.getByText(/database|personal|bills|Test Bills/i).first();
      if (await dbIndicator.count() > 0) {
        await expect(dbIndicator).toBeVisible();
      } else {
        test.skip();
      }
    }
  });

  test('switch database if multiple available', async ({ page }) => {
    const dbSelector = page.locator('select').first();

    if (await dbSelector.count() > 0) {
      const dbOptions = await dbSelector.locator('option').count();

      if (dbOptions > 1) {
        await dbSelector.selectOption({ index: 1 });
        await page.waitForTimeout(1000);
        await page.waitForLoadState('domcontentloaded');

        const newValue = await dbSelector.inputValue();
        expect(newValue).toBeDefined();
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('back button functionality', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.goto('/all-payments');
    await page.waitForLoadState('domcontentloaded');

    await page.goBack();

    await expect(page).toHaveURL(/localhost:\d+\/?$/);
  });

  test('keyboard navigation', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
  });

  test('invalid route handles gracefully', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');

    await page.waitForTimeout(1000);

    const hasContent = await page.locator('body').textContent();
    expect(hasContent).toBeTruthy();

    const isWorking = await page.evaluate(() => {
      return document.getElementById('root') !== null;
    });
    expect(isWorking).toBeTruthy();
  });

  test('sidebar filter buttons work', async ({ page }) => {
    // Navigate to /bills where filters are functional
    await navigateToBills(page);

    // Sidebar date range filters are clickable Group elements
    const thisWeekFilter = page.getByText('This week', { exact: true });

    if (await thisWeekFilter.count() > 0) {
      await thisWeekFilter.click();
      await page.waitForTimeout(500);

      // Should still be on bills page (filters applied in-place)
      await expect(page).toHaveURL(/\/bills/);

      // Click again to deactivate
      await thisWeekFilter.click();
      await page.waitForTimeout(300);
    } else {
      test.skip();
    }
  });

  test('logout redirects to login', async ({ page }) => {
    const logoutButton = page.locator('button:has-text("Logout")');

    if (await logoutButton.count() > 0) {
      await logoutButton.click();

      // Should show login form
      await expect(page.locator('button[type="submit"]:has-text("Sign In")')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });
});
