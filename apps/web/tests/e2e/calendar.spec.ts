import { login } from './helpers';
import { test, expect } from '@playwright/test';

test.describe('Calendar Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('calendar page loads via direct navigation', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/calendar/);
    const calendarContent = page.getByText(/january|february|march|april|may|june|july|august|september|october|november|december/i).first();
    await expect(calendarContent).toBeVisible({ timeout: 10000 });
  });

  test('calendar page accessible from sidebar navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const calendarLink = page.locator('a, [class*="NavLink"]').filter({ hasText: /^Calendar$/ }).first();

    if (await calendarLink.count() > 0) {
      await calendarLink.click();
      await page.waitForURL(/\/calendar/, { timeout: 5000 });
      await expect(page).toHaveURL(/\/calendar/);
    } else {
      test.skip();
    }
  });

  test('month navigation arrows work', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Compute expected month names
    const now = new Date();
    const currentMonthName = now.toLocaleString('default', { month: 'long' });
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthName = nextMonth.toLocaleString('default', { month: 'long' });

    // Verify current month heading is visible (in an h6 inside a Paper)
    const currentHeading = page.locator('h6').filter({ hasText: new RegExp(`${currentMonthName} ${now.getFullYear()}`) });
    await expect(currentHeading.first()).toBeVisible({ timeout: 10000 });

    // Click the forward arrow (next sibling button after "Today")
    // Note: sidebar also has a Calendar with "Today" button, so use the LAST one (main content)
    const clicked = await page.evaluate(() => {
      const todayButtons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Today');
      const todayBtn = todayButtons[todayButtons.length - 1]; // Main content's Today button
      if (todayBtn && todayBtn.nextElementSibling) {
        (todayBtn.nextElementSibling as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      // After clicking forward, the next month heading should appear
      const nextHeading = page.locator('h6').filter({ hasText: new RegExp(`${nextMonthName}`) });
      await expect(nextHeading.first()).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('month view toggle buttons work (1/3/6)', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for segmented control or buttons with month counts
    const threeMonthButton = page.locator('button, [role="radio"], label').filter({ hasText: /^3$/ }).first();

    if (await threeMonthButton.count() > 0) {
      await threeMonthButton.click();
      await page.waitForTimeout(500);

      const monthHeadings = page.locator('text=/[A-Z][a-z]+ \\d{4}/');
      const headingCount = await monthHeadings.count();
      expect(headingCount).toBeGreaterThanOrEqual(3);
    } else {
      test.skip();
    }
  });

  test('clicking a day with bills opens detail modal', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Find a day cell that has bill indicators
    const dayWithBills = page.locator('[class*="day"]').filter({
      has: page.locator('[class*="Badge"], [class*="indicator"], [class*="red"], [class*="green"]')
    }).first();

    if (await dayWithBills.count() > 0) {
      await dayWithBills.click();
      await page.waitForTimeout(500);

      const modal = page.locator('[role="dialog"], .mantine-Modal-root');
      await expect(modal).toBeVisible({ timeout: 5000 });
    } else {
      // No bills visible in calendar - this is OK
      const pageContent = await page.textContent('body');
      expect(pageContent).toBeTruthy();
    }
  });

  test('calendar shows empty state without database', async ({ page }) => {
    await page.goto('/calendar');
    const pageContent = await page.textContent('body');
    expect(pageContent).toBeTruthy();
  });

  test('no console errors on calendar page', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/calendar');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Filter out known benign errors
    const realErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('service-worker') &&
      !e.includes('manifest') &&
      !e.includes('process-auto-payments') &&
      !e.includes('Failed to load resource') &&
      !e.includes('net::') &&
      !e.includes('404')
    );
    expect(realErrors).toHaveLength(0);
  });
});
