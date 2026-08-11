// Firebase RTDB via REST using a Google service account OAuth2 token.
// Credentials come from FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY
// (extracted from service-account.json — already in the project).

// Module-level token cache — valid for the lifetime of a Worker instance.
let _token = null;
let _tokenExpiresAt = 0;

async function getAccessToken(env) {
  if (_token && Date.now() < _tokenExpiresAt) return _token;

  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   env.FIREBASE_CLIENT_EMAIL,
    sub:   env.FIREBASE_CLIENT_EMAIL,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
  };

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const input   = `${header}.${payload}`;

  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig  = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(input),
  );
  const jwt = `${input}.${b64urlBuf(sig)}`;

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const { access_token, error } = await res.json();
  if (!access_token) throw new Error(`Firebase OAuth failed: ${error}`);

  _token          = access_token;
  _tokenExpiresAt = Date.now() + 55 * 60 * 1000; // refresh 5 min before expiry
  return _token;
}

function b64url(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlBuf(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function importPrivateKey(pem) {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const der    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
}

async function url(env, path) {
  const token = await getAccessToken(env);
  const base  = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  return `${base}/${path}.json?access_token=${token}`;
}

export async function fbGet(env, path) {
  const res = await fetch(await url(env, path));
  if (!res.ok) throw new Error(`fbGet ${path}: ${res.status}`);
  return res.json();
}

export async function fbSet(env, path, data) {
  const res = await fetch(await url(env, path), {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`fbSet ${path}: ${res.status}`);
  return res.json();
}

export async function fbPatch(env, path, data) {
  const res = await fetch(await url(env, path), {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`fbPatch ${path}: ${res.status}`);
  return res.json();
}

export async function fbPush(env, path, data) {
  const res = await fetch(await url(env, path), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`fbPush ${path}: ${res.status}`);
  return res.json();
}
