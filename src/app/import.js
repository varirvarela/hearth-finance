import { auth, db, DEV_ROOT } from '../shared/firebase.js';
import { ref, update } from 'firebase/database';
import { CATEGORY_NAME_MAP } from '../shared/categories.js';

// ── CSV parsing ──────────────────────────────────────────────────────────────

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

// ── Tiller column indices ────────────────────────────────────────────────────
// 0:empty 1:Date 2:Description 3:Category 4:Amount 5:Account 6:Account#
// 7:Institution 8:Month 9:Week 10:TransactionID 11:AccountID 12:Check
// 13:FullDescription 14:DateAdded 15:CategorizedDate 16:Metadata

function parseDate(str) {
  const parts = str.split('/');
  if (parts.length !== 3) return str;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseAmount(str) {
  // Tiller: negative = expense, positive = income/credit. We flip the sign.
  const n = parseFloat(str.replace(/[$,]/g, ''));
  return isNaN(n) ? null : -n;
}

function parseTillerRow(cols) {
  const tillerCatName = cols[3]?.trim() ?? '';
  const transactionId = cols[10]?.trim() ?? '';
  const date          = parseDate(cols[1]?.trim() ?? '');
  const amount        = parseAmount(cols[4]?.trim() ?? '');
  if (!transactionId || !date || amount === null) return null;

  return {
    importId:    transactionId,
    date,
    description: cols[2]?.trim() ?? '',
    fullDescription: cols[13]?.trim() ?? '',
    amount,
    category:    CATEGORY_NAME_MAP[tillerCatName] ?? 'uncategorized',
    categorySource: tillerCatName ? 'import' : 'uncategorized',
    accountName: cols[5]?.trim() ?? '',
    accountNumber: cols[6]?.trim() ?? '',
    institution: cols[7]?.trim() ?? '',
    accountId:   cols[11]?.trim() ?? '',
    source:      'tiller',
  };
}

// ── Batch writer ─────────────────────────────────────────────────────────────

async function writeBatch(uid, transactions) {
  const batch = {};
  for (const txn of transactions) {
    // Use importId as the RTDB key for automatic deduplication on re-import.
    batch[`${DEV_ROOT}transactions/${uid}/${txn.importId}`] = txn;
  }
  await update(ref(db), batch);
}

// ── Main import ──────────────────────────────────────────────────────────────

export async function importTillerCSV(file, uid, onProgress) {
  const text = await file.text();
  const rows = parseCSV(text);

  // Skip header row
  const dataRows = rows.slice(1);
  const CHUNK = 200;
  let imported = 0;
  let skipped  = 0;

  for (let i = 0; i < dataRows.length; i += CHUNK) {
    const chunk = dataRows.slice(i, i + CHUNK);
    const txns  = [];
    for (const row of chunk) {
      const txn = parseTillerRow(row);
      if (!txn) { skipped++; continue; }
      txns.push(txn);
    }
    if (txns.length) await writeBatch(uid, txns);
    imported += txns.length;
    onProgress(Math.min(i + CHUNK, dataRows.length), dataRows.length);
  }

  return { imported, skipped };
}

// ── Modal UI ─────────────────────────────────────────────────────────────────

export function openImportModal() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px">
      <h3>Import Transactions</h3>
      <p style="color:var(--muted);font-size:0.875rem;margin-bottom:1rem">
        Supports Tiller CSV exports. Transactions are deduplicated automatically — safe to re-import.
      </p>
      <label class="import-drop" id="import-drop">
        <span id="import-label">📂 Choose CSV file</span>
        <input type="file" accept=".csv" id="import-file" style="display:none" />
      </label>
      <div id="import-progress" hidden>
        <div class="progress-bar-wrap"><div class="progress-bar-fill" id="import-bar" style="width:0%"></div></div>
        <p id="import-status" style="text-align:center;font-size:0.875rem;color:var(--muted);margin-top:0.5rem"></p>
      </div>
      <div id="import-result" hidden style="text-align:center;padding:1rem 0"></div>
      <div style="display:flex;gap:0.5rem;margin-top:1.25rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Close</button>
        <button class="btn-primary" id="import-go" style="flex:1" disabled>Import</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const fileInput  = modal.querySelector('#import-file');
  const dropLabel  = modal.querySelector('#import-label');
  const dropZone   = modal.querySelector('#import-drop');
  const goBtn      = modal.querySelector('#import-go');
  const progressEl = modal.querySelector('#import-progress');
  const bar        = modal.querySelector('#import-bar');
  const statusEl   = modal.querySelector('#import-status');
  const resultEl   = modal.querySelector('#import-result');

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    dropLabel.textContent = `📄 ${file.name}`;
    goBtn.disabled = false;
  });

  goBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    goBtn.disabled = true;
    progressEl.hidden = false;
    resultEl.hidden   = true;

    try {
      const result = await importTillerCSV(file, uid, (done, total) => {
        const pct = Math.round((done / total) * 100);
        bar.style.width = `${pct}%`;
        statusEl.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} rows…`;
      });

      bar.style.width = '100%';
      progressEl.hidden = true;
      resultEl.hidden   = false;
      resultEl.innerHTML = `
        <span style="font-size:2rem">✅</span>
        <p style="font-weight:600;margin:0.5rem 0">${result.imported.toLocaleString()} transactions imported</p>
        ${result.skipped ? `<p style="color:var(--muted);font-size:0.875rem">${result.skipped} rows skipped (blank or malformed)</p>` : ''}
      `;
      modal.querySelector('.modal-cancel').textContent = 'Done';
    } catch (err) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
      goBtn.disabled = false;
    }
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
