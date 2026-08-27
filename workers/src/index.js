import { handlePlaid }                    from './plaid.js';
import { handleSync, handleUserSync }     from './sync.js';
import { categorizeTransaction }          from './categorize.js';

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

// Extract UID from a Firebase JWT without full JWKS verification.
// The actual security boundary is Firebase RTDB rules — this is for routing only.
function uidFromJwt(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.sub ?? decoded.user_id ?? null;
  } catch { return null; }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const { pathname } = new URL(request.url);

    try {
      if (pathname.startsWith('/plaid/')) return await handlePlaid(request, env, pathname);

      if (pathname === '/sync' && request.method === 'POST') {
        const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const uid   = uidFromJwt(token);
        if (!uid) return json({ error: 'Unauthorized' }, 401);
        const body = await request.json().catch(() => ({}));
        const { startDate, endDate } = body;
        // Resolve household: members sync under the owner's namespace
        const { fbGet } = await import('./firebase.js');
        const userProfile = await fbGet(env, `users/${uid}`).catch(() => null);
        const syncUid = (typeof userProfile === 'object' && userProfile?.householdId) ? userProfile.householdId : uid;
        const result = await handleUserSync(env, syncUid, { startDate, endDate });
        return json(result);
      }

      if (pathname === '/categorize' && request.method === 'POST') {
        const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const uid   = uidFromJwt(token);
        if (!uid) return json({ error: 'Unauthorized' }, 401);

        const body = await request.json();
        // Body may be { txn, merchantRules, examples } (new) or a bare txn object (legacy)
        const txn     = body.txn ?? body;
        const context = { merchantRules: body.merchantRules ?? {}, examples: body.examples ?? [], categoryDescriptions: body.categoryDescriptions ?? {} };
        const result  = await categorizeTransaction(txn, env, context);
        return json(result);
      }

      return new Response('Not found', { status: 404, headers: CORS });
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 * * *')  ctx.waitUntil(handleSync(env));
    if (event.cron === '0 20 * * *') ctx.waitUntil(handleBudgetAlerts(env));
  },
};

async function handleBudgetAlerts(_env) {
  // TODO: fetch budgets + transactions, compute overage, send push notifications
}
