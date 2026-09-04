import { fbGet, fbPush, fbPatch } from './firebase.js';
import { transactionsSync } from './plaid.js';
import { categorizeTransaction } from './categorize.js';
import { evaluateRules } from '../../src/shared/rules.js';

const EXAMPLE_STOP = new Set(['payment', 'purchase', 'debit', 'credit', 'charge', 'transfer', 'from', 'received', 'sent', 'with', 'using']);

function buildExamples(txn, confirmedTxns, max = 10) {
  const words = ((txn.merchantName ?? '') + ' ' + (txn.description ?? ''))
    .toLowerCase().split(/\W+/).filter(w => w.length > 3 && !EXAMPLE_STOP.has(w));

  const scored = confirmedTxns.map(t => {
    const tText = ((t.merchantName ?? '') + ' ' + (t.description ?? '')).toLowerCase();
    const score = words.reduce((n, w) => n + (tText.includes(w) ? 1 : 0), 0);
    return { t, score };
  });

  const withMatch = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
  const matchSet  = new Set(withMatch.map(x => x.t));
  const recent    = confirmedTxns.filter(t => !matchSet.has(t)).slice(0, max - withMatch.length);

  return [...withMatch.map(x => x.t), ...recent].map(t => ({
    merchantName: t.merchantName,
    description:  t.description,
    category:     t.category,
    amount:       t.amount,
    date:         t.date,
  }));
}

export async function handleSync(env) {
  const users = await fbGet(env, 'users');
  if (!users) return;
  for (const [uid, userData] of Object.entries(users)) {
    if (typeof userData === 'object' && userData?.householdId && userData.householdId !== uid) continue;
    try {
      await handleUserSync(env, uid);
    } catch (err) {
      console.error(`[sync] uid=${uid} fatal error:`, err.message);
    }
  }
}

export async function handleUserSync(env, uid) {
  const accounts = await fbGet(env, `accounts/${uid}`).catch(() => null);
  if (!accounts) return { synced: 0, removed: 0, modified: 0, errors: 0 };

  const itemsSeen = new Map();
  for (const [key, account] of Object.entries(accounts)) {
    if (account.isManual || !account.plaidItemId) continue;
    if (!itemsSeen.has(account.plaidItemId)) {
      const slot  = account.plaidSlot ?? 1;
      const token = await env.PLAID_TOKENS.get(`s${slot}:${uid}:${account.plaidItemId}`);
      if (!token) {
        console.warn(`[sync] uid=${uid} item=${account.plaidItemId} slot=${slot}: no token in KV`);
        await fbPatch(env, '', {
          [`accounts/${uid}/${key}/lastSyncStatus`]: 'error',
          [`accounts/${uid}/${key}/lastSyncError`]:  'Access token missing — please reconnect',
        }).catch(() => {});
        continue;
      }
      itemsSeen.set(account.plaidItemId, { token, slot, accountKeys: [] });
    }
    itemsSeen.get(account.plaidItemId).accountKeys.push(key);
  }

  const accountNameMap = {};
  for (const [accountId, account] of Object.entries(accounts)) {
    accountNameMap[accountId] = account.alias ?? account.name ?? '';
  }

  const existing         = await fbGet(env, `transactions/${uid}`).catch(() => ({})) ?? {};
  const rules            = await fbGet(env, `rules/${uid}`).catch(() => ({})) ?? {};
  const merchantRules    = await fbGet(env, `merchantRules/${uid}`).catch(() => ({})) ?? {};
  const catDescOverrides = await fbGet(env, `categoryDescriptions/${uid}`).catch(() => ({})) ?? {};
  const cursors          = await fbGet(env, `plaidCursors/${uid}`).catch(() => ({})) ?? {};

  const { CATEGORY_MAP, getCategoryBudgetFields } = await import('../../src/shared/categories.js');
  const categoryDescriptions = Object.fromEntries(
    Object.entries(CATEGORY_MAP)
      .filter(([, c]) => c.parent)
      .map(([id, c]) => [id, catDescOverrides[id] || c.description || ''])
  );

  // Build lookup: plaidId → { fbKey, txn }
  const plaidIdToEntry = new Map();
  for (const [fbKey, txn] of Object.entries(existing)) {
    if (txn.plaidId) plaidIdToEntry.set(txn.plaidId, { fbKey, txn });
  }

  const existingPlaidIds = new Set(plaidIdToEntry.keys());

  const confirmedTxns = Object.values(existing)
    .filter(t => t.category && t.category !== 'uncategorized' && t.categorySource !== 'ai')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  let syncedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;
  let errors = 0;

  const today = new Date().toISOString().slice(0, 10);

  for (const [itemId, { token, slot, accountKeys }] of itemsSeen) {
    let cursor = cursors[itemId] ?? null;

    // Collect all pages of changes for this item
    const allAdded    = [];
    const allModified = [];
    const allRemoved  = [];
    let   newCursor   = cursor;
    let   itemError   = null;

    try {
      let hasMore = true;
      while (hasMore) {
        const result = await transactionsSync(env, token, newCursor, slot);

        if (result.error_code) {
          // If cursor is stale/invalid, reset and do a full re-sync
          if (result.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
              result.error_code === 'INVALID_FIELD' ||
              result.error_code === 'INVALID_REQUEST') {
            console.warn(`[sync] uid=${uid} item=${itemId}: cursor error ${result.error_code}, resetting`);
            newCursor = null;
            break;
          }
          throw new Error(result.error_message ?? result.error_code ?? 'Plaid sync error');
        }

        allAdded.push(...(result.added ?? []));
        allModified.push(...(result.modified ?? []));
        allRemoved.push(...(result.removed ?? []));
        newCursor = result.next_cursor;
        hasMore   = result.has_more ?? false;
      }
    } catch (err) {
      itemError = err.message;
    }

    if (itemError) {
      const errPatch = {};
      for (const key of accountKeys) {
        errPatch[`accounts/${uid}/${key}/lastSyncStatus`] = 'error';
        errPatch[`accounts/${uid}/${key}/lastSyncError`]  = itemError;
      }
      await fbPatch(env, '', errPatch);
      errors++;
      continue;
    }

    // --- Process removed[] ---
    // Track manual categories from removed pending txns so we can transfer
    // them to their settled counterpart in added[].
    const removedCategories = new Map(); // pendingPlaidId → category info
    const deletePatch = {};

    for (const removed of allRemoved) {
      const entry = plaidIdToEntry.get(removed.transaction_id);
      if (!entry) continue;

      // Preserve manual categorization so settled transaction inherits it
      if (entry.txn.categorySource === 'manual') {
        removedCategories.set(removed.transaction_id, {
          category:       entry.txn.category,
          group:          entry.txn.group,
          isFixed:        entry.txn.isFixed,
          isAnnual:       entry.txn.isAnnual,
          categorySource: 'manual',
          needsReview:    false,
        });
      }

      deletePatch[`transactions/${uid}/${entry.fbKey}`] = null;
      plaidIdToEntry.delete(removed.transaction_id);
      existingPlaidIds.delete(removed.transaction_id);
      removedCount++;
    }

    if (Object.keys(deletePatch).length) await fbPatch(env, '', deletePatch);

    // --- Process modified[] ---
    const modifyPatch = {};

    for (const modified of allModified) {
      const entry = plaidIdToEntry.get(modified.transaction_id);
      if (!entry) continue;
      if (entry.txn.isEdited) continue; // user-edited, don't overwrite

      modifyPatch[`transactions/${uid}/${entry.fbKey}/date`]           = modified.date;
      modifyPatch[`transactions/${uid}/${entry.fbKey}/amount`]         = modified.amount;
      modifyPatch[`transactions/${uid}/${entry.fbKey}/pending`]        = modified.pending;
      modifyPatch[`transactions/${uid}/${entry.fbKey}/merchantName`]   = modified.merchant_name ?? null;
      modifyPatch[`transactions/${uid}/${entry.fbKey}/description`]    = modified.name;
      modifiedCount++;
    }

    if (Object.keys(modifyPatch).length) await fbPatch(env, '', modifyPatch);

    // --- Process added[] ---
    for (const plaidTxn of allAdded) {
      if (existingPlaidIds.has(plaidTxn.transaction_id)) continue;

      const txn = normalizePlaidTransaction(plaidTxn, itemId);
      txn.accountName = accountNameMap[plaidTxn.account_id] ?? '';

      // Transfer category from settled pending transaction if user had set it manually
      const inheritedCat = plaidTxn.pending_transaction_id
        ? removedCategories.get(plaidTxn.pending_transaction_id)
        : null;

      if (inheritedCat) {
        Object.assign(txn, inheritedCat);
      } else {
        const ruleCategory = evaluateRules(txn, rules);
        if (ruleCategory) {
          const fields       = getCategoryBudgetFields(ruleCategory);
          txn.category       = ruleCategory;
          txn.group          = fields.group;
          txn.isFixed        = fields.isFixed;
          txn.isAnnual       = fields.isAnnual;
          txn.categorySource = 'rule';
          txn.needsReview    = false;
        } else {
          const examples     = buildExamples(txn, confirmedTxns);
          const ai           = await categorizeTransaction(txn, env, { merchantRules, categoryDescriptions, examples });
          txn.category       = ai.category;
          txn.group          = ai.group;
          txn.isFixed        = ai.isFixed;
          txn.isAnnual       = ai.isAnnual;
          txn.aiConfidence   = ai.confidence;
          txn.categorySource = 'ai';
          txn.needsReview    = ai.needsReview;
        }
      }

      await fbPush(env, `transactions/${uid}`, txn);
      existingPlaidIds.add(plaidTxn.transaction_id);
      syncedCount++;
    }

    // --- Store new cursor and update account status ---
    const patch = {};
    if (newCursor) patch[`plaidCursors/${uid}/${itemId}`] = newCursor;
    for (const key of accountKeys) {
      patch[`accounts/${uid}/${key}/lastSync`]       = today;
      patch[`accounts/${uid}/${key}/lastSyncStatus`] = 'ok';
      patch[`accounts/${uid}/${key}/lastSyncError`]  = null;
    }
    await fbPatch(env, '', patch);
  }

  return { synced: syncedCount, removed: removedCount, modified: modifiedCount, errors };
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
