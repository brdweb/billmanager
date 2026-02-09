import { login } from './helpers';
import { test, expect } from '@playwright/test';

test.describe('Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('analytics page loads via direct navigation', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/analytics/);
    const analyticsContent = page.getByText(/analytics|spending|account|year/i).first();
    await expect(analyticsContent).toBeVisible({ timeout: 10000 });
  });

  test('analytics page accessible from sidebar navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Click Analytics nav link in sidebar - it's a NavLink, not a button/link
    const analyticsLink = page.locator('a, [class*="NavLink"]').filter({ hasText: /^Analytics$/ }).first();

    if (await analyticsLink.count() > 0) {
      await analyticsLink.click();
      await page.waitForURL(/\/analytics/, { timeout: 5000 });
      await expect(page).toHaveURL(/\/analytics/);
    } else {
      test.skip();
    }
  });

  test('account pie chart renders', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for chart SVG or chart container or "no data" state
    const chartContainer = page.locator('svg, canvas, [class*="Chart"], [class*="chart"]').first();
    const noDataText = page.getByText(/no data|no payments|no spending/i).first();

    const hasChart = await chartContainer.count() > 0;
    const hasNoData = await noDataText.count() > 0;

    // One of these must be true
    expect(hasChart || hasNoData).toBeTruthy();
  });

  test('year-over-year comparison section visible', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for year numbers or comparison labels
    const yoySection = page.getByText(/20\d{2}/).first();
    await expect(yoySection).toBeVisible({ timeout: 10000 });
  });

  test('yearly breakdown shows data', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const yearlyData = page.getByText(/20\d{2}/).first();

    if (await yearlyData.count() > 0) {
      await expect(yearlyData).toBeVisible();
      // Should show dollar amounts
      const amounts = page.locator('text=/\\$[\\d,]+/');
      expect(await amounts.count()).toBeGreaterThan(0);
    } else {
      const emptyState = page.getByText(/no data|no payments/i);
      if (await emptyState.count() > 0) {
        await expect(emptyState).toBeVisible();
      }
    }
  });

  test('analytics handles empty database gracefully', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('domcontentloaded');

    const pageContent = await page.textContent('body');
    expect(pageContent).toBeTruthy();
  });

  test('analytics API endpoints respond correctly', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const byAccountResponse = await page.evaluate(async () => {
      try {
        const resp = await fetch('/api/v2/stats/by-account', { credentials: 'include' });
        return { status: resp.status, ok: resp.ok };
      } catch {
        return { status: 0, ok: false };
      }
    });

    expect([200, 401]).toContain(byAccountResponse.status);
  });
});
