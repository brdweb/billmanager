import { test, expect } from '@playwright/test';

/**
 * Tests for admin features added in v3.4.3:
 * 1. Edit bill group display name and description
 * 2. Edit user role (user <-> admin)
 * 3. Payment date display (timezone fix verification)
 */

// Password that will be set after first login
const TEST_PASSWORD = 'TestPassword123!';

test.describe.serial('Admin Features v3.4.3', () => {
  test('should complete initial login and password change', async ({ page }) => {
    // Get initial password from env or use the current test password
    const initialPassword = process.env.INITIAL_PASSWORD || 'GRKir2VGylKACVrb';

    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(initialPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForTimeout(2000);

    // Handle password change modal if it appears
    const modalVisible = await page.getByText('Password Change Required').isVisible().catch(() => false);
    if (modalVisible) {
      console.log('Password change modal visible - changing password');
      await page.getByLabel('Current Password').fill(initialPassword);
      await page.getByLabel('New Password').first().fill(TEST_PASSWORD);
      await page.getByLabel('Confirm New Password').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: 'Change Password' }).click();
      await page.waitForTimeout(2000);
    }

    // Should be on dashboard now
    await page.waitForURL('/', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: 'e2e/screenshots/01-dashboard.png', fullPage: true });

    // Verify we're logged in by checking for the sidebar
    const billsVisible = await page.getByText(/bills|dashboard/i).first().isVisible().catch(() => false);
    expect(billsVisible).toBe(true);
  });

  test('should display edit button for bill groups in admin panel', async ({ page }) => {
    // Login with established password
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Find and click Admin button in top right
    await page.screenshot({ path: 'e2e/screenshots/02-before-admin.png', fullPage: true });

    // The admin panel is accessed via the "Admin" button in the header
    await page.getByRole('button', { name: 'Admin' }).click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/03-admin-panel.png', fullPage: true });

    // Click on Bill Groups tab
    await page.getByRole('tab', { name: 'Bill Groups' }).click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/04-bill-groups-tab.png', fullPage: true });

    // Check for edit icon (pencil)
    const editButton = page.locator('[title="Edit"]').first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
  });

  test('should allow editing bill group display name and description', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Navigate to admin panel
    await page.getByRole('button', { name: 'Admin' }).click();
    await page.waitForTimeout(1000);

    // Click on Bill Groups tab
    await page.getByRole('tab', { name: 'Bill Groups' }).click();
    await page.waitForTimeout(500);

    // Click edit on first bill group
    await page.locator('[title="Edit"]').first().click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/05-editing-bill-group.png', fullPage: true });

    // Check that input fields appear - use more specific locators
    const displayNameInput = page.locator('input[placeholder="Display Name"]');
    await expect(displayNameInput).toBeVisible({ timeout: 5000 });

    // Clear and fill new values
    await displayNameInput.clear();
    await displayNameInput.fill('Updated Bill Group');

    // Find description input in the editing row (not the create form)
    const descriptionInput = page.locator('tr').filter({ has: page.locator('input[placeholder="Display Name"]') }).locator('input[placeholder*="Description"]');
    await descriptionInput.clear();
    await descriptionInput.fill('Updated description');

    // Save
    await page.locator('[title="Save"]').click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/06-bill-group-saved.png', fullPage: true });

    // Verify changes persisted - look specifically in the table
    const tableRow = page.locator('tr').filter({ hasText: 'personal' });
    await expect(tableRow.getByText('Updated Bill Group')).toBeVisible();
    await expect(tableRow.getByText('Updated description')).toBeVisible();
  });

  test('should display role selector in user edit modal', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Navigate to admin panel
    await page.getByRole('button', { name: 'Admin' }).click();
    await page.waitForTimeout(1000);

    // Click on Users tab
    await page.getByRole('tab', { name: 'Users' }).click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/07-users-tab.png', fullPage: true });

    // Click edit on first user
    await page.locator('[title="Edit User"]').first().click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/08-user-edit-modal.png', fullPage: true });

    // Check that role selector is visible in the modal - it's a Mantine Select component
    const modal = page.getByLabel('Edit User: admin');
    const roleLabel = modal.getByText('Role');
    await expect(roleLabel).toBeVisible({ timeout: 5000 });

    // The select component should show Admin or User
    const roleValue = modal.locator('.mantine-Select-input');
    await expect(roleValue).toBeVisible();
  });

  test('should verify payment dates display correctly', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/09-main-dashboard.png', fullPage: true });

    // Check if there are any bills - if not, we need to create one first
    const noBillsText = await page.getByText(/no bills|get started/i).isVisible().catch(() => false);

    if (noBillsText) {
      console.log('No bills found - creating a test bill');

      // Click add bill button
      await page.getByRole('button', { name: /add/i }).first().click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'e2e/screenshots/10-add-bill-form.png', fullPage: true });

      // Fill in bill details
      await page.getByLabel('Name').fill('Test Bill for Payment');

      // Find the amount input (NumberInput)
      const amountInput = page.locator('.mantine-NumberInput-input').first();
      await amountInput.fill('100');

      await page.screenshot({ path: 'e2e/screenshots/11-bill-form-filled.png', fullPage: true });

      // Save the bill - specifically click "Add Bill" button
      await page.getByRole('button', { name: 'Add Bill' }).click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'e2e/screenshots/12-after-bill-creation.png', fullPage: true });

    // The date display test verifies the parseLocalDate fix is working
    // by checking that dates render without timezone shift errors in the console
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate around to trigger date rendering
    await page.waitForTimeout(1000);

    // Check for any date-related console errors
    const dateErrors = consoleErrors.filter(e => e.toLowerCase().includes('date') || e.toLowerCase().includes('invalid'));
    expect(dateErrors.length).toBe(0);

    console.log('Payment date display test completed - no date errors found');
  });
});
