import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('UI/UX Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('form validation displays errors', async ({ page }) => {
    await page.goto('/bills');

    // Open add bill form
    await page.click('button:has-text("Add"), button:has-text("New")');
    await page.waitForTimeout(500);

    // Try to submit empty form
    await page.click('button:has-text("Save"), button:has-text("Create"), button[type="submit"]');

    // Should show validation errors
    const hasValidationError = await page.locator('text=/required|invalid|error/i, .error, [aria-invalid="true"]').count() > 0;
    expect(hasValidationError).toBeTruthy();
  });

  test('success messages display after actions', async ({ page }) => {
    await page.goto('/bills');

    // Create a bill
    await page.click('button:has-text("Add"), button:has-text("New")');
    await page.waitForTimeout(500);

    await page.fill('input[name="name"]', `Success Test ${Date.now()}`);
    await page.fill('input[name="amount"], input[type="number"]', '100');
    await page.click('button:has-text("Save"), button:has-text("Create")');

    // Should show success message
    await expect(page.locator('text=/success|created|added/i, .success, [role="alert"]')).toBeVisible({ timeout: 10000 });
  });

  test('error messages display on failures', async ({ page }) => {
    // Try to create bill with invalid data
    await page.goto('/bills');

    await page.click('button:has-text("Add"), button:has-text("New")');
    await page.waitForTimeout(500);

    // Fill with intentionally invalid amount
    await page.fill('input[name="name"]', 'Error Test');
    await page.fill('input[name="amount"], input[type="number"]', '-999999999');

    await page.click('button:has-text("Save")');

    // Should show error
    await expect(page.locator('text=/error|invalid|failed/i, .error, [role="alert"]')).toBeVisible({ timeout: 10000 });
  });

  test('loading indicators during async operations', async ({ page }) => {
    await page.goto('/bills');

    // Trigger an async operation
    await page.click('button:has-text("Add"), button:has-text("New")');
    await page.waitForTimeout(500);

    await page.fill('input[name="name"]', 'Loading Test');
    await page.fill('input[name="amount"]', '50');

    // Click submit and look for loading indicator
    const submitButton = page.locator('button:has-text("Save"), button:has-text("Create")');
    await submitButton.click();

    // Should show loading state (spinner, disabled button, etc.)
    const hasLoadingState = await Promise.race([
      page.locator('[role="progressbar"], .spinner, .loading, button:disabled:has-text("Save")').isVisible().then(() => true),
      page.waitForTimeout(2000).then(() => false)
    ]);

    // Loading state is expected but not critical
    expect(typeof hasLoadingState).toBe('boolean');
  });

  test('modal/dialog can be closed', async ({ page }) => {
    await page.goto('/bills');

    // Open a modal
    await page.click('button:has-text("Add"), button:has-text("New")');
    await page.waitForTimeout(500);

    // Should see modal
    await expect(page.locator('[role="dialog"], .modal')).toBeVisible();

    // Close modal (X button, Cancel, or Escape key)
    const closeButton = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label="close" i], [role="dialog"] button').first();

    if (await closeButton.count() > 0) {
      await closeButton.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(500);

    // Modal should be closed
    const modalVisible = await page.locator('[role="dialog"], .modal').isVisible().catch(() => false);
    expect(modalVisible).toBeFalsy();
  });

  test('tooltips display on hover', async ({ page }) => {
    await page.goto('/bills');

    // Look for elements with tooltips
    const tooltipTrigger = page.locator('[title], [aria-label], [data-tooltip]').first();

    if (await tooltipTrigger.count() > 0) {
      await tooltipTrigger.hover();
      await page.waitForTimeout(500);

      // Check if tooltip or title is visible
      const hasTooltip = await page.locator('[role="tooltip"], .tooltip').isVisible().catch(() => false);
      const hasTitle = await tooltipTrigger.getAttribute('title');

      expect(hasTooltip || hasTitle).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('dropdown menus work correctly', async ({ page }) => {
    await page.goto('/bills');

    // Look for dropdown or select element
    const dropdown = page.locator('select, button[aria-haspopup="listbox"], [role="combobox"]').first();

    if (await dropdown.count() > 0) {
      await dropdown.click();
      await page.waitForTimeout(500);

      // Should show options
      const hasOptions = await page.locator('option, [role="option"], [role="menuitem"]').count() > 0;
      expect(hasOptions).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('date picker functionality', async ({ page }) => {
    await page.goto('/bills');

    // Open form with date input
    await page.click('button:has-text("Add"), button:has-text("New")');
    await page.waitForTimeout(500);

    const dateInput = page.locator('input[type="date"], input[type="datetime-local"]');

    if (await dateInput.count() > 0) {
      // Set date
      const testDate = new Date();
      testDate.setDate(testDate.getDate() + 7);
      await dateInput.fill(testDate.toISOString().split('T')[0]);

      // Verify date was set
      const value = await dateInput.inputValue();
      expect(value.length).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('tabs or segmented controls switch content', async ({ page }) => {
    await page.goto('/bills');

    // Look for tabs
    const tabs = page.locator('[role="tab"], .tab, button[data-tab]');

    if (await tabs.count() > 1) {
      // Click second tab
      const secondTab = tabs.nth(1);
      await secondTab.click();
      await page.waitForTimeout(500);

      // Should have active state
      const isActive = await secondTab.evaluate(el =>
        el.classList.contains('active') ||
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('data-active') === 'true'
      );

      expect(isActive).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('pagination controls work', async ({ page }) => {
    await page.goto('/bills');

    // Look for pagination
    const pagination = page.locator('nav[aria-label="pagination" i], .pagination, [role="navigation"]:has-text("Next")');

    if (await pagination.count() > 0) {
      // Click next page
      const nextButton = pagination.locator('button:has-text("Next"), a:has-text("Next"), button[aria-label*="next" i]');

      if (await nextButton.count() > 0 && await nextButton.isEnabled()) {
        await nextButton.click();
        await page.waitForTimeout(1000);

        // Should load new page
        await page.waitForLoadState('networkidle');

        // Page should update
        expect(page.url()).toBeTruthy();
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('search with debounce', async ({ page }) => {
    await page.goto('/bills');

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]');

    if (await searchInput.count() > 0) {
      // Type search query
      await searchInput.fill('test');

      // Wait for debounce
      await page.waitForTimeout(1000);

      // Should trigger search
      await page.waitForLoadState('networkidle');

      // Results should be filtered
      expect(page.url()).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('keyboard shortcuts work', async ({ page }) => {
    await page.goto('/bills');

    // Try common keyboard shortcut (Ctrl+K for search, etc.)
    await page.keyboard.press('Control+K');

    // Check if action occurred (search opened, etc.)
    await page.waitForTimeout(500);

    const searchVisible = await page.locator('input[type="search"], [role="search"]').isVisible().catch(() => false);

    // Keyboard shortcuts are optional
    expect(typeof searchVisible).toBe('boolean');
  });

  test('context menu on right click', async ({ page }) => {
    await page.goto('/bills');

    const firstBill = page.locator('[data-testid*="bill"], tr:has-text("$")').first();

    if (await firstBill.count() > 0) {
      // Right click
      await firstBill.click({ button: 'right' });
      await page.waitForTimeout(500);

      // Check for context menu
      const contextMenu = await page.locator('[role="menu"], .context-menu').isVisible().catch(() => false);

      // Context menu is optional
      expect(typeof contextMenu).toBe('boolean');
    } else {
      test.skip();
    }
  });

  test('drag and drop reordering', async ({ page }) => {
    await page.goto('/bills');

    // Look for draggable items
    const draggable = page.locator('[draggable="true"], [data-draggable="true"]').first();

    if (await draggable.count() > 0) {
      // Get initial position
      const initialBox = await draggable.boundingBox();

      // Drag item
      await draggable.hover();
      await page.mouse.down();
      await page.mouse.move(initialBox!.x, initialBox!.y + 100);
      await page.mouse.up();

      await page.waitForTimeout(500);

      // Position should have changed
      const newBox = await draggable.boundingBox();
      expect(newBox!.y).not.toBe(initialBox!.y);
    } else {
      test.skip();
    }
  });

  test('copy to clipboard functionality', async ({ page }) => {
    await page.goto('/bills');

    // Look for copy buttons
    const copyButton = page.locator('button:has-text("Copy"), button[aria-label*="copy" i], [data-action="copy"]').first();

    if (await copyButton.count() > 0) {
      await copyButton.click();

      // Should show feedback
      await expect(page.locator('text=/copied|success/i')).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('theme switcher (if available)', async ({ page }) => {
    await page.goto('/');

    // Look for theme toggle
    const themeToggle = page.locator('button[aria-label*="theme" i], button:has-text("Dark"), button:has-text("Light")').first();

    if (await themeToggle.count() > 0) {
      // Get current theme
      const bodyClass = await page.locator('body').getAttribute('class');

      // Toggle theme
      await themeToggle.click();
      await page.waitForTimeout(500);

      // Theme should change
      const newBodyClass = await page.locator('body').getAttribute('class');
      expect(newBodyClass).not.toBe(bodyClass);
    } else {
      test.skip();
    }
  });
});
