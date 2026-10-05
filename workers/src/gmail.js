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
    return json(await syncGmail(env, uid, body.key ?? null, {
      since: body.since ?? null,
      until: body.until ?? null,
      days:  body.days  ?? 7,
    }));
  }
  if (pathname === '/gmail/purge' && request.method === 'POST') {
    return json(await purgeOrders(env, uid));
  }
  if (pathname === '/gmail/suggest-categories' && request.method === 'POST') {
    const { items } = await request.json().catch(() => ({}));
    if (!items?.length) return json({ error: 'Missing items' }, 400);
    return json(await suggestItemCategories(env, items));
  }
  if (pathname === '/gmail/debug-body' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    return json(await debugEmailBody(env, uid, body.key ?? null, body.messageId ?? null));
  }
  if (pathname === '/gmail/import-orders' && request.method === 'POST') {
    const { orders = [] } = await request.json().catch(() => ({}));
    if (!orders.length) return json({ error: 'No orders provided' }, 400);
    return json(await importOrders(env, uid, orders));
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

async function syncGmail(env, uid, specificKey = null, { since = null, until = null, days = 7 } = {}) {
  const { fbGet, fbPatch } = await import('./firebase.js');

  const profile     = await fbGet(env, `users/${uid}`).catch(() => null);
  const householdId = (typeof profile === 'object' && profile?.householdId) ? profile.householdId : uid;

  const status = await getGmailStatus(env, uid);
  const toSync = specificKey
    ? Object.entries(status.accounts).filter(([k]) => k === specificKey)
    : Object.entries(status.accounts);

  if (!toSync.length) throw new Error('No Gmail accounts connected');

  // Compute date window
  const afterDate  = since ? new Date(since) : (() => { const d = new Date(); d.setDate(d.getDate() - days); return d; })();
  const beforeDate = until ? new Date(until) : null;

  // Fetch existing orders once so we can (a) preserve AI suggestions on re-sync and (b) skip re-categorizing
  const existingOrders = await fbGet(env, `amazonOrders/${householdId}`).catch(() => null) ?? {};

  const patch    = {};
  const needsCat = []; // { patchKey, order } for new orders that need AI categorization
  let messages   = 0;
  let parsed     = 0;
  let lastQuery  = '';

  for (const [key] of toSync) {
    const acctData = await fbGet(env, `gmail/${uid}/accounts/${key}`).catch(() => null);
    if (!acctData?.refreshToken) continue;

    const accessToken = await getAccessTokenFromRefresh(env, acctData.refreshToken);

    let query = `{from:auto-confirm@amazon.com from:ship-confirm@amazon.com} after:${Math.floor(afterDate.getTime() / 1000)}`;
    if (beforeDate) query += ` before:${Math.floor(beforeDate.getTime() / 1000)}`;
    lastQuery = query;

    // Paginate through all matching messages
    let pageToken = null;
    do {
      let searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`;
      if (pageToken) searchUrl += `&pageToken=${encodeURIComponent(pageToken)}`;

      const searchData = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json());
      const msgs = searchData.messages ?? [];
      messages  += msgs.length;
      pageToken  = searchData.nextPageToken ?? null;

      if (msgs.length > 0) {
        const msgDataList = await fetchMessagesBatch(accessToken, msgs.map(m => m.id));
        for (const msgData of msgDataList) {
          const order = parseAmazonEmail(msgData);
          if (!order) continue;

          const shortKey = `${key}_${msgData.id}`;
          const patchKey = `amazonOrders/${householdId}/${shortKey}`;
          const existing = existingOrders[shortKey];

          // Preserve existing AI suggestions so a re-sync doesn't wipe them
          const withExisting = existing?.suggestedCategory
            ? { ...order, suggestedCategory: existing.suggestedCategory, suggestedConf: existing.suggestedConf, suggestedSplits: existing.suggestedSplits ?? null }
            : order;

          patch[patchKey] = withExisting;
          parsed++;

          // Queue new orders (no AI suggestion yet) for batch categorization
          if (!existing?.suggestedCategory) needsCat.push({ patchKey, order });
        }
      }
    } while (pageToken);

    patch[`gmail/${uid}/accounts/${key}/lastSync`] = new Date().toISOString();
  }

  // Auto-categorize new orders (category + split suggestions) via Gemini
  if (needsCat.length) {
    try {
      const cats = await batchCategorizeOrders(env, needsCat.map(x => x.order));
      for (let i = 0; i < needsCat.length; i++) {
        const { patchKey } = needsCat[i];
        const cat = cats[i] ?? { category: 'shopping_otros', confidence: 0.5, splits: null };
        if (patch[patchKey]) {
          patch[patchKey].suggestedCategory = cat.category   ?? null;
          patch[patchKey].suggestedConf     = cat.confidence ?? null;
          patch[patchKey].suggestedSplits   = cat.splits     ?? null;
        }
      }
    } catch (e) {
      console.error('Auto-categorization failed:', e);
    }
  }

  if (Object.keys(patch).length) await fbPatch(env, '', patch);
  return { messages, parsed, query: lastQuery, householdId, categorized: needsCat.length };
}

async function purgeOrders(env, uid) {
  const { fbGet, fbSet } = await import('./firebase.js');
  const profile     = await fbGet(env, `users/${uid}`).catch(() => null);
  const householdId = (typeof profile === 'object' && profile?.householdId) ? profile.householdId : uid;
  await fbSet(env, `amazonOrders/${householdId}`, null);
  return { ok: true };
}

// Fetch multiple Gmail message bodies in a single batch HTTP request
async function fetchMessagesBatch(accessToken, messageIds) {
  if (!messageIds.length) return [];

  const boundary = 'hearth_' + Date.now();
  const reqBody  = messageIds.map(id =>
    `--${boundary}\r\nContent-Type: application/http\r\n\r\nGET /gmail/v1/users/me/messages/${id}?format=full\r\n`,
  ).join('') + `--${boundary}--`;

  const resp = await fetch('https://gmail.googleapis.com/batch/gmail/v1', {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/mixed; boundary="${boundary}"` },
    body:    reqBody,
  });

  const text     = await resp.text();
  const bndMatch = (resp.headers.get('Content-Type') ?? '').match(/boundary="?([^";,]+)"?/i);
  if (!bndMatch) return [];

  const results = [];
  for (const part of text.split(`--${bndMatch[1]}`).slice(1)) {
    if (part.trimStart().startsWith('--')) break;
    // Each part: multipart headers \r\n\r\n HTTP-response-status+headers \r\n\r\n JSON-body
    const mpEnd   = part.indexOf('\r\n\r\n');
    if (mpEnd   === -1) continue;
    const httpEnd = part.indexOf('\r\n\r\n', mpEnd + 4);
    if (httpEnd === -1) continue;
    const jsonStr = part.slice(httpEnd + 4).trim();
    try { const d = JSON.parse(jsonStr); if (d?.id) results.push(d); } catch { /* skip */ }
  }
  return results;
}

// ── Email parsing ─────────────────────────────────────────────────────────────

function parseAmazonEmail(msgData) {
  const headers = msgData.payload?.headers ?? [];
  const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
  const dateStr = headers.find(h => h.name === 'Date')?.value   ?? '';

  // Normalize \r\n to \n before parsing — Amazon emails use Windows line endings
  const textBody = extractTextBody(msgData.payload).replace(/\r\n/g, '\n');
  const { items, total, orderNumber, tax, credits } = parseAmazonBody(textBody);
  if (!total) return null;

  let finalItems = items;

  // Amazon order confirmation text/plain has NO item names — try subject then HTML
  if (!finalItems.length) {
    finalItems = extractItemsFromSubject(subject);
  }
  if (!finalItems.length) {
    const htmlText = extractHtmlBody(msgData.payload).replace(/\r\n/g, '\n');
    if (htmlText) {
      const { items: htmlItems } = parseAmazonBody(htmlText);
      finalItems = htmlItems;
    }
  }

  let shipDate = '';
  try { shipDate = new Date(dateStr).toISOString().slice(0, 10); } catch { shipDate = ''; }

  return {
    subject,
    shipDate,
    total,
    orderNumber: orderNumber ?? null,
    items:       finalItems,
    tax:         tax     ?? null,
    credits:     credits ?? null,
    gmailMessageId: msgData.id,
    parsedAt: new Date().toISOString(),
  };
}

// Extract item name(s) from the email subject when the body has none
function extractItemsFromSubject(subject) {
  // "Ordered 1 item: Acer Chromebook 315..." (Amazon.com)
  const m = subject.match(/[Oo]rdered\s+1\s+items?\s*:\s*(.+)/);
  if (m) return [{ name: m[1].trim(), price: null }];
  // Spanish: "Has pedido 1 artículo: Nombre del producto"
  const m2 = subject.match(/[Hh]as\s+pedido\s+1\s+art[íi]culos?\s*:\s*(.+)/);
  if (m2) return [{ name: m2[1].trim(), price: null }];
  return [];
}

// Extract text/plain body only (no HTML fallback)
function extractTextBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64decode(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return b64decode(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/')) {
        const sub = extractTextBody(part);
        if (sub) return sub;
      }
    }
  }
  return '';
}

// Extract and strip HTML body only
function extractHtmlBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) return stripHtml(b64decode(payload.body.data));
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(b64decode(part.body.data));
      if (part.mimeType?.startsWith('multipart/')) {
        const sub = extractHtmlBody(part);
        if (sub) return sub;
      }
    }
  }
  return '';
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
    // Preserve line breaks at block/cell boundaries so item sections stay parseable
    .replace(/<\/?(br|p|div|tr|li|h[1-6]|table|section|article)[^>]*>/gi, '\n')
    .replace(/<\/td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace only
    .replace(/\n[ \t]+/g, '\n')        // trim leading spaces on each line
    .replace(/\n{3,}/g, '\n\n')        // max two consecutive blank lines
    .trim();
}

// Normalize amount strings from both US ("1,234.56") and European ("1.234,56") formats
function normalizeAmount(s) {
  const t = s.trim();
  // European: ends with comma + 2 digits (e.g. "25,99" or "1.234,56")
  if (/,\d{2}$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  // US: remove thousands commas
  return parseFloat(t.replace(/,/g, ''));
}

function parseAmazonBody(text) {
  let total       = null;
  let orderNumber = null;
  const items     = [];

  const orderMatch = text.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (orderMatch) orderNumber = orderMatch[1];

  // Amount pattern covers $1,234.56 / €1.234,56 / bare 25,99 / 25.99
  const AMT = /(?:[\$€£])?\s*([\d.,]+)/;
  const totalPatterns = [
    /[Ss]hipment\s+[Tt]otal\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Oo]rder\s+[Tt]otal\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Gg]rand\s+[Tt]otal\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]otal\s+[Cc]harged\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    // Spanish
    /[Tt]otal\s+del\s+pedido\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Ii]mporte\s+total\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]otal\s+a\s+pagar\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]otal\s+del\s+env[íi]o\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    // Generic fallback — "Total: €25,99" or "Total: $25.99"
    /[Tt]otal\s*:?\s*(?:[\$€£])\s*([\d.,]+)/,
  ];
  for (const pat of totalPatterns) {
    const m = text.match(pat);
    if (m) { total = normalizeAmount(m[1]); break; }
  }

  const skip = /total|shipping|handling|\btax\b|subtotal|discount|coupon|savings|gift\s*card|fee|delivery|gastos|impuesto|env[íi]o|amazon|hola|estimad|pedido|enviado|confirma|direcci|address|order\s*#|art[íi]culo|qty|cantidad|units?|unidad/i;

  // Phase 1: items with explicit price (currency symbol present)
  // Allow up to 150 chars for item names (long product titles are common)
  const itemPat = /(.{4,150}?)\s+(?:[\$€£])\s*([\d.,]+)/g;
  let m;
  while ((m = itemPat.exec(text)) !== null) {
    const name  = m[1].trim();
    const price = normalizeAmount(m[2]);
    if (!skip.test(name) && price > 0 && price < 5000 && name.length > 5) {
      items.push({ name, price });
    }
  }

  // Phase 2: if no priced items found, extract names from the shipped-items section.
  // Amazon shipment notifications list item names without per-item prices.
  if (!items.length) {
    // Colon is required — avoids false matches on navigation words like "Shipped", "Ordered"
    const sectionPat = /(?:art[íi]culo|items?\s+(?:in\s+this\s+shipment|ordered|enviados?)|producto)[^:\n]*:\s*\n([\s\S]*?)(?=\n\s*(?:order|total|subtotal|precio|price|importe|tracking|seguimiento|deliver|direcci|address|return\s+by|devoluci))/i;
    const sec = text.match(sectionPat);
    if (sec) {
      const skip2 = /total|shipping|handling|\btax\b|subtotal|fee|delivery|tracking|track\s+your|package|return\s+by|qty|sold\s+by|fulfilled|amazon\.com|condition:|prime|visit/i;
      for (const line of sec[1].split('\n')) {
        // Remove leading quantity patterns: "1 of: ", "2x ", "3 × ", etc.
        const name = line.trim()
          .replace(/^\d+\s*(?:of\s*:?\s*|[×x]\s*)/i, '')
          .replace(/^[\-\*\.\s]+/, '')
          .trim();
        if (
          name.length > 8 && name.length < 200
          && !skip2.test(name)
          && !/^\d+$/.test(name)
          && !/^\d{1,2}\/\d{1,2}/.test(name)
          && !/^https?:/i.test(name)
        ) {
          items.push({ name, price: null });
        }
      }
    }
  }

  // Tax extraction
  let tax = null;
  const taxPats = [
    /[Ee]stimated\s+[Tt]ax\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Ss]ales\s+[Tt]ax\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /\b[Tt]ax\s*:?\s*(?:[\$€£])\s*([\d.,]+)/,
    /[Ii]mpuesto\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
  ];
  for (const p of taxPats) { const m = text.match(p); if (m) { tax = normalizeAmount(m[1]); break; } }

  // Gift card / promo credits
  let credits = null;
  const creditPats = [
    /[Gg]ift\s+[Cc]ard\s+[Aa]pplied\s*:?\s*-?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Pp]romotional\s+[Cc]redit\s*:?\s*-?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Aa]mazon\s+[Cc]redit\s*:?\s*-?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]arjeta\s+[Rr]egalo\s*:?\s*-?\s*(?:[\$€£])?\s*([\d.,]+)/,
  ];
  for (const p of creditPats) { const m = text.match(p); if (m) { credits = normalizeAmount(m[1]); break; } }

  return { items, total, orderNumber, tax, credits };
}

// ── Debug: inspect raw email body ────────────────────────────────────────────

async function debugEmailBody(env, uid, specificKey = null, specificMessageId = null) {
  const { fbGet } = await import('./firebase.js');

  const status = await getGmailStatus(env, uid);
  const key = specificKey ?? Object.keys(status.accounts ?? {})[0];
  if (!key) throw new Error('No Gmail accounts connected');

  const acctData = await fbGet(env, `gmail/${uid}/accounts/${key}`).catch(() => null);
  if (!acctData?.refreshToken) throw new Error('No refresh token for account: ' + key);

  const accessToken = await getAccessTokenFromRefresh(env, acctData.refreshToken);

  let messageId = specificMessageId;
  if (!messageId) {
    const query = '{from:auto-confirm@amazon.com from:ship-confirm@amazon.com}';
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`;
    const searchData = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json());
    messageId = searchData.messages?.[0]?.id;
    if (!messageId) return { error: 'No Amazon emails found' };
  }

  const msgData = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  ).then(r => r.json());

  const headers = msgData.payload?.headers ?? [];
  const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
  const dateStr = headers.find(h => h.name === 'Date')?.value ?? '';

  const mimeStructure = describeMime(msgData.payload);
  const bodyText = extractBody(msgData.payload);
  const parsed = parseAmazonBody(bodyText);

  return {
    messageId,
    subject,
    date: dateStr,
    mimeStructure,
    bodyLength: bodyText.length,
    bodyText,   // full text for debugging
    parsed,
  };
}

function describeMime(payload, depth = 0) {
  if (!payload) return null;
  const info = { mimeType: payload.mimeType, hasData: !!(payload.body?.data), size: payload.body?.size ?? 0 };
  if (payload.parts?.length) info.parts = payload.parts.map(p => describeMime(p, depth + 1));
  return info;
}

// ── AI category suggestions for order items ───────────────────────────────────

async function suggestItemCategories(env, items) {
  const { CATEGORIES } = await import('../../src/shared/categories.js');
  const expenseCats = CATEGORIES.filter(c => c.parent && !c.hide && !c.isIncome && c.parent !== 'transfer');
  const catList = expenseCats.map(c => `${c.id}: ${c.label}`).join('\n');

  const prompt = `You are categorizing Amazon order items for a household budget app.
Given each item name, pick the most appropriate expense category from this list:
${catList}

Items to categorize:
${items.map((it, i) => `${i + 1}. ${it.name}${it.price != null ? ` (€${it.price})` : ''}`).join('\n')}

Respond with JSON only — an array with one entry per item:
[{"item": "<name>", "category": "<category_id>", "confidence": <0.0-1.0>}]`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );

  const data = await resp.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]';
  try {
    return { suggestions: JSON.parse(jsonStr) };
  } catch {
    return { suggestions: items.map(it => ({ item: it.name, category: 'shopping_otros', confidence: 0.5 })) };
  }
}

// ── CSV order import ──────────────────────────────────────────────────────────

async function importOrders(env, uid, orders) {
  const { fbGet, fbPatch } = await import('./firebase.js');
  const profile = await fbGet(env, `users/${uid}`).catch(() => null);
  const hid = profile?.householdId ?? uid;

  const existing = await fbGet(env, `amazonOrders/${hid}`).catch(() => null) ?? {};
  const existingNums = new Set(Object.values(existing).map(o => o.orderNumber).filter(Boolean));

  const newOrders = orders.filter(o => o.orderNumber && !existingNums.has(o.orderNumber));
  if (!newOrders.length) return { imported: 0, skipped: orders.length, errors: 0 };

  let categorized;
  try {
    categorized = await batchCategorizeOrders(env, newOrders);
  } catch {
    categorized = newOrders.map(() => ({ category: 'shopping_otros', confidence: 0.5 }));
  }

  const writes = {};
  for (let i = 0; i < newOrders.length; i++) {
    const o = newOrders[i];
    const cat = categorized[i] ?? { category: 'shopping_otros', confidence: 0.5 };
    const key = `csv_${o.orderNumber.replace(/[^a-zA-Z0-9]/g, '_')}`;
    writes[key] = {
      orderNumber:       o.orderNumber,
      shipDate:          o.shipDate ?? null,
      total:             o.total,
      items:             o.items ?? [],
      suggestedCategory: cat.category   ?? null,
      suggestedConf:     cat.confidence ?? null,
      suggestedSplits:   cat.splits     ?? null,
      source:            'csv',
      parsedAt:          new Date().toISOString(),
    };
  }

  await fbPatch(env, `amazonOrders/${hid}`, writes);
  return { imported: newOrders.length, skipped: orders.length - newOrders.length, errors: 0 };
}

async function batchCategorizeOrders(env, orders) {
  const { CATEGORIES } = await import('../../src/shared/categories.js');
  const expenseCats = CATEGORIES.filter(c => c.parent && !c.hide && !c.isIncome && c.parent !== 'transfer');
  const catList = expenseCats.map(c => `${c.id}: ${c.label ?? c.name}`).join('\n');

  const prompt = `You are categorizing Amazon orders for a household budget app.

For each order, pick the best expense category. If items clearly fall into 2-3 DISTINCT spending areas (e.g. electronics + food, or clothing + health products), include split fractions. Only suggest splits when genuinely different — not subcategories of the same thing. Each split fraction must be ≥ 0.15.

Categories:
${catList}

Orders:
${orders.map((o, i) => {
    const itemsStr = (o.items ?? []).map(it => it.name + (it.price != null ? ` ($${it.price})` : '')).filter(Boolean).join(', ') || '(no items listed)';
    return `${i + 1}. Items: ${itemsStr}${o.total ? ` | Total: $${o.total}` : ''}`;
  }).join('\n')}

Respond with JSON only — one object per order, same order:
[{"orderIndex":1,"category":"cat_id","confidence":0.9,"splits":null}]

When splits apply: {"orderIndex":2,"category":"dominant_cat","confidence":0.8,"splits":[{"category":"cat1","fraction":0.6},{"category":"cat2","fraction":0.4}]}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );

  const data = await resp.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]';
  try {
    const parsed = JSON.parse(jsonStr);
    return orders.map((_, i) => {
      const p = parsed.find(x => x.orderIndex === i + 1) ?? {};
      return {
        category:   p.category   ?? 'shopping_otros',
        confidence: p.confidence ?? 0.5,
        splits:     Array.isArray(p.splits) && p.splits.length > 1 ? p.splits : null,
      };
    });
  } catch {
    return orders.map(() => ({ category: 'shopping_otros', confidence: 0.5, splits: null }));
  }
}

// ── Daily cron: sync all Gmail-connected households ───────────────────────────

export async function handleAmazonDailySync(env) {
  const { fbGet } = await import('./firebase.js');
  const allGmail = await fbGet(env, 'gmail').catch(() => null);
  if (!allGmail || typeof allGmail !== 'object') return;
  for (const uid of Object.keys(allGmail)) {
    try {
      await syncGmail(env, uid, null, { days: 1 });
    } catch (e) {
      console.error(`Amazon daily sync failed for ${uid}:`, e.message);
    }
  }
}
