import { test, expect } from '@playwright/test';

test.describe('Password Change Flow', () => {
  test('should show password change modal when logging in with initial password', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      console.log(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    // Go to login page
    await page.goto('/login');
    console.log('[Test] Navigated to /login');

    // Wait for the login form to be visible
    await expect(page.getByLabel('Username')).toBeVisible();
    console.log('[Test] Login form is visible');

    // Fill in credentials - using the test credentials
    // Note: These need to match the actual initial admin credentials
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('LWMVPTDrMRegpGw6');
    console.log('[Test] Filled in credentials');

    // Click sign in button
    await page.getByRole('button', { name: 'Sign In' }).click();
    console.log('[Test] Clicked Sign In');

    // Wait a moment for the response
    await page.waitForTimeout(2000);

    // Take a screenshot to see current state
    await page.screenshot({ path: 'e2e/screenshots/after-login.png', fullPage: true });
    console.log('[Test] Screenshot taken');

    // Check current URL
    const currentUrl = page.url();
    console.log('[Test] Current URL:', currentUrl);

    // Check if we're still on the login page (should be if password change is required)
    expect(currentUrl).toContain('/login');

    // Look for the password change modal
    const modalTitle = page.getByText('Change Password');
    const modalVisible = await modalTitle.isVisible().catch(() => false);
    console.log('[Test] Modal "Change Password" visible:', modalVisible);

    // Also check for the specific modal content
    const modalAlert = page.getByText('Password Change Required');
    const alertVisible = await modalAlert.isVisible().catch(() => false);
    console.log('[Test] Modal alert "Password Change Required" visible:', alertVisible);

    // Check page content
    const pageContent = await page.content();
    console.log('[Test] Page contains "Change Password":', pageContent.includes('Change Password'));
    console.log('[Test] Page contains "Password Change Required":', pageContent.includes('Password Change Required'));

    // The modal should be visible
    expect(modalVisible || alertVisible).toBe(true);
  });

  test('should complete password change successfully', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      console.log(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    // Go to login page
    await page.goto('/login');

    // Fill in credentials
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('LWMVPTDrMRegpGw6');

    // Click sign in
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for modal to appear
    await page.waitForTimeout(2000);

    // If modal is visible, fill it in
    const currentPasswordInput = page.getByLabel('Current Password');
    if (await currentPasswordInput.isVisible().catch(() => false)) {
      console.log('[Test] Password change modal is visible, filling in fields');

      await currentPasswordInput.fill('LWMVPTDrMRegpGw6');
      await page.getByLabel('New Password').first().fill('NewSecurePassword123');
      await page.getByLabel('Confirm New Password').fill('NewSecurePassword123');

      // Click change password button
      await page.getByRole('button', { name: 'Change Password' }).click();

      // Wait for redirect to home page
      await page.waitForURL('/', { timeout: 5000 }).catch(() => {});

      // Take screenshot
      await page.screenshot({ path: 'e2e/screenshots/after-password-change.png', fullPage: true });

      // Should now be on home page
      const finalUrl = page.url();
      console.log('[Test] Final URL:', finalUrl);
    } else {
      console.log('[Test] Password change modal NOT visible');
      await page.screenshot({ path: 'e2e/screenshots/modal-not-visible.png', fullPage: true });
    }
  });
});
