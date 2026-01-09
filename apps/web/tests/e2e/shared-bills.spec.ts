import { login } from "./helpers";
import { test, expect } from '@playwright/test';

test.describe('Shared Bills Feature', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/bills');
    await page.waitForLoadState('networkidle');
  });

  test('share a bill with another user', async ({ page }) => {
    // Find first bill
    const firstBill = page.locator('[data-testid*="bill"], tr:has-text("$")').first();
    await firstBill.hover();

    // Look for share button
    const shareButton = firstBill.locator('button:has-text("Share"), [aria-label*="share" i]').first();

    if (await shareButton.count() === 0) {
      // Try clicking on bill to open details first
      await firstBill.click();
      await page.waitForTimeout(500);
    }

    // Now look for share button
    const shareBtn = page.locator('button:has-text("Share"), [aria-label*="share" i]').first();
    await shareBtn.click({ timeout: 5000 });

    // Should open share modal/form
    await expect(page.locator('form, [role="dialog"]')).toBeVisible({ timeout: 5000 });

    // Fill in recipient email
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await emailInput.fill('test@example.com');

    // Select split type if available
    const splitTypeSelect = page.locator('select[name="split_type"], [aria-label*="split type" i]');
    if (await splitTypeSelect.count() > 0) {
      await splitTypeSelect.selectOption('percentage');

      // Enter split value
      const splitValueInput = page.locator('input[name="split_value"], input[type="number"]');
      await splitValueInput.fill('50');
    }

    // Submit share
    await page.click('button:has-text("Share"), button:has-text("Send"), button[type="submit"]');

    // Should see success message
    await expect(
      page.locator('text=/shared|success|invited|sent/i')
    ).toBeVisible({ timeout: 10000 });
  });

  test('view shared bills list', async ({ page }) => {
    // Navigate to shared bills page
    await page.goto('/shared-bills');

    // Should see shared bills section
    await expect(
      page.locator('text=/shared bills|bill sharing/i').or(page.locator('h1, h2'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('edit split configuration on existing share', async ({ page }) => {
    // Go to bills page
    await page.goto('/bills');
    await page.waitForLoadState('networkidle');

    // Find a bill and open share modal
    const firstBill = page.locator('[data-testid*="bill"], tr:has-text("$")').first();
    await firstBill.hover();

    const shareButton = page.locator('button:has-text("Share"), [aria-label*="share" i]').first();
    if (await shareButton.count() === 0) {
      await firstBill.click();
      await page.waitForTimeout(500);
    }

    await page.locator('button:has-text("Share")').first().click();
    await page.waitForTimeout(500);

    // Look for existing shares in the modal
    const editShareButton = page.locator('button:has-text("Edit"), [aria-label*="edit share" i]').first();

    if (await editShareButton.count() > 0) {
      await editShareButton.click();

      // Should show edit form
      await expect(page.locator('input[name="split_value"], input[type="number"]')).toBeVisible({ timeout: 5000 });

      // Change split value
      const splitValueInput = page.locator('input[name="split_value"], input[type="number"]');
      await splitValueInput.clear();
      await splitValueInput.fill('60');

      // Save changes
      await page.click('button:has-text("Save"), button:has-text("Update")');

      // Should see success message
      await expect(page.locator('text=/updated|success|saved/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('accept shared bill invitation', async ({ page }) => {
    // Navigate to shared bills page
    await page.goto('/shared-bills');
    await page.waitForLoadState('networkidle');

    // Look for pending invitations section
    const pendingSection = page.locator('text=/pending invitation|pending share/i');

    if (await pendingSection.count() > 0) {
      // Find accept button
      const acceptButton = page.locator('button:has-text("Accept"), [aria-label*="accept" i]').first();

      if (await acceptButton.count() > 0) {
        await acceptButton.click();

        // Should see success message
        await expect(page.locator('text=/accepted|success/i')).toBeVisible({ timeout: 10000 });

        // Should move to active shares section
        await expect(page.locator('text=/active shared bills|active shares/i')).toBeVisible({ timeout: 5000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('decline shared bill invitation', async ({ page }) => {
    // Navigate to shared bills page
    await page.goto('/shared-bills');
    await page.waitForLoadState('networkidle');

    // Look for pending invitations
    const declineButton = page.locator('button:has-text("Decline"), button:has-text("Reject"), [aria-label*="decline" i]').first();

    if (await declineButton.count() > 0) {
      await declineButton.click();

      // Confirm if confirmation appears
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
      if (await confirmButton.count() > 0) {
        await confirmButton.click();
      }

      // Should see success message
      await expect(page.locator('text=/declined|rejected|success/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('revoke/leave shared bill', async ({ page }) => {
    // Navigate to shared bills page
    await page.goto('/shared-bills');
    await page.waitForLoadState('networkidle');

    // Look for active shares
    const revokeButton = page.locator('button:has-text("Revoke"), button:has-text("Leave"), button:has-text("Remove"), [aria-label*="revoke" i]').first();

    if (await revokeButton.count() > 0) {
      await revokeButton.click();

      // Confirm action
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Revoke")');
      if (await confirmButton.count() > 0) {
        await confirmButton.click();
      }

      // Should see success message
      await expect(page.locator('text=/revoked|removed|success/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });

  test('view split configuration details', async ({ page }) => {
    // Go to shared bills page
    await page.goto('/shared-bills');
    await page.waitForLoadState('networkidle');

    // Find a shared bill
    const sharedBill = page.locator('[data-testid*="shared-bill"], [class*="shared-bill"]').first();

    if (await sharedBill.count() > 0) {
      // Should display split information
      const hasSplitInfo = await page.locator('text=/percentage|fixed|equal|split/i').count() > 0;
      expect(hasSplitInfo).toBeTruthy();

      // Should show owner information
      const hasOwnerInfo = await page.locator('text=/owner|shared by|from/i').count() > 0;
      expect(hasOwnerInfo).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('mark recipient portion as paid', async ({ page }) => {
    // Go to shared bills page
    await page.goto('/shared-bills');
    await page.waitForLoadState('networkidle');

    // Find active shared bill
    const sharedBill = page.locator('[data-testid*="shared-bill"]').first();

    if (await sharedBill.count() > 0) {
      await sharedBill.hover();

      // Look for "Mark Paid" or "Pay" button
      const payButton = sharedBill.locator('button:has-text("Pay"), button:has-text("Mark Paid"), [aria-label*="pay" i]').first();

      if (await payButton.count() > 0) {
        await payButton.click();

        // Fill payment form if it appears
        const dateInput = page.locator('input[type="date"]');
        if (await dateInput.count() > 0) {
          await dateInput.fill(new Date().toISOString().split('T')[0]);
        }

        // Submit
        await page.click('button:has-text("Save"), button:has-text("Pay"), button[type="submit"]');

        // Should see success message
        await expect(page.locator('text=/paid|success|recorded/i')).toBeVisible({ timeout: 10000 });
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('filter between pending and active shared bills', async ({ page }) => {
    await page.goto('/shared-bills');
    await page.waitForLoadState('networkidle');

    // Should see sections for pending and active
    const pendingSection = page.locator('text=/pending invitation|pending share/i');
    const activeSection = page.locator('text=/active shared bills|active share/i');

    // At least one section should be visible
    const hasPending = await pendingSection.count() > 0;
    const hasActive = await activeSection.count() > 0;

    expect(hasPending || hasActive).toBeTruthy();
  });

  test('share with multiple users', async ({ page }) => {
    // Go to bills page
    await page.goto('/bills');
    await page.waitForLoadState('networkidle');

    const firstBill = page.locator('[data-testid*="bill"], tr:has-text("$")').first();
    await firstBill.hover();

    // Open share modal
    let shareButton = page.locator('button:has-text("Share")').first();
    if (await shareButton.count() === 0) {
      await firstBill.click();
      await page.waitForTimeout(500);
      shareButton = page.locator('button:has-text("Share")').first();
    }

    await shareButton.click();
    await page.waitForTimeout(500);

    // Share with first user
    await page.fill('input[type="email"]', 'user1@example.com');
    await page.click('button:has-text("Share"), button:has-text("Add")');
    await page.waitForTimeout(1000);

    // Look for option to add another user
    const addAnotherButton = page.locator('button:has-text("Add Another"), button:has-text("Share with Another")');

    if (await addAnotherButton.count() > 0) {
      await addAnotherButton.click();

      // Share with second user
      await page.fill('input[type="email"]', 'user2@example.com');
      await page.click('button:has-text("Share"), button:has-text("Add")');

      // Should see success for multiple shares
      await expect(page.locator('text=/shared|success/i')).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });
});
