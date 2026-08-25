// Bulk-dismiss all current duplicate pairs by writing pairwise dupOk on each transaction.
// Each skip only excludes that specific pair — other pairs for the same transaction remain reviewable.
// Safe to re-run: already-dismissed pairs are skipped.
// Run: node scripts/bulk-skip-duplicates.js

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

const normOk = v => Array.isArray(v) ? v : Object.values(v ?? {});

function findDuplicatePairs(allTxns) {
  const byKey = {};
  for (const [id, t] of allTxns) {
    if (t.ignored || t.isTransfer || t.group === 'transfer') continue;
    const amt = Math.round((t.amount ?? 0) * 100);
    const key = `${amt}_${t.date ?? ''}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push([id, t]);
  }

  const pairs = [];
  const used  = new Set();

  for (const group of Object.values(byKey)) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length - 1; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [idA, a] = group[i];
        const [idB, b] = group[j];
        if (used.has(idA) || used.has(idB)) continue;

        // Already dismissed as a pair — skip
        const okA = normOk(a.dupOk);
        const okB = normOk(b.dupOk);
        if (okA.includes(idB) || okB.includes(idA)) continue;

        if (Math.abs(new Date(a.date) - new Date(b.date)) > 2 * 86400000) continue;
        const clean = s => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const nameA = clean(a.merchantName ?? a.description);
        const nameB = clean(b.merchantName ?? b.description);
        if (!nameA || !nameB) continue;
        if (nameA !== nameB && !nameA.includes(nameB) && !nameB.includes(nameA)) continue;

        pairs.push([idA, a, idB, b]);
        used.add(idA);
        used.add(idB);
      }
    }
  }
  return pairs;
}

async function main() {
  console.log(`\nUID: ${UID}\n`);

  const snap = await db.ref(`transactions/${UID}`).get();
  const txns = snap.val();
  if (!txns) { console.log('No transactions found.'); process.exit(0); }

  const allTxns = Object.entries(txns);
  const pairs   = findDuplicatePairs(allTxns);

  console.log(`Found ${pairs.length} undismissed duplicate pair(s).`);
  if (!pairs.length) { console.log('Nothing to do.'); process.exit(0); }

  const patch = {};
  for (const [idA, a, idB, b] of pairs) {
    const okA = normOk(a.dupOk); if (!okA.includes(idB)) okA.push(idB);
    const okB = normOk(b.dupOk); if (!okB.includes(idA)) okB.push(idA);
    patch[`transactions/${UID}/${idA}/dupOk`] = okA;
    patch[`transactions/${UID}/${idB}/dupOk`] = okB;
  }

  await db.ref().update(patch);
  console.log(`✓ Dismissed ${pairs.length} pairs (pairwise dupOk written).`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
