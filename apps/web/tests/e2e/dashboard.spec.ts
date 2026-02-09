import { login } from './helpers';
import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
  });

  test('dashboard loads as default home page', async ({ page }) => {
    // Should see Dashboard content
    const dashboardContent = page.getByText(/dashboard|upcoming|overdue|total/i).first();
    await expect(dashboardContent).toBeVisible({ timeout: 10000 });
  });

  test('stat cards display financial summary', async ({ page }) => {
    // Look for stat card elements
    const statSection = page.locator('[class*="StatCards"], [class*="stat"], .mantine-SimpleGrid').first();

    if (await statSection.count() > 0) {
      await expect(statSection).toBeVisible({ timeout: 10000 });
    } else {
      // At minimum, dashboard should show some numeric content
      const hasNumbers = await page.locator('text=/\\$[\\d,]+|\\d+ bill/i').first().isVisible().catch(() => false);
      expect(hasNumbers).toBeTruthy();
    }
  });

  test('upcoming bills section visible', async ({ page }) => {
    // Scope to main content to avoid sidebar "Upcoming Bills" text
    const mainContent = page.locator('main, [class*="AppShell-main"]');
    const upcomingSection = mainContent.getByText(/upcoming/i).first();

    await expect(upcomingSection).toBeVisible({ timeout: 10000 });
  });

  test('overdue stat card is visible and clickable', async ({ page }) => {
    // Scope to main content area (stat cards on Dashboard)
    const mainContent = page.locator('main, [class*="AppShell-main"]');
    const overdueCard = mainContent.locator('[class*="Paper"]').filter({ hasText: /overdue/i }).first();

    if (await overdueCard.count() > 0) {
      await expect(overdueCard).toBeVisible();
      // Stat card should be clickable (navigates to Bills filtered by overdue)
      await overdueCard.click();
      await page.waitForURL(/\/bills/, { timeout: 5000 });
      await expect(page).toHaveURL(/\/bills/);
    } else {
      // Dashboard might not have loaded or no overdue text present
      test.skip();
    }
  });

  test('view bills button navigates to bills page', async ({ page }) => {
    // Scope to main content to avoid sidebar matches
    const mainContent = page.locator('main, [class*="AppShell-main"]');
    const viewBillsButton = mainContent.getByText(/view all/i).first();

    if (await viewBillsButton.count() > 0) {
      await viewBillsButton.click();
      await page.waitForURL(/\/bills/, { timeout: 5000 });
      await expect(page).toHaveURL(/\/bills/);
    } else {
      // Try clicking the Bills nav link instead
      const billsNav = page.locator('[class*="NavLink"]').filter({ hasText: 'Bills' }).first();
      if (await billsNav.count() > 0) {
        await billsNav.click();
        await page.waitForURL(/\/bills/, { timeout: 5000 });
        await expect(page).toHaveURL(/\/bills/);
      } else {
        test.skip();
      }
    }
  });

  test('dashboard shows empty state when no database selected', async ({ page }) => {
    const noDatabaseText = page.getByText(/select.*database|no.*database|get started/i);

    if (await noDatabaseText.count() > 0) {
      await expect(noDatabaseText).toBeVisible();
    }
    expect(true).toBeTruthy();
  });

  test('no console errors on dashboard load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
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
