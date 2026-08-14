const PLAID_BASE = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
};

function plaidUrl(env, path) {
  return `${PLAID_BASE[env.PLAID_ENV ?? 'sandbox']}${path}`;
}

// Supports two Plaid accounts (slots 1 and 2) to stay within the 10-item
// free tier per account. Falls back to the un-numbered vars for slot 1
// so existing single-account setups continue to work.
function plaidHeaders(env, slot = 1) {
  const clientId = slot === 2
    ? env.PLAID_CLIENT_ID_2
    : (env.PLAID_CLIENT_ID_1 ?? env.PLAID_CLIENT_ID);
  const secret = slot === 2
    ? env.PLAID_SECRET_2
    : (env.PLAID_SECRET_1 ?? env.PLAID_SECRET);
  return {
    'Content-Type':    'application/json',
    'PLAID-CLIENT-ID': clientId,
    'PLAID-SECRET':    secret,
  };
}

// Determines which slot (1 or 2) to use when linking a new account.
// Counts how many Items are already linked via slot 1 for this user;
// once that reaches ITEMS_PER_SLOT, overflow goes to slot 2.
const ITEMS_PER_SLOT = 10;

async function chooseSlot(env, uid) {
  const { fbGet } = await import('./firebase.js');
  const accounts = await fbGet(env, `accounts/${uid}`).catch(() => null);
  if (!accounts) return 1;
  const slot1Count = Object.values(accounts).filter(a => !a.isManual && (a.plaidSlot ?? 1) === 1).length;
  return slot1Count < ITEMS_PER_SLOT ? 1 : 2;
}

export async function createLinkToken(env, uid, slot) {
  const isSandbox = env.PLAID_ENV === 'sandbox';
  const res = await fetch(plaidUrl(env, '/link/token/create'), {
    method: 'POST',
    headers: plaidHeaders(env, slot),
    body: JSON.stringify({
      user: {
        client_user_id: uid,
        ...(isSandbox && {
          phone_number:               '+15005550006',
          phone_number_verified_time: new Date().toISOString(),
        }),
      },
      client_name:   'Hearth Finance',
      products:      ['transactions'],
      country_codes: ['US'],
      language:      'en',
    }),
  });
  const plaidText = await res.text();
  try { return JSON.parse(plaidText); } catch { throw new Error(`Plaid returned non-JSON (${res.status}): ${plaidText.slice(0, 200)}`); }
}

export async function createReconnectToken(env, uid, accessToken, slot) {
  const res = await fetch(plaidUrl(env, '/link/token/create'), {
    method: 'POST',
    headers: plaidHeaders(env, slot),
    body: JSON.stringify({
      user:          { client_user_id: uid },
      client_name:   'Hearth Finance',
      access_token:  accessToken,
      country_codes: ['US'],
      language:      'en',
    }),
  });
  const plaidText = await res.text();
  try { return JSON.parse(plaidText); } catch { throw new Error(`Plaid returned non-JSON (${res.status}): ${plaidText.slice(0, 200)}`); }
}

export async function exchangePublicToken(env, publicToken, slot) {
  const res = await fetch(plaidUrl(env, '/item/public_token/exchange'), {
    method: 'POST',
    headers: plaidHeaders(env, slot),
    body: JSON.stringify({ public_token: publicToken }),
  });
  return res.json();
}

export async function getAccounts(env, accessToken, slot) {
  const res = await fetch(plaidUrl(env, '/accounts/get'), {
    method: 'POST',
    headers: plaidHeaders(env, slot),
    body: JSON.stringify({ access_token: accessToken }),
  });
  return res.json();
}

export async function getTransactions(env, accessToken, startDate, endDate, slot = 1) {
  const res = await fetch(plaidUrl(env, '/transactions/get'), {
    method: 'POST',
    headers: plaidHeaders(env, slot),
    body: JSON.stringify({
      access_token: accessToken,
      start_date:   startDate,
      end_date:     endDate,
      options:      { count: 500, offset: 0, include_personal_finance_category: true },
    }),
  });
  return res.json();
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function getUidFromRequest(request, env) {
  const idToken = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!idToken) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', body: JSON.stringify({ idToken }), headers: { 'Content-Type': 'application/json' } },
  );
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`identitytoolkit returned non-JSON (${res.status}): ${text.slice(0, 200)}`); }
  return data.users?.[0]?.localId ?? null;
}

export async function handlePlaid(request, env, path) {
  const uid = await getUidFromRequest(request, env);
  if (!uid) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  if (path === '/plaid/link-token' && request.method === 'POST') {
    const slot = await chooseSlot(env, uid);
    const data = await createLinkToken(env, uid, slot);
    // Return the slot so the frontend can pass it back during exchange
    return new Response(JSON.stringify({ ...data, slot }), { headers: CORS });
  }

  if (path === '/plaid/reconnect-token' && request.method === 'POST') {
    const { itemId, slot = 1 } = await request.json();
    const token = await env.PLAID_TOKENS.get(`s${slot}:${uid}:${itemId}`);
    if (!token) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS });
    const data = await createReconnectToken(env, uid, token, slot);
    return new Response(JSON.stringify({ ...data, slot }), { headers: CORS });
  }

  if (path === '/plaid/exchange-token' && request.method === 'POST') {
    const { public_token, slot = 1 } = await request.json();
    const { access_token, item_id } = await exchangePublicToken(env, public_token, slot);

    // KV key includes slot prefix so tokens from different accounts never collide
    await env.PLAID_TOKENS.put(`s${slot}:${uid}:${item_id}`, access_token);

    const { accounts } = await getAccounts(env, access_token, slot);
    const { fbPatch } = await import('./firebase.js');
    const updates = {};
    for (const a of accounts) {
      updates[`accounts/${uid}/${a.account_id}`] = {
        name:             a.name,
        type:             a.type,
        subtype:          a.subtype,
        institution:      a.official_name ?? a.name,
        plaidItemId:      item_id,
        plaidSlot:        slot,
        currentBalance:   a.balances.current    ?? 0,
        availableBalance: a.balances.available  ?? 0,
        currency:         a.balances.iso_currency_code ?? 'USD',
        lastSync:         new Date().toISOString().slice(0, 10),
        isManual:         false,
        isHidden:         false,
      };
    }
    await fbPatch(env, '', updates);

    return new Response(JSON.stringify({ ok: true, item_id, slot }), { headers: CORS });
  }

  if (path === '/plaid/remove-account' && request.method === 'POST') {
    const { itemId, slot = 1, deleteTransactions = false } = await request.json();

    // 1. Get the access token before deleting it from KV
    const accessToken = await env.PLAID_TOKENS.get(`s${slot}:${uid}:${itemId}`);

    // 2. Remove KV token
    await env.PLAID_TOKENS.delete(`s${slot}:${uid}:${itemId}`);

    // 3. Find and null-out all accounts for this item in Firebase
    const { fbGet, fbPatch } = await import('./firebase.js');
    const accounts = await fbGet(env, `accounts/${uid}`).catch(() => ({})) ?? {};
    const patch = {};
    let removed = 0;
    for (const [key, acct] of Object.entries(accounts)) {
      if (acct.plaidItemId === itemId) {
        patch[`accounts/${uid}/${key}`] = null;
        removed++;
      }
    }

    // 4. Optionally delete transactions for this item
    if (deleteTransactions) {
      const txns = await fbGet(env, `transactions/${uid}`).catch(() => ({})) ?? {};
      for (const [key, txn] of Object.entries(txns)) {
        if (txn.plaidItemId === itemId) patch[`transactions/${uid}/${key}`] = null;
      }
    }

    // 5. Write the Firebase patch
    if (Object.keys(patch).length) await fbPatch(env, '', patch);

    // 6. Tell Plaid to revoke the item (best-effort — don't fail if it errors)
    if (accessToken) {
      fetch(plaidUrl(env, '/item/remove'), {
        method: 'POST',
        headers: plaidHeaders(env, slot),
        body: JSON.stringify({ access_token: accessToken }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, removed }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS });
}
