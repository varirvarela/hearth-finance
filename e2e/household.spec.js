import { test, expect } from '@playwright/test';
import { createUser, clearAuth, clearDb, dbWrite, dbRead, signIn, emailKey } from './helpers.js';

// All tests in this file require the Firebase Auth + RTDB emulators.
// In CI, firebase emulators:exec starts them before playwright runs.
// Locally, run: npx firebase emulators:exec --project demo-hearth --only auth,database "npx playwright test e2e/household.spec.js"

test.beforeEach(async () => {
  await clearDb();
  await clearAuth();
});

test.afterEach(async () => {
  await clearDb();
  await clearAuth();
});

// ── Test 1: Owner can send an invite ────────────────────────────

test('owner sends an invite — pendingInvites entry is created', async ({ page }) => {
  const ownerEmail = 'owner@test.com';
  const guestEmail = 'guest@test.com';
  await createUser(ownerEmail, 'password123');

  await page.goto('/');
  await signIn(page, ownerEmail, 'password123');

  // Navigate to Settings
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#household-section', { timeout: 10_000 });

  // Owner view: fill the invite email and send
  await page.fill('#invite-email', guestEmail);
  await page.click('#send-invite');

  // Wait for the status message
  await expect(page.locator('#invite-status')).toContainText(guestEmail, { timeout: 8_000 });

  // Verify Firebase has the invite
  const key = emailKey(guestEmail);
  const invite = await dbRead(`pendingInvites/${key}`);
  expect(invite).not.toBeNull();
  expect(invite.ownerEmail).toBe(ownerEmail);
});

// ── Test 2: Invited user sees join prompt on sign-in ────────────

test('invited user sees join prompt on sign-in', async ({ page }) => {
  const ownerEmail = 'owner2@test.com';
  const guestEmail = 'guest2@test.com';
  const { localId: ownerUid } = await createUser(ownerEmail, 'password123');
  await createUser(guestEmail, 'password123');

  // Pre-seed the pending invite
  const key = emailKey(guestEmail);
  await dbWrite(`pendingInvites/${key}`, {
    ownerUid,
    ownerEmail,
    invitedAt: Date.now(),
  });

  await page.goto('/');
  await signIn(page, guestEmail, 'password123');

  // Overlay should appear with the household invite
  await expect(page.locator('.sheet-title')).toContainText('Household Invite', { timeout: 10_000 });
  await expect(page.locator('.sheet')).toContainText(ownerEmail);
});

// ── Test 3: Member accepts invite and sees owner's transactions ─

test('member accepts invite and sees shared transactions', async ({ page }) => {
  const ownerEmail = 'owner3@test.com';
  const guestEmail = 'guest3@test.com';
  const { localId: ownerUid } = await createUser(ownerEmail, 'password123');
  await createUser(guestEmail, 'password123');

  // Seed a transaction under the owner's namespace
  await dbWrite(`transactions/${ownerUid}/txn_seed_1`, {
    description:    'Shared Grocery Store',
    amount:         42.50,
    date:           '2026-08-01',
    category:       'food_groceries',
    categorySource: 'rule',
    merchantName:   'Whole Foods',
    needsReview:    false,
  });

  // Seed the pending invite
  const key = emailKey(guestEmail);
  await dbWrite(`pendingInvites/${key}`, {
    ownerUid,
    ownerEmail,
    invitedAt: Date.now(),
  });

  await page.goto('/');
  await signIn(page, guestEmail, 'password123');

  // Join prompt appears — click Join
  await page.waitForSelector('.sheet-title', { timeout: 10_000 });
  await page.click('#invite-accept');

  // Overlay dismisses; app mounts with household data
  await page.waitForSelector('.sheet-overlay', { state: 'detached', timeout: 8_000 });

  // Navigate to Transactions
  await page.click('[data-tab="transactions"]');
  await expect(page.locator('#txn-list')).toContainText('Shared Grocery Store', { timeout: 10_000 });

  // Verify Firebase was written correctly
  const { localId: guestUid } = await (async () => {
    const res = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: guestEmail, password: 'password123', returnSecureToken: true }) }
    );
    return res.json();
  })();
  const memberProfile = await dbRead(`users/${guestUid}`);
  expect(memberProfile?.householdId).toBe(ownerUid);

  const members = await dbRead(`households/${ownerUid}/members/${guestUid}`);
  expect(members).not.toBeNull();
  expect(members.email).toBe(guestEmail);
});

// ── Test 4: Member can leave household ─────────────────────────

test('member leaves household from Settings', async ({ page }) => {
  const ownerEmail = 'owner4@test.com';
  const guestEmail = 'guest4@test.com';
  const { localId: ownerUid } = await createUser(ownerEmail, 'password123');
  const { localId: guestUid } = await createUser(guestEmail, 'password123');

  // Pre-seed the member as already joined
  await dbWrite(`users/${guestUid}`, { email: guestEmail, householdId: ownerUid, lastLoginAt: Date.now() });
  await dbWrite(`households/${ownerUid}/members/${guestUid}`, { email: guestEmail, addedAt: Date.now() });

  await page.goto('/');
  await signIn(page, guestEmail, 'password123');

  // Navigate to Settings
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#household-section', { timeout: 10_000 });

  // Member view: click Leave Household (confirm dialog)
  await expect(page.locator('#household-section')).toContainText(ownerEmail, { timeout: 8_000 });
  page.on('dialog', d => d.accept());
  await page.click('#leave-household');

  // Verify Firebase: householdId removed, member deleted
  const profile = await dbRead(`users/${guestUid}`);
  expect(profile?.householdId ?? null).toBeNull();

  const memberEntry = await dbRead(`households/${ownerUid}/members/${guestUid}`);
  expect(memberEntry).toBeNull();
});
