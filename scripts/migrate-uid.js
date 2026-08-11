// Copies all data from the test UID to the real Google account UID.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { readFileSync }        from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sa   = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com' });

const db      = getDatabase();
const FROM_UID = 'HusipLH4nycbARxJx9LWV9TuNju2';
const TO_UID   = 'M8n6Fow8QcUm5DLLmE0aIajNNr72';

const COLLECTIONS = ['transactions', 'accounts', 'rules', 'budgets'];

async function copyCollection(col, fromPrefix, toPrefix) {
  const snap = await db.ref(`${fromPrefix}${col}/${FROM_UID}`).get();
  if (!snap.exists()) { console.log(`  ${col}: nothing to copy`); return 0; }
  const data = snap.val();
  await db.ref(`${toPrefix}${col}/${TO_UID}`).set(data);
  return Object.keys(data).length;
}

for (const prefix of ['', '_dev/']) {
  console.log(`\n── prefix: "${prefix || '(production)'}" ──`);
  for (const col of COLLECTIONS) {
    const n = await copyCollection(col, prefix, prefix);
    console.log(`  ${col}: ${n} records copied`);
  }
}

console.log('\nDone. Old test-account data left intact (can delete manually).');
process.exit(0);
