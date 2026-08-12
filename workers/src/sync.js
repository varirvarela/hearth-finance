import { fbGet, fbPush, fbPatch } from './firebase.js';
import { getTransactions } from './plaid.js';
import { categorizeTransaction } from './categorize.js';
import { evaluateRules } from '../../src/shared/rules.js';

// Cron-triggered: sync last 2 days for every user.
export async function handleSync(env) {
  const users = await fbGet(env, 'users');
  if (!users) return;
  for (const [uid] of Object.entries(users)) {
    await handleUserSync(env, uid, 2);
  }
}

// Manual or per-user sync. lookbackDays defaults to 90 for first-time sync.
export async function handleUserSync(env, uid, lookbackDays) {
  const accounts = await fbGet(env, `accounts/${uid}`).catch(() => null);
  if (!accounts) return { synced: 0 };

  const today   = new Date();
  const endDate = today.toISOString().slice(0, 10);

  // Deduplicate by plaidItemId — one access token covers all accounts in an institution.
  const itemsSeen = new Map(); // itemId → { token, slot, accountKeys[], firstLastSync }
  for (const [key, account] of Object.entries(accounts)) {
    if (account.isManual || !account.plaidItemId) continue;
    if (!itemsSeen.has(account.plaidItemId)) {
      const slot  = account.plaidSlot ?? 1;
      const token = await env.PLAID_TOKENS.get(`s${slot}:${uid}:${account.plaidItemId}`);
      if (!token) continue;
      itemsSeen.set(account.plaidItemId, { token, slot, accountKeys: [], lastSync: account.lastSync ?? null });
    }
    itemsSeen.get(account.plaidItemId).accountKeys.push(key);
  }

  const existing   = await fbGet(env, `transactions/${uid}`).catch(() => ({})) ?? {};
  const rules      = await fbGet(env, `rules/${uid}`).catch(() => ({})) ?? {};
  const existingPlaidIds = new Set(Object.values(existing).map(t => t.plaidId).filter(Boolean));

  let synced = 0;

  for (const [itemId, { token, slot, accountKeys, lastSync }] of itemsSeen) {
    const days = lookbackDays ?? (lastSync ? 2 : 90);
    const startDate = new Date(today - days * 86400000).toISOString().slice(0, 10);

    const { transactions: plaidTxns, error } = await getTransactions(env, token, startDate, endDate, slot);
    if (error || !plaidTxns) continue;

    for (const plaidTxn of plaidTxns) {
      if (existingPlaidIds.has(plaidTxn.transaction_id)) continue;

      const txn = normalizePlaidTransaction(plaidTxn, itemId);

      const ruleCategory = evaluateRules(txn, rules);
      if (ruleCategory) {
        const { getCategoryBudgetFields } = await import('../../src/shared/categories.js');
        const fields       = getCategoryBudgetFields(ruleCategory);
        txn.category       = ruleCategory;
        txn.group          = fields.group;
        txn.isFixed        = fields.isFixed;
        txn.isAnnual       = fields.isAnnual;
        txn.categorySource = 'rule';
        txn.needsReview    = false;
      } else {
        const ai           = await categorizeTransaction(txn, env);
        txn.category       = ai.category;
        txn.group          = ai.group;
        txn.isFixed        = ai.isFixed;
        txn.isAnnual       = ai.isAnnual;
        txn.aiConfidence   = ai.confidence;
        txn.categorySource = 'ai';
        txn.needsReview    = ai.needsReview;
      }

      await fbPush(env, `transactions/${uid}`, txn);
      existingPlaidIds.add(plaidTxn.transaction_id);
      synced++;
    }

    // Update lastSync on every account that belongs to this item.
    const patch = {};
    for (const key of accountKeys) patch[`accounts/${uid}/${key}/lastSync`] = endDate;
    await fbPatch(env, '', patch);
  }

  return { synced };
}

function normalizePlaidTransaction(plaidTxn, plaidItemId) {
  return {
    date:                plaidTxn.date,
    amount:              plaidTxn.amount,
    description:         plaidTxn.name,
    originalDescription: plaidTxn.original_description ?? plaidTxn.name,
    merchantName:        plaidTxn.merchant_name ?? null,
    accountId:           plaidTxn.account_id,
    plaidItemId,
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
