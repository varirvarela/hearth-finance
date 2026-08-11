// Enriches all existing transactions in Firebase with derived budget fields:
//   group    → parent category id (denormalized from the leaf category)
//   isFixed  → true if the expense is the same amount every period
//   isAnnual → true if the expense is budgeted annually
//
// Safe to re-run: writes are idempotent (same values will just overwrite).
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { readFileSync }        from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';
import { getCategoryBudgetFields } from '../src/shared/categories.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sa   = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com' });

const db  = getDatabase();
const UID = 'M8n6Fow8QcUm5DLLmE0aIajNNr72';

async function enrichPrefix(prefix) {
  const label = prefix || '(production)';
  const snap  = await db.ref(`${prefix}transactions/${UID}`).get();
  if (!snap.exists()) { console.log(`  ${label}: no transactions found`); return 0; }

  const txns = snap.val();
  const keys = Object.keys(txns);
  const CHUNK = 200;
  let processed = 0;

  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = {};
    for (const k of keys.slice(i, i + CHUNK)) {
      const fields = getCategoryBudgetFields(txns[k].category);
      const base   = `${prefix}transactions/${UID}/${k}`;
      batch[`${base}/group`]    = fields.group;
      batch[`${base}/isFixed`]  = fields.isFixed;
      batch[`${base}/isAnnual`] = fields.isAnnual;
    }
    await db.ref('/').update(batch);
    processed += keys.slice(i, i + CHUNK).length;
    process.stdout.write(`\r  ${label}: ${processed.toLocaleString()} / ${keys.length.toLocaleString()}`);
  }

  console.log(`\n  ${label}: enriched ${processed.toLocaleString()} transactions`);
  return processed;
}

let total = 0;
for (const prefix of ['', '_dev/']) {
  total += await enrichPrefix(prefix);
}
console.log(`\nDone. Total fields written: ${(total * 3).toLocaleString()} (group + isFixed + isAnnual × ${total.toLocaleString()} txns)`);
process.exit(0);
