import { fbGet, fbPush, fbPatch } from './firebase.js';
import { getTransactions } from './plaid.js';
import { categorizeTransaction } from './categorize.js';
import { evaluateRules } from '../../src/shared/rules.js';

export async function handleSync(env) {
  const users = await fbGet(env, 'users');
  if (!users) return;
  for (const [uid] of Object.entries(users)) {
    try {
      await handleUserSync(env, uid);
    } catch (err) {
      console.error(`[sync] uid=${uid} fatal error:`, err.message);
    }
  }
}

export async function handleUserSync(env, uid, { startDate, endDate } = {}) {
  const accounts = await fbGet(env, `accounts/${uid}`).catch(() => null);
  if (!accounts) return { synced: 0, errors: 0 };

  const today       = new Date();
  const computedEnd = today.toISOString().slice(0, 10);

  const itemsSeen = new Map();
  for (const [key, account] of Object.entries(accounts)) {
    if (account.isManual || !account.plaidItemId) continue;
    if (!itemsSeen.has(account.plaidItemId)) {
      const slot  = account.plaidSlot ?? 1;
      const token = await env.PLAID_TOKENS.get(`s${slot}:${uid}:${account.plaidItemId}`);
      if (!token) {
        // Token missing from KV — mark account as error so the UI shows red instead of silently stale
        console.warn(`[sync] uid=${uid} item=${account.plaidItemId} slot=${slot}: no token in KV`);
        await fbPatch(env, '', {
          [`accounts/${uid}/${key}/lastSyncStatus`]: 'error',
          [`accounts/${uid}/${key}/lastSyncError`]:  'Access token missing — please reconnect',
        }).catch(() => {});
        continue;
      }
      itemsSeen.set(account.plaidItemId, { token, slot, accountKeys: [], lastSync: account.lastSync ?? null });
    }
    itemsSeen.get(account.plaidItemId).accountKeys.push(key);
  }

  const existing         = await fbGet(env, `transactions/${uid}`).catch(() => ({})) ?? {};
  const rules            = await fbGet(env, `rules/${uid}`).catch(() => ({})) ?? {};
  const existingPlaidIds = new Set(Object.values(existing).map(t => t.plaidId).filter(Boolean));

  let synced = 0;
  let errors = 0;

  for (const [itemId, { token, slot, accountKeys, lastSync }] of itemsSeen) {
    // Start from the last successful sync date (to catch any gap during an error period),
    // but never more than 2 years back and never more recent than today-2 (overlap buffer).
    const twoYearsAgo = new Date(today.getTime() - 730 * 86400000);
    const twoDaysAgo  = new Date(today.getTime() -   2 * 86400000);
    const sinceDate   = lastSync ? new Date(lastSync + 'T12:00:00') : twoYearsAgo;
    const resolvedStart = startDate ?? new Date(Math.min(sinceDate.getTime(), twoDaysAgo.getTime())).toISOString().slice(0, 10);
    const resolvedEnd   = endDate ?? computedEnd;

    let plaidTxns;
    try {
      const result = await getTransactions(env, token, resolvedStart, resolvedEnd, slot);
      if (!result.transactions) throw new Error(result.error_message ?? result.error_code ?? 'Plaid error');
      plaidTxns = result.transactions;
    } catch (err) {
      const errPatch = {};
      for (const key of accountKeys) {
        errPatch[`accounts/${uid}/${key}/lastSyncStatus`] = 'error';
        errPatch[`accounts/${uid}/${key}/lastSyncError`]  = err.message;
      }
      await fbPatch(env, '', errPatch);
      errors++;
      continue;
    }

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

    const patch = {};
    for (const key of accountKeys) {
      patch[`accounts/${uid}/${key}/lastSync`]       = resolvedEnd;
      patch[`accounts/${uid}/${key}/lastSyncStatus`] = 'ok';
      patch[`accounts/${uid}/${key}/lastSyncError`]  = null;
    }
    await fbPatch(env, '', patch);
  }

  return { synced, errors };
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
