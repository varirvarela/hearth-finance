const PLAID_BASE = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
};

function plaidUrl(env, path) {
  return `${PLAID_BASE[env.PLAID_ENV ?? 'sandbox']}${path}`;
}

function plaidHeaders(env) {
  return {
    'Content-Type':    'application/json',
    'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
    'PLAID-SECRET':    env.PLAID_SECRET,
  };
}

export async function createLinkToken(env, uid) {
  const res = await fetch(plaidUrl(env, '/link/token/create'), {
    method: 'POST',
    headers: plaidHeaders(env),
    body: JSON.stringify({
      user:          { client_user_id: uid },
      client_name:   'Hearth Finance',
      products:      ['transactions'],
      country_codes: ['US'],
      language:      'en',
    }),
  });
  return res.json();
}

export async function exchangePublicToken(env, publicToken) {
  const res = await fetch(plaidUrl(env, '/item/public_token/exchange'), {
    method: 'POST',
    headers: plaidHeaders(env),
    body: JSON.stringify({ public_token: publicToken }),
  });
  return res.json();
}

export async function getAccounts(env, accessToken) {
  const res = await fetch(plaidUrl(env, '/accounts/get'), {
    method: 'POST',
    headers: plaidHeaders(env),
    body: JSON.stringify({ access_token: accessToken }),
  });
  return res.json();
}

export async function getTransactions(env, accessToken, startDate, endDate) {
  const res = await fetch(plaidUrl(env, '/transactions/get'), {
    method: 'POST',
    headers: plaidHeaders(env),
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

// Validates the Firebase ID token passed in Authorization: Bearer <token>
async function getUidFromRequest(request, env) {
  const auth = request.headers.get('Authorization') ?? '';
  const idToken = auth.replace('Bearer ', '').trim();
  if (!idToken) return null;

  // Verify via Firebase Auth REST API
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', body: JSON.stringify({ idToken }), headers: { 'Content-Type': 'application/json' } }
  );
  const data = await res.json();
  return data.users?.[0]?.localId ?? null;
}

export async function handlePlaid(request, env, path) {
  const uid = await getUidFromRequest(request, env);
  if (!uid) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  if (path === '/plaid/link-token' && request.method === 'POST') {
    const data = await createLinkToken(env, uid);
    return new Response(JSON.stringify(data), { headers: CORS });
  }

  if (path === '/plaid/exchange-token' && request.method === 'POST') {
    const { public_token } = await request.json();
    const { access_token, item_id } = await exchangePublicToken(env, public_token);

    // Store access token in KV — never returned to the client
    await env.PLAID_TOKENS.put(`${uid}:${item_id}`, access_token);

    // Write account metadata to RTDB
    const { accounts } = await getAccounts(env, access_token);
    const { fbPatch } = await import('./firebase.js');
    const updates = {};
    for (const a of accounts) {
      updates[`accounts/${uid}/${a.account_id}`] = {
        name:             a.name,
        type:             a.type,
        subtype:          a.subtype,
        institution:      a.official_name ?? a.name,
        plaidItemId:      item_id,
        currentBalance:   a.balances.current ?? 0,
        availableBalance: a.balances.available ?? 0,
        currency:         a.balances.iso_currency_code ?? 'USD',
        lastSync:         new Date().toISOString().slice(0, 10),
        isManual:         false,
        isHidden:         false,
      };
    }
    await fbPatch(env, '', updates);

    return new Response(JSON.stringify({ ok: true, item_id }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS });
}
