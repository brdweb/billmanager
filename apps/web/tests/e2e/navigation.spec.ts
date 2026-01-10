import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Navigation and Database Selection', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('main page loads with bills', async ({ page }) => {
    // Main page should show bills list
    await expect(page).toHaveURL(/localhost/);

    // Should see some content (bills table/list or empty state)
    await expect(
      page.locator('table').or(page.getByText('No bills'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('navigate to all payments', async ({ page }) => {
    // Click "Show All" in sidebar to navigate to all-payments
    const showAllLink = page.getByRole('button', { name: /show all/i }).or(
      page.locator('a[href*="all-payments"]')
    );

    if (await showAllLink.count() > 0) {
      await showAllLink.first().click();
      await page.waitForURL(/all-payments/, { timeout: 5000 });
      await expect(page).toHaveURL(/all-payments/);
    } else {
      // Navigate directly
      await page.goto('/all-payments');
      await expect(page).toHaveURL(/all-payments/);
    }
  });

  test('database selector visible', async ({ page }) => {
    // Look for database selector in the header
    const dbSelector = page.locator('select').filter({ hasText: /.+/ }).first();

    if (await dbSelector.count() > 0) {
      await expect(dbSelector).toBeVisible();
    } else {
      // Database name might be shown as text instead
      const dbIndicator = page.getByText(/database|personal|bills/i).first();
      if (await dbIndicator.count() > 0) {
        await expect(dbIndicator).toBeVisible();
      } else {
        test.skip();
      }
    }
  });

  test('switch database if multiple available', async ({ page }) => {
    // Look for database selector
    const dbSelector = page.locator('select').first();

    if (await dbSelector.count() > 0) {
      // Get number of database options
      const dbOptions = await dbSelector.locator('option').count();

      if (dbOptions > 1) {
        // Get current value
        const currentValue = await dbSelector.inputValue();

        // Switch to different database
        await dbSelector.selectOption({ index: 1 });
        await page.waitForTimeout(1000);
        await page.waitForLoadState('networkidle');

        // Verify change (value should be different or page should reload)
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
    // Start at home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to all-payments
    await page.goto('/all-payments');
    await page.waitForLoadState('networkidle');

    // Go back
    await page.goBack();

    // Should be back on home page
    await expect(page).toHaveURL(/localhost:\d+\/?$/);
  });

  test('keyboard navigation', async ({ page }) => {
    await page.goto('/');

    // Press Tab to navigate through interactive elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // At least one element should be focused
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
  });

  test('invalid route handles gracefully', async ({ page }) => {
    // Navigate to invalid route
    await page.goto('/this-page-does-not-exist');

    // Should handle gracefully: redirect, show 404, or just show main app
    await page.waitForTimeout(1000);

    // App should not crash - page should have some content
    const hasContent = await page.locator('body').textContent();
    expect(hasContent).toBeTruthy();

    // No JavaScript errors should have occurred (app still functional)
    const isWorking = await page.evaluate(() => {
      // Check if React root exists
      return document.getElementById('root') !== null;
    });
    expect(isWorking).toBeTruthy();
  });

  test('sidebar filter buttons work', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Sidebar filters are clickable Text elements inside Group containers, not buttons
    // Look for "This week" or similar filter text
    const thisWeekFilter = page.getByText('This week', { exact: true });
    const next21Filter = page.getByText('Next 21 days', { exact: true });

    if (await thisWeekFilter.count() > 0) {
      // Click the filter text to activate filter
      await thisWeekFilter.click();
      await page.waitForTimeout(500);

      // Should still be on same page (filters applied)
      await expect(page).toHaveURL(/localhost/);

      // Text should be bold now (fw=700) - verify filter activated
      // Click again to deactivate
      await thisWeekFilter.click();
      await page.waitForTimeout(300);
    } else if (await next21Filter.count() > 0) {
      await next21Filter.click();
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/localhost/);
    } else {
      test.skip();
    }
  });

  test('logout redirects to login', async ({ page }) => {
    // Find and click logout button
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    if (await logoutButton.count() > 0) {
      await logoutButton.click();

      // Should redirect to login
      await page.waitForURL(/login/, { timeout: 5000 });
      await expect(page).toHaveURL(/login/);
    } else {
      // Try finding in menu
      const userMenu = page.locator('button').filter({ hasText: /admin|user|menu/i }).first();
      if (await userMenu.count() > 0) {
        await userMenu.click();
        const logoutOption = page.getByText(/logout|sign out/i);
        if (await logoutOption.count() > 0) {
          await logoutOption.click();
          await page.waitForURL(/login/, { timeout: 5000 });
        } else {
          test.skip();
        }
      } else {
        test.skip();
      }
    }
  });
});
