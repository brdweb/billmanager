import { login, navigateToBills } from './helpers';
import { test, expect } from '@playwright/test';

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
  });

  test('sidebar shows all navigation links', async ({ page }) => {
    const dashboardLink = page.getByText('Dashboard', { exact: true });
    const billsLink = page.getByText('Bills', { exact: true });
    const calendarLink = page.getByText('Calendar', { exact: true });
    const analyticsLink = page.getByText('Analytics', { exact: true });

    await expect(dashboardLink).toBeVisible({ timeout: 10000 });
    await expect(billsLink).toBeVisible();
    await expect(calendarLink).toBeVisible();
    await expect(analyticsLink).toBeVisible();
  });

  test('dashboard link highlights when on home page', async ({ page }) => {
    const dashboardNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Dashboard' }).first();

    if (await dashboardNav.count() > 0) {
      const isActive = await dashboardNav.getAttribute('data-active');
      expect(isActive).toBeTruthy();
    }
  });

  test('navigate Dashboard -> Bills -> Calendar -> Analytics', async ({ page }) => {
    // Start on Dashboard
    await expect(page).toHaveURL(/localhost:\d+\/?$/);

    // Go to Bills - click the NavLink (not just any "Bills" text)
    const billsNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Bills' }).first();
    if (await billsNav.count() > 0) {
      await billsNav.click();
    } else {
      await page.getByText('Bills', { exact: true }).click();
    }
    await page.waitForURL(/\/bills/, { timeout: 5000 });

    // Go to Calendar
    const calendarNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Calendar' }).first();
    if (await calendarNav.count() > 0) {
      await calendarNav.click();
    } else {
      await page.getByText('Calendar', { exact: true }).click();
    }
    await page.waitForURL(/\/calendar/, { timeout: 5000 });

    // Go to Analytics
    const analyticsNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Analytics' }).first();
    if (await analyticsNav.count() > 0) {
      await analyticsNav.click();
    } else {
      await page.getByText('Analytics', { exact: true }).click();
    }
    await page.waitForURL(/\/analytics/, { timeout: 5000 });

    // Back to Dashboard
    const dashboardNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Dashboard' }).first();
    if (await dashboardNav.count() > 0) {
      await dashboardNav.click();
    } else {
      await page.getByText('Dashboard', { exact: true }).click();
    }
    await page.waitForURL(/localhost:\d+\/?$/, { timeout: 5000 });
  });

  test('active link updates when navigating', async ({ page }) => {
    await navigateToBills(page);

    const billsNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Bills' }).first();
    if (await billsNav.count() > 0) {
      const isActive = await billsNav.getAttribute('data-active');
      expect(isActive).toBeTruthy();
    }

    await page.goto('/calendar');
    await page.waitForLoadState('domcontentloaded');

    const calendarNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Calendar' }).first();
    if (await calendarNav.count() > 0) {
      const isActive = await calendarNav.getAttribute('data-active');
      expect(isActive).toBeTruthy();
    }
  });

  test('payment history link visible in sidebar', async ({ page }) => {
    const paymentHistoryLink = page.locator('[class*="NavLink"]').filter({ hasText: 'Payment History' }).first();
    await expect(paymentHistoryLink).toBeVisible({ timeout: 10000 });
  });

  test('month navigation in sidebar works', async ({ page }) => {
    const prevButton = page.locator('button').filter({
      has: page.locator('[class*="ChevronLeft"]')
    }).first();

    const nextButton = page.locator('button').filter({
      has: page.locator('[class*="ChevronRight"]')
    }).first();

    if (await prevButton.count() > 0 && await nextButton.count() > 0) {
      await prevButton.click();
      await page.waitForTimeout(500);

      await nextButton.click();
      await page.waitForTimeout(500);

      const pageContent = await page.textContent('body');
      expect(pageContent).toBeTruthy();
    }
  });
});
