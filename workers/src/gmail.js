const GMAIL_CLIENT_ID = '479821033709-4rk9nvhqf5affdtbb72irh0mg7r090ru.apps.googleusercontent.com';
const REDIRECT_URI    = 'https://varirvarela.github.io/hearth-finance/';
const GMAIL_SCOPE     = 'https://www.googleapis.com/auth/gmail.readonly';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

export async function handleGmail(request, env, pathname, uid) {
  if (pathname === '/gmail/auth-url' && request.method === 'GET') {
    return json({ url: buildAuthUrl() });
  }
  if (pathname === '/gmail/connect' && request.method === 'POST') {
    const { code, key = 'main' } = await request.json();
    if (!code) return json({ error: 'Missing code' }, 400);
    await connectGmail(env, uid, code, key);
    return json({ ok: true });
  }
  if (pathname === '/gmail/status' && request.method === 'GET') {
    return json(await getGmailStatus(env, uid));
  }
  if (pathname === '/gmail/sync' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    return json(await syncGmail(env, uid, body.key ?? null));
  }
  if (pathname === '/gmail/disconnect' && request.method === 'POST') {
    const { key = 'main' } = await request.json();
    await disconnectGmail(env, uid, key);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// ── Auth URL ──────────────────────────────────────────────────────────────────

export function buildAuthUrl(key = 'main') {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id:     GMAIL_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         GMAIL_SCOPE,
    access_type:   'offline',
    prompt:        'consent',
    state:         `gmail-connect:${key}`,
  })}`;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

async function exchangeCode(env, code) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     GMAIL_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data;
}

async function getAccessTokenFromRefresh(env, storedRefreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      refresh_token: storedRefreshToken,
      client_id:     GMAIL_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data.access_token;
}

async function fetchGmailEmail(accessToken) {
  try {
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await resp.json();
    return data.emailAddress ?? null;
  } catch { return null; }
}

// ── Account CRUD ──────────────────────────────────────────────────────────────

async function connectGmail(env, uid, code, key = 'main') {
  const { fbPatch, fbSet } = await import('./firebase.js');
  const tokens = await exchangeCode(env, code);
  const email  = await fetchGmailEmail(tokens.access_token);

  // Migrate old single-account schema if present
  const { fbGet } = await import('./firebase.js');
  const raw = await fbGet(env, `gmail/${uid}`).catch(() => null);
  if (raw?.refreshToken && !raw?.accounts) {
    await fbSet(env, `gmail/${uid}`, {
      accounts: {
        main: {
          refreshToken: raw.refreshToken,
          connected:    true,
          connectedAt:  raw.connectedAt ?? new Date().toISOString(),
          lastSync:     raw.lastSync ?? null,
          email:        null,
        },
      },
    });
  }

  await fbPatch(env, `gmail/${uid}/accounts/${key}`, {
    refreshToken: tokens.refresh_token,
    connected:    true,
    connectedAt:  new Date().toISOString(),
    lastSync:     null,
    email:        email ?? null,
  });
}

async function getGmailStatus(env, uid) {
  const { fbGet, fbSet } = await import('./firebase.js');
  const raw = await fbGet(env, `gmail/${uid}`).catch(() => null);
  if (!raw) return { accounts: {} };

  // Migrate old single-account schema
  if (raw.refreshToken && !raw.accounts) {
    const migrated = {
      main: {
        refreshToken: raw.refreshToken,
        connected:    raw.connected ?? true,
        connectedAt:  raw.connectedAt ?? new Date().toISOString(),
        lastSync:     raw.lastSync ?? null,
        email:        null,
      },
    };
    await fbSet(env, `gmail/${uid}`, { accounts: migrated });
    return { accounts: { main: { connected: true, lastSync: migrated.main.lastSync, email: null } } };
  }

  const accounts = {};
  for (const [key, acct] of Object.entries(raw.accounts ?? {})) {
    if (acct?.connected) {
      accounts[key] = { connected: true, lastSync: acct.lastSync ?? null, email: acct.email ?? null };
    }
  }
  return { accounts };
}

async function disconnectGmail(env, uid, key = 'main') {
  const { fbSet } = await import('./firebase.js');
  await fbSet(env, `gmail/${uid}/accounts/${key}`, null);
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function syncGmail(env, uid, specificKey = null) {
  const { fbGet, fbPatch } = await import('./firebase.js');

  // Resolve household so orders land under the shared namespace
  const profile     = await fbGet(env, `users/${uid}`).catch(() => null);
  const householdId = (typeof profile === 'object' && profile?.householdId) ? profile.householdId : uid;

  const status = await getGmailStatus(env, uid);
  const toSync = specificKey
    ? Object.entries(status.accounts).filter(([k]) => k === specificKey)
    : Object.entries(status.accounts);

  if (!toSync.length) throw new Error('No Gmail accounts connected');

  const patch  = {};
  let messages = 0;
  let parsed   = 0;

  for (const [key] of toSync) {
    const acctData = await fbGet(env, `gmail/${uid}/accounts/${key}`).catch(() => null);
    if (!acctData?.refreshToken) continue;

    const accessToken = await getAccessTokenFromRefresh(env, acctData.refreshToken);

    let query = 'from:ship-confirm@amazon.com';
    if (acctData.lastSync) {
      const after = new Date(acctData.lastSync);
      after.setDate(after.getDate() - 1);
      query += ` after:${Math.floor(after.getTime() / 1000)}`;
    }

    const searchResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const searchData = await searchResp.json();
    const msgs = searchData.messages ?? [];
    messages  += msgs.length;

    for (const msg of msgs) {
      const msgResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const msgData = await msgResp.json();
      const order   = parseAmazonEmail(msgData);
      if (order) {
        // Prefix msg id with account key so orders from different accounts never collide
        patch[`amazonOrders/${householdId}/${key}_${msg.id}`] = order;
        parsed++;
      }
    }

    patch[`gmail/${uid}/accounts/${key}/lastSync`] = new Date().toISOString();
  }

  if (Object.keys(patch).length) await fbPatch(env, '', patch);
  return { messages, parsed };
}

// ── Email parsing ─────────────────────────────────────────────────────────────

function parseAmazonEmail(msgData) {
  const headers = msgData.payload?.headers ?? [];
  const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
  const dateStr = headers.find(h => h.name === 'Date')?.value   ?? '';

  if (!/ship/i.test(subject)) return null;

  const body = extractBody(msgData.payload);
  if (!body) return null;

  const { items, total, orderNumber } = parseAmazonBody(body);
  if (!total) return null;

  let shipDate = '';
  try { shipDate = new Date(dateStr).toISOString().slice(0, 10); } catch { shipDate = ''; }

  return {
    subject,
    shipDate,
    total,
    orderNumber: orderNumber ?? null,
    items,
    gmailMessageId: msgData.id,
    parsedAt: new Date().toISOString(),
  };
}

function extractBody(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return b64decode(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return b64decode(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(b64decode(part.body.data));
      if (part.mimeType?.startsWith('multipart/')) {
        const sub = extractBody(part);
        if (sub) return sub;
      }
    }
  }

  return '';
}

function b64decode(encoded) {
  return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmazonBody(text) {
  let total       = null;
  let orderNumber = null;
  const items     = [];

  const orderMatch = text.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (orderMatch) orderNumber = orderMatch[1];

  const totalPatterns = [
    /[Ss]hipment\s+[Tt]otal\s*:?\s*\$?([\d,]+\.\d{2})/,
    /[Oo]rder\s+[Tt]otal\s*:?\s*\$?([\d,]+\.\d{2})/,
    /[Gg]rand\s+[Tt]otal\s*:?\s*\$?([\d,]+\.\d{2})/,
    /[Tt]otal\s+[Cc]harged\s*:?\s*\$?([\d,]+\.\d{2})/,
    /[Tt]otal\s*:?\s*\$?([\d,]+\.\d{2})/,
  ];
  for (const pat of totalPatterns) {
    const m = text.match(pat);
    if (m) { total = parseFloat(m[1].replace(/,/g, '')); break; }
  }

  const skip    = /total|shipping|handling|\btax\b|subtotal|discount|coupon|savings|gift\s*card|fee|delivery/i;
  const itemPat = /(.{4,80}?)\s+\$([\d,]+\.?\d{0,2})/g;
  let m;
  while ((m = itemPat.exec(text)) !== null) {
    const name  = m[1].trim();
    const price = parseFloat(m[2].replace(/,/g, ''));
    if (!skip.test(name) && price > 0 && price < 5000 && name.length > 3) {
      items.push({ name, price });
    }
  }

  return { items, total, orderNumber };
}
