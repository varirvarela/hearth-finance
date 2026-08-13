// Deletes all Plaid-linked accounts and their transactions for a given user.
// Run after disconnecting from Plaid sandbox before switching to production.
//
//   node scripts/clear-sandbox-data.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { readFileSync }        from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sa   = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com' });

const db  = getDatabase();
const UID = 'M8n6Fow8QcUm5DLLmE0aIajNNr72';

async function run() {
  // --- Delete Plaid-linked accounts ---
  const accountsSnap = await db.ref(`accounts/${UID}`).get();
  if (accountsSnap.exists()) {
    const accounts = accountsSnap.val();
    const plaidKeys = Object.entries(accounts)
      .filter(([, a]) => !a.isManual && a.plaidItemId)
      .map(([k]) => k);

    if (plaidKeys.length) {
      const patch = {};
      for (const k of plaidKeys) patch[`accounts/${UID}/${k}`] = null;
      await db.ref('/').update(patch);
      console.log(`Deleted ${plaidKeys.length} Plaid account(s).`);
    } else {
      console.log('No Plaid accounts found.');
    }
  }

  // --- Delete Plaid-synced transactions (both prefixes) ---
  for (const prefix of ['', '_dev/']) {
    const txnsSnap = await db.ref(`${prefix}transactions/${UID}`).get();
    if (!txnsSnap.exists()) continue;

    const txns = txnsSnap.val();
    const plaidKeys = Object.entries(txns)
      .filter(([, t]) => t.plaidId || t.plaidItemId)
      .map(([k]) => k);

    if (plaidKeys.length) {
      const patch = {};
      for (const k of plaidKeys) patch[`${prefix}transactions/${UID}/${k}`] = null;
      await db.ref('/').update(patch);
      console.log(`Deleted ${plaidKeys.length} Plaid transaction(s) from ${prefix || 'production'}.`);
    } else {
      console.log(`No Plaid transactions in ${prefix || 'production'}.`);
    }
  }

  console.log('Done. Now clear KV tokens and redeploy with production Plaid credentials.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
