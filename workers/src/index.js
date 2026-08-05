import { handlePlaid } from './plaid.js';
import { handleSync }  from './sync.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith('/plaid/')) return handlePlaid(request, env, path);
      return new Response('Not found', { status: 404, headers: CORS });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 * * *') {
      ctx.waitUntil(handleSync(env));
    }
    if (event.cron === '0 20 * * *') {
      ctx.waitUntil(handleBudgetAlerts(env));
    }
  },
};

async function handleBudgetAlerts(env) {
  // TODO: fetch budgets + transactions, compute overage, send push notifications
}
