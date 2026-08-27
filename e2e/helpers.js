/**
 * Helpers for Playwright e2e tests that require Firebase Auth + RTDB emulators.
 * The emulators are started by `firebase emulators:exec` in CI before these run.
 */

const AUTH_URL = 'http://127.0.0.1:9099';
const DB_URL   = 'http://127.0.0.1:9000';
const PROJECT  = 'demo-hearth';
const DB_NS    = 'demo-hearth-default-rtdb';
const API_KEY  = 'demo-key';

// ── Auth emulator ────────────────────────────────────────────

/** Create a test user and return { localId, idToken, email }. */
export async function createUser(email, password) {
  const res = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!res.ok) throw new Error(`createUser failed: ${await res.text()}`);
  return res.json();
}

/** Delete all Auth emulator users (call in afterEach for isolation). */
export async function clearAuth() {
  await fetch(`${AUTH_URL}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

// ── RTDB emulator ────────────────────────────────────────────
// database.rules.test.json uses ".read/.write: true" so no auth token needed.

/** Write data at a RTDB path (PUT — overwrites). */
export async function dbWrite(path, data) {
  const res = await fetch(`${DB_URL}/${path}.json?ns=${DB_NS}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`dbWrite(${path}) failed: ${await res.text()}`);
}

/** Read data at a RTDB path. Returns parsed JSON (null if missing). */
export async function dbRead(path) {
  const res = await fetch(`${DB_URL}/${path}.json?ns=${DB_NS}`);
  if (!res.ok) throw new Error(`dbRead(${path}) failed: ${await res.text()}`);
  return res.json();
}

/** Delete all RTDB data (call in afterEach for isolation). */
export async function clearDb() {
  await fetch(`${DB_URL}/.json?ns=${DB_NS}`, { method: 'DELETE' });
}

// ── Playwright sign-in helper ────────────────────────────────

/**
 * Fill the email/password auth form and wait for the app shell to appear.
 * The app must be connected to the Auth emulator (VITE_USE_EMULATOR=true).
 */
export async function signIn(page, email, password) {
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await page.click('#sign-in-email');
  // Wait for app shell to become visible (auth-screen hidden, app-shell shown)
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 15_000 });
}

/** Sanitise an email address to a Firebase key (dots → commas). */
export function emailKey(email) {
  return email.trim().toLowerCase().replace(/\./g, ',');
}
