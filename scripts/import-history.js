import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { getAuth }             from 'firebase-admin/auth';
import { readFileSync }        from 'fs';
import { fileURLToPath }       from 'url';
import { dirname, resolve }    from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');

// ── Firebase init ────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));

initializeApp({
  credential:  cert(serviceAccount),
  databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com',
});

const db = getDatabase();

// ── Category name map (mirrors src/shared/categories.js) ────────────────────
const CATEGORY_NAME_MAP = {
  'Auto Fijo Mensual':                  'auto_fijo',
  'Auto Comunes Mensual':               'auto_comunes',
  'Auto Comunes Anual':                 'auto_comunes_anual',
  'Telecom Fijo Mensual':               'telecom_fijo',
  'Utilities Comunes Mensual':          'utilities_comunes',
  'Salidas Comunes Mensual':            'salidas_comunes',
  'Salidas Eventos Anual':              'salidas_eventos',
  'Super y Farmacia Comunes Mensual':   'super_farmacia_comunes',
  'Adult Activities Comunes Anual':     'adult_activities',
  'Casa Fijo Mensual':                  'casa_fijo_mensual',
  'Casa Fijo Anual':                    'casa_fijo_anual',
  'Casa Comunes Mensual':               'casa_comunes_mensual',
  'Casa Comunes Anual':                 'casa_comunes_anual',
  'Mudanza':                            'casa_mudanza',
  'Compra Casa':                        'casa_compra',
  'Obra Casa':                          'casa_obra',
  'Kids Activities Comunes Anual':      'kids_activities',
  'Tuition':                            'kids_tuition',
  'Shopping Comunes Mensual':           'shopping_comunes',
  'Travel Argentina':                   'travel_argentina',
  'Travel Montaña':                     'travel_montana',
  'Travel Family':                      'travel_family',
  'Travel Vari':                        'travel_vari',
  'Travel Guli':                        'travel_guli',
  'Accenture Expenses':                 'business_accenture',
  'Realtor Expenses':                   'business_realtor',
  'Transfer Cuentas':                   'transfer_cuentas',
  'Pago Tarjeta':                       'transfer_tarjeta',
  'Paycheck':                           'paycheck',
  'Bonus':                              'bonus',
  'Compra Acciones':                    'compra_acciones',
  'Realtor Income':                     'realtor_income',
  'Interest':                           'income_interest',
  'Other Income':                       'income_other',
  'Taxes':                              'taxes',
  'Venta Depto':                        'venta_depto',
  'Donation':                           'donation',
  'Cumpleaños':                         'cumpleanos_comunes',
  'Salud':                              'salud_comunes',
  'Venmo':                              'venmo',
  'Gastos Argentina':                   'gastos_argentina',
};

// ── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length && text[i] !== '\n') {
      if (text[i] === '"') {
        i++;
        let cell = '';
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') { cell += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { cell += text[i++]; }
        }
        row.push(cell);
        if (text[i] === ',') i++;
      } else {
        let cell = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\n') cell += text[i++];
        row.push(cell.trim());
        if (text[i] === ',') i++;
      }
    }
    if (text[i] === '\n') i++;
    if (row.some(c => c !== '')) rows.push(row);
  }
  return rows;
}

function parseDate(str) {
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseAmount(str) {
  const n = parseFloat(str.replace(/[$,]/g, ''));
  return isNaN(n) ? null : -n;  // flip sign: Tiller negative = our positive (expense)
}

function parseTillerRow(cols) {
  const transactionId = cols[10]?.trim() ?? '';
  const dateRaw       = cols[1]?.trim()  ?? '';
  const date          = parseDate(dateRaw);
  const amount        = parseAmount(cols[4]?.trim() ?? '');
  if (!transactionId || !date || amount === null) return null;

  // Firebase keys can't contain . # $ [ ] /
  const safeId    = transactionId.replace(/[.#$[\]/]/g, '_');
  const tillerCat = cols[3]?.trim() ?? '';
  return {
    importId:        safeId,
    date,
    description:     cols[2]?.trim()  ?? '',
    fullDescription: cols[13]?.trim() ?? '',
    amount,
    category:        CATEGORY_NAME_MAP[tillerCat] ?? 'uncategorized',
    categorySource:  tillerCat ? 'import' : 'uncategorized',
    accountName:     cols[5]?.trim()  ?? '',
    accountNumber:   cols[6]?.trim()  ?? '',
    institution:     cols[7]?.trim()  ?? '',
    accountId:       cols[11]?.trim() ?? '',
    source:          'tiller',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Resolve user UID
  const { users } = await getAuth().listUsers(10);
  if (!users.length) throw new Error('No users found in Firebase Auth.');
  const uid = users[0].uid;
  console.log(`User: ${users[0].email}  UID: ${uid}`);

  // Parse CSV
  const csvPath = resolve(root, 'previous', 'Gastos FliaRV - Transactions.csv');
  const text    = readFileSync(csvPath, 'utf8');
  const rows    = parseCSV(text).slice(1); // drop header
  console.log(`Rows in CSV: ${rows.length}`);

  const CHUNK   = 200;
  let imported  = 0;
  let skipped   = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const batch = {};

    for (const row of chunk) {
      const txn = parseTillerRow(row);
      if (!txn) { skipped++; continue; }
      // Write to BOTH production and _dev paths so the app works locally and on GitHub Pages.
      batch[`transactions/${uid}/${txn.importId}`]      = txn;
      batch[`_dev/transactions/${uid}/${txn.importId}`] = txn;
    }

    const count = Object.keys(batch).length / 2; // each txn written twice
    if (count) {
      await db.ref('/').update(batch);
      imported += count;
    }

    process.stdout.write(`\r  ${Math.min(i + CHUNK, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} rows`);
  }

  console.log(`\n\nDone!  Imported: ${imported.toLocaleString()}  Skipped (blank/malformed): ${skipped}`);
  process.exit(0);
}

main().catch(err => { console.error('\nError:', err.message); process.exit(1); });
