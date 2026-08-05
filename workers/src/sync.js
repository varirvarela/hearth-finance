import { fbGet, fbPush, fbPatch } from './firebase.js';
import { getTransactions } from './plaid.js';
import { categorizeTransaction } from './categorize.js';
import { evaluateRules } from '../../src/shared/rules.js';

export async function handleSync(env) {
  const users = await fbGet(env, 'users');
  if (!users) return;

  const today     = new Date();
  const endDate   = today.toISOString().slice(0, 10);
  const startDate = new Date(today - 2 * 86400000).toISOString().slice(0, 10);

  for (const [uid, _user] of Object.entries(users)) {
    const accounts = await fbGet(env, `accounts/${uid}`).catch(() => null);
    if (!accounts) continue;

    for (const [, account] of Object.entries(accounts)) {
      if (account.isManual || !account.plaidItemId) continue;

      const token = await env.PLAID_TOKENS.get(`${uid}:${account.plaidItemId}`);
      if (!token) continue;

      const { transactions: plaidTxns, error } = await getTransactions(env, token, startDate, endDate);
      if (error || !plaidTxns) continue;

      const existing = await fbGet(env, `transactions/${uid}`).catch(() => ({})) ?? {};
      const existingPlaidIds = new Set(Object.values(existing).map(t => t.plaidId).filter(Boolean));

      const rules = await fbGet(env, `rules/${uid}`).catch(() => ({})) ?? {};

      for (const plaidTxn of plaidTxns) {
        if (existingPlaidIds.has(plaidTxn.transaction_id)) continue;

        const txn = normalizePlaidTransaction(plaidTxn, account.plaidItemId);

        const ruleCategory = evaluateRules(txn, rules);
        if (ruleCategory) {
          txn.category       = ruleCategory;
          txn.categorySource = 'rule';
        } else {
          txn.category       = await categorizeTransaction(txn, env);
          txn.categorySource = 'ai';
        }

        await fbPush(env, `transactions/${uid}`, txn);
      }

      // Update last sync date
      await fbPatch(env, `accounts/${uid}/${account.plaidItemId}`, { lastSync: endDate });
    }
  }
}

function normalizePlaidTransaction(plaidTxn, plaidItemId) {
  return {
    date:                plaidTxn.date,
    amount:              plaidTxn.amount,
    description:         plaidTxn.name,
    originalDescription: plaidTxn.original_description ?? plaidTxn.name,
    merchantName:        plaidTxn.merchant_name ?? null,
    accountId:           plaidItemId,
    pending:             plaidTxn.pending,
    plaidId:             plaidTxn.transaction_id,
    plaidCategory:       plaidTxn.personal_finance_category?.primary ?? null,
    category:            'uncategorized',
    categorySource:      'plaid',
    notes:               '',
    tags:                [],
    ignored:             false,
  };
}
