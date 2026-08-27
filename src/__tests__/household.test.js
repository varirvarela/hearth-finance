import { describe, it, expect } from 'vitest';

// --- email key sanitization (mirrors app.js and settings.js) ---
function emailToKey(email) {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

describe('emailToKey', () => {
  it('replaces dots with commas', () => {
    expect(emailToKey('user.name@example.com')).toBe('user,name@example,com');
  });

  it('lowercases the address', () => {
    expect(emailToKey('User@Example.COM')).toBe('user@example,com');
  });

  it('handles addresses with no dots in local part', () => {
    expect(emailToKey('user@example.com')).toBe('user@example,com');
  });

  it('round-trips back to email by reversing commas', () => {
    const email = 'first.last@sub.domain.com';
    expect(emailToKey(email).replace(/,/g, '.')).toBe(email.toLowerCase());
  });
});

// --- household member skip logic (mirrors workers/src/sync.js handleSync loop) ---
function shouldSkipUid(uid, userData) {
  return typeof userData === 'object' && userData?.householdId && userData.householdId !== uid;
}

describe('shouldSkipUid (sync member skip)', () => {
  it('does NOT skip an owner (householdId === uid)', () => {
    expect(shouldSkipUid('uid-owner', { householdId: 'uid-owner', email: 'a@b.com' })).toBeFalsy();
  });

  it('skips a member (householdId !== uid)', () => {
    expect(shouldSkipUid('uid-member', { householdId: 'uid-owner', email: 'b@b.com' })).toBeTruthy();
  });

  it('does NOT skip a solo user with no householdId', () => {
    expect(shouldSkipUid('uid-solo', { email: 'c@b.com' })).toBeFalsy();
  });

  it('does NOT skip when userData is a boolean (legacy presence marker)', () => {
    expect(shouldSkipUid('uid-legacy', true)).toBeFalsy();
  });

  it('does NOT skip when userData is null', () => {
    expect(shouldSkipUid('uid-null', null)).toBeFalsy();
  });

  it('does NOT skip when householdId is empty string', () => {
    expect(shouldSkipUid('uid-x', { householdId: '' })).toBeFalsy();
  });
});

// --- resolveHouseholdId logic (mirrors workers/src/plaid.js and index.js) ---
function resolveHouseholdId(uid, profile) {
  return (typeof profile === 'object' && profile?.householdId) ? profile.householdId : uid;
}

describe('resolveHouseholdId', () => {
  it('returns ownerUid when member has householdId set', () => {
    expect(resolveHouseholdId('member-uid', { householdId: 'owner-uid' })).toBe('owner-uid');
  });

  it('returns own uid when no householdId (solo user)', () => {
    expect(resolveHouseholdId('solo-uid', { email: 'x@y.com' })).toBe('solo-uid');
  });

  it('returns own uid when profile is null (new user, no DB entry yet)', () => {
    expect(resolveHouseholdId('new-uid', null)).toBe('new-uid');
  });

  it('returns own uid when profile is a boolean (legacy)', () => {
    expect(resolveHouseholdId('legacy-uid', true)).toBe('legacy-uid');
  });

  it('returns own uid when householdId is undefined', () => {
    expect(resolveHouseholdId('uid-x', { householdId: undefined })).toBe('uid-x');
  });
});
