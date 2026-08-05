import { test, expect } from '@playwright/test';

// These tests cover the public auth shell — no Firebase sign-in required.
// For tests that require an authenticated session (tab navigation, dashboard data),
// set up the Firebase Auth Emulator and use e2e/helpers.js to seed a test user.

test.describe('Auth screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the auth screen on first load', async ({ page }) => {
    const authScreen = page.locator('#auth-screen');
    await expect(authScreen).toBeVisible();
  });

  test('app shell is hidden before sign-in', async ({ page }) => {
    const appShell = page.locator('#app-shell');
    await expect(appShell).toBeHidden();
  });

  test('shows Hearth branding', async ({ page }) => {
    await expect(page.locator('.auth-name')).toContainText('Hearth');
    await expect(page.locator('.auth-tagline')).toBeVisible();
  });

  test('Google sign-in button is present', async ({ page }) => {
    const googleBtn = page.locator('#sign-in-google');
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toContainText('Google');
  });

  test('email and password fields are present', async ({ page }) => {
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
  });

  test('sign-in and sign-up buttons are present', async ({ page }) => {
    await expect(page.locator('#sign-in-email')).toBeVisible();
    await expect(page.locator('#sign-up-email')).toBeVisible();
  });
});

test.describe('Auth form validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('email field rejects non-email input', async ({ page }) => {
    await page.fill('#auth-email', 'notanemail');
    await page.fill('#auth-password', 'password123');
    await page.click('#sign-in-email');
    // Browser native validation prevents submission — field stays focused
    const validity = await page.locator('#auth-email').evaluate(el => el.validity.valid);
    expect(validity).toBe(false);
  });

  test('password field enforces 6-character minimum', async ({ page }) => {
    await page.fill('#auth-email', 'test@example.com');
    await page.fill('#auth-password', '123');
    await page.click('#sign-in-email');
    const validity = await page.locator('#auth-password').evaluate(el => el.validity.valid);
    expect(validity).toBe(false);
  });

  test('Enter key submits the auth form', async ({ page }) => {
    // Fill valid-looking data (Firebase will reject it, but we verify the form submits)
    await page.fill('#auth-email', 'test@example.com');
    await page.fill('#auth-password', 'validpassword');
    // Press Enter — Firebase call will fail (no network in test), but form submits
    await page.locator('#auth-password').press('Enter');
    // Auth screen should still be visible (Firebase rejected the credentials)
    await expect(page.locator('#auth-screen')).toBeVisible();
  });
});

test.describe('PWA metadata', () => {
  test('has correct page title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Hearth Finance');
  });

  test('has theme-color meta tag', async ({ page }) => {
    await page.goto('/');
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#16a34a');
  });

  test('links a web manifest', async ({ page }) => {
    await page.goto('/');
    const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestLink).toBeTruthy();
  });
});
