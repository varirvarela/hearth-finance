import { dbGet, dbSet, dbListen, auth, getPartnerUid, getHouseholdId } from '../shared/firebase.js';
import { fmtCurrency, fmtDate } from '../shared/format.js';
import { CHANGELOG } from '../shared/changelog.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

const GMAIL_CLIENT_ID = '479821033709-4rk9nvhqf5affdtbb72irh0mg7r090ru.apps.googleusercontent.com';
const GMAIL_REDIRECT  = 'https://varirvarela.github.io/hearth-finance/';
const GMAIL_SCOPE     = 'https://www.googleapis.com/auth/gmail.readonly';

function buildGmailAuthUrl(key = 'main') {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id:     GMAIL_CLIENT_ID,
    redirect_uri:  GMAIL_REDIRECT,
    response_type: 'code',
    scope:         GMAIL_SCOPE,
    access_type:   'offline',
    prompt:        'consent',
    state:         `gmail-connect:${key}`,
  })}`;
}

const AMAZON_PAT = /amazon|amzn/i;

let _syncFilterIds = null; // null = all, Set<string> = specific plaidItemIds

function updateSyncFilterBtn() {
  const btn = document.getElementById('sync-filter-btn');
  if (!btn) return;
  btn.textContent = (_syncFilterIds && _syncFilterIds.size > 0) ? `▾ ${_syncFilterIds.size}` : '▾';
}

export function renderAccounts(container) {
  container.innerHTML = `
    <div class="page accounts" style="padding:0">
      <!-- Dark hero: Assets · Debt · Net Worth -->
      <div class="acct-hero">
        <div class="acct-hero-item">
          <div class="acct-hero-label">Assets</div>
          <div class="acct-hero-val green" id="hero-assets">—</div>
        </div>
        <div class="acct-hero-item acct-hero-mid">
          <div class="acct-hero-label">Debt</div>
          <div class="acct-hero-val red" id="hero-debt">—</div>
        </div>
        <div class="acct-hero-item">
          <div class="acct-hero-label">Net Worth</div>
          <div class="acct-hero-val white" id="hero-net">—</div>
        </div>
      </div>

      <!-- Account list -->
      <div class="acct-content">
        <div id="account-list"></div>

        <div id="amazon-section"></div>

        <div class="acct-actions-row">
          <button class="btn-primary" id="link-account" style="flex:1">+ Link Bank</button>
          <button class="btn-secondary" id="add-manual" style="flex:1">+ Manual</button>
        </div>

        <div class="acct-sync-row" style="flex-wrap:wrap">
          <select id="sync-range" style="flex:1;border:1.5px solid var(--border);border-radius:8px;padding:0.45rem 0.65rem;font-size:0.82rem;background:var(--surface);color:var(--text)">
            <option value="2">Last 2 days</option>
            <option value="30">Last 30 days</option>
            <option value="90" selected>Last 90 days</option>
            <option value="180">Last 6 months</option>
            <option value="365">Last year</option>
            <option value="custom">Custom range…</option>
          </select>
          <div id="sync-custom-dates" style="display:none;flex-direction:row;gap:5px;align-items:center;margin-top:6px">
            <input type="date" id="sync-from" style="flex:1;border:1.5px solid var(--border);border-radius:8px;padding:0.4rem 0.6rem;font-size:0.78rem;background:var(--surface);color:var(--text)" />
            <span style="font-size:0.75rem;color:var(--muted)">to</span>
            <input type="date" id="sync-to" style="flex:1;border:1.5px solid var(--border);border-radius:8px;padding:0.4rem 0.6rem;font-size:0.78rem;background:var(--surface);color:var(--text)" />
          </div>
          <div style="position:relative;display:flex;gap:0">
            <button class="btn-primary" id="sync-now" style="width:auto;padding:0.45rem 1rem;font-size:0.82rem;border-radius:8px 0 0 8px">Sync</button>
            <button id="sync-filter-btn" class="btn-primary" style="padding:0.45rem 0.5rem;font-size:0.75rem;border-radius:0 8px 8px 0;border-left:1px solid rgba(255,255,255,0.25)" title="Filter by institution">▾</button>
            <div id="sync-filter-panel" style="display:none;position:absolute;top:calc(100% + 4px);right:0;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;z-index:30;min-width:190px;max-height:60vh;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.15)">
              <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;padding:4px 0;cursor:pointer;font-weight:500">
                <input type="checkbox" id="sync-all-accounts" checked style="accent-color:var(--primary)"> All accounts
              </label>
              <div id="sync-account-items" style="margin-top:4px;display:flex;flex-direction:column;gap:0"></div>
            </div>
          </div>
        </div>

        <button class="acct-settings-btn" id="rationalize-accounts" style="margin-bottom:12px">
          Rationalize accounts — find duplicates →
        </button>

      </div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const hid = getHouseholdId();

  let latestOwnerAccounts  = null;
  let latestPartnerAccounts = null;
  let resolvedPartnerUid   = null;

  const refreshHero = (accounts) => {
    const assets = Object.values(accounts ?? {}).filter(a => a.type !== 'credit').reduce((s, a) => s + (a.currentBalance ?? 0), 0);
    const debt   = Object.values(accounts ?? {}).filter(a => a.type === 'credit').reduce((s, a) => s + Math.abs(a.currentBalance ?? 0), 0);
    const net    = assets - debt;
    container.querySelector('#hero-assets').textContent = fmtCurrency(assets);
    container.querySelector('#hero-debt').textContent   = fmtCurrency(debt);
    container.querySelector('#hero-net').textContent    = fmtCurrency(net);
  };

  const refreshAccounts = () => {
    const merged = { ...(latestOwnerAccounts ?? {}), ...(latestPartnerAccounts ?? {}) };
    refreshHero(merged);
    renderAccountList(merged, hid, resolvedPartnerUid);
    rebuildSyncDropdown(merged);
  };

  dbListen(`accounts/${hid}`, accounts => {
    latestOwnerAccounts = accounts ?? {};
    refreshAccounts();
  });

  if (hid === uid) {
    getPartnerUid(uid).then(p => {
      resolvedPartnerUid = p;
      if (p) {
        dbListen(`accounts/${p}`, partnerAccounts => {
          latestPartnerAccounts = {};
          for (const [id, a] of Object.entries(partnerAccounts ?? {})) {
            latestPartnerAccounts[id] = { ...a, _isPartner: true };
          }
          refreshAccounts();
        });
      }
    });
  }

  renderAmazonSection(uid, hid).catch(() => {});

  container.querySelector('#link-account').addEventListener('click', () => openPlaidLink(uid));
  container.querySelector('#add-manual').addEventListener('click', () => openManualAccountForm(hid));
  container.querySelector('#sync-now').addEventListener('click', () => syncTransactions(uid));

  // Sync filter dropdown
  const _filterBtn   = container.querySelector('#sync-filter-btn');
  const _filterPanel = container.querySelector('#sync-filter-panel');
  _filterBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = _filterPanel.style.display !== 'none';
    _filterPanel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      const closeOnOutside = ev => {
        if (!_filterPanel.contains(ev.target) && ev.target !== _filterBtn) {
          _filterPanel.style.display = 'none';
          document.removeEventListener('click', closeOnOutside);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
    }
  });
  container.querySelector('#sync-all-accounts')?.addEventListener('change', e => {
    const on = e.target.checked;
    document.getElementById('sync-account-items')?.querySelectorAll('.sync-item-chk').forEach(c => { c.checked = on; });
    _syncFilterIds = on ? null : new Set();
    updateSyncFilterBtn();
  });

  container.querySelector('#sync-range').addEventListener('change', e => {
    const custom = document.getElementById('sync-custom-dates');
    if (custom) custom.style.display = e.target.value === 'custom' ? 'flex' : 'none';
    // set defaults for custom dates when switching to custom
    if (e.target.value === 'custom') {
      const today = new Date().toISOString().slice(0, 10);
      const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const fromEl = document.getElementById('sync-from');
      const toEl   = document.getElementById('sync-to');
      if (fromEl && !fromEl.value) fromEl.value = ago30;
      if (toEl   && !toEl.value)   toEl.value   = today;
    }
  });
  container.querySelector('#rationalize-accounts').addEventListener('click', () => openRationalizeSheet(hid));
}

export function openChangelogSheet() {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" style="max-height:85vh">
      <div class="sheet-handle"></div>
      <div class="sheet-hdr">
        <span class="sheet-title">What's new</span>
        <button class="sheet-close" id="changelog-close">✕</button>
      </div>
      <div class="changelog-list">
        ${CHANGELOG.map(entry => `
          <div class="changelog-entry">
            <div class="changelog-version-row">
              <span class="changelog-version">v${entry.version}</span>
              <span class="changelog-date">${entry.date}</span>
            </div>
            <ul class="changelog-changes">
              ${entry.changes.map(c => `<li>${c}</li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 260); };
  overlay.querySelector('#changelog-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

async function openRationalizeSheet(uid) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" style="max-height:85vh">
      <div class="sheet-handle"></div>
      <div class="sheet-hdr"><span class="sheet-title">Rationalize accounts</span><button class="sheet-close" id="rat-close">✕</button></div>
      <div style="padding:16px;font-size:0.8rem;color:var(--muted)">Analyzing…</div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 260); };
  overlay.querySelector('#rat-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Load data
  const [accountsSnap, txnsSnap] = await Promise.all([
    dbGet(`accounts/${uid}`),
    dbGet(`transactions/${uid}`),
  ]);
  const accounts = accountsSnap ?? {};
  const txns     = txnsSnap    ?? {};

  // Collect all Tiller account names from transactions
  const tillerNames = new Set();
  for (const t of Object.values(txns)) {
    if ((t.source === 'tiller' || t.categorySource === 'import') && t.accountName) {
      tillerNames.add(t.accountName);
    }
  }

  // Find suggestions: Plaid ↔ Tiller that look similar but aren't merged yet
  const plaidEntries = Object.entries(accounts).filter(([, a]) => !a.isManual);
  const suggestions  = [];
  const stopWords    = new Set(['account', 'checking', 'savings', 'card', 'credit', 'bank', 'the', 'and', 'my']);
  const sigWords     = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ')
    .filter(w => w.length >= 3 && !stopWords.has(w));

  for (const [plaidId, acc] of plaidEntries) {
    const existing  = acc.mergedNames ?? [];
    const excluded  = acc.excludedMerges ?? [];
    const matchName = acc.name ?? '';        // use original Plaid name for fuzzy matching, NOT alias
    const dispName  = acc.alias ?? acc.name; // display name shown in UI
    const wordsP    = new Set(sigWords(matchName));
    for (const tName of tillerNames) {
      if (existing.includes(tName)) continue;
      if (excluded.includes(tName)) continue;
      const pn = matchName.toLowerCase();
      const tn = tName.toLowerCase();
      const match = pn === tn || pn.includes(tn) || tn.includes(pn) ||
        sigWords(tName).some(w => wordsP.has(w));
      if (match) suggestions.push({ plaidId, plaidName: dispName, tillerName: tName });
    }
  }

  const sheet = overlay.querySelector('.sheet');
  if (!suggestions.length && tillerNames.size === 0) {
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-hdr"><span class="sheet-title">Rationalize accounts</span><button class="sheet-close" id="rat-close">✕</button></div>
      <div style="padding:16px;font-size:0.8rem;color:var(--muted)">No Tiller accounts detected — nothing to merge.</div>`;
  } else if (!suggestions.length) {
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-hdr"><span class="sheet-title">Rationalize accounts</span><button class="sheet-close" id="rat-close">✕</button></div>
      <div style="padding:16px;font-size:0.8rem;color:var(--muted)">No potential merges found. Tiller accounts (${tillerNames.size}): ${[...tillerNames].join(', ')}.</div>`;
  } else {
    // Build a lookup: accountName (tiller or plaid) → last 10 transactions
    const txnsByAcct = {};
    for (const [, t] of Object.entries(txns)) {
      const key = (t.accountName ?? '').toLowerCase();
      if (!key) continue;
      if (!txnsByAcct[key]) txnsByAcct[key] = [];
      txnsByAcct[key].push(t);
    }
    for (const key of Object.keys(txnsByAcct)) {
      txnsByAcct[key].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).splice(10);
    }

    const fmtAmt = n => (n < 0 ? '+' : '') + '$' + Math.abs(n).toFixed(2);

    const rows = suggestions.map((s, i) => `
      <div class="rat-row" data-i="${i}">
        <div class="rat-row-info">
          <div class="rat-row-account">
            <span class="rat-label">Linked bank</span>
            <span class="rat-plaid">${s.plaidName}</span>
          </div>
          <div class="rat-row-arrow">↔</div>
          <div class="rat-row-account">
            <span class="rat-label">Tiller import</span>
            <span class="rat-tiller">${s.tillerName}</span>
          </div>
        </div>
        <div class="rat-actions">
          <button class="rat-txns-btn btn-secondary" data-i="${i}" style="font-size:0.7rem;padding:4px 10px;border-radius:6px">Last 10 txns</button>
          <button class="rat-merge-btn btn-primary" data-i="${i}" style="font-size:0.7rem;padding:4px 10px;border-radius:6px">Merge</button>
          <button class="rat-skip-btn" data-i="${i}" style="font-size:0.7rem;padding:4px 8px;border-radius:6px;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer">Not same</button>
        </div>
        <div class="rat-txn-preview" id="rat-preview-${i}" style="display:none"></div>
      </div>`).join('');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-hdr"><span class="sheet-title">Merge duplicate accounts (${suggestions.length})</span><button class="sheet-close" id="rat-close">✕</button></div>
      <div style="padding:8px 16px 16px">
        <p style="font-size:0.75rem;color:var(--muted);margin:0 0 14px;line-height:1.5">These pairs look like the same account — one linked via Plaid and one imported from Tiller. <strong style="color:var(--text)">Merging</strong> hides the Tiller duplicate from filters and links their transactions together.</p>
        <div id="rat-list">${rows}</div>
      </div>`;

    sheet.querySelectorAll('.rat-merge-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s       = suggestions[Number(btn.dataset.i)];
        const current = (await dbGet(`accounts/${uid}/${s.plaidId}`))?.mergedNames ?? [];
        await dbSet(`accounts/${uid}/${s.plaidId}/mergedNames`, [...new Set([...current, s.tillerName])]);
        btn.textContent = '✓ Merged';
        btn.disabled    = true;
        btn.style.background = 'var(--brand)';
        btn.closest('.rat-row').querySelector('.rat-skip-btn')?.remove();
        btn.closest('.rat-row').querySelector('.rat-txns-btn')?.remove();
      });
    });

    sheet.querySelectorAll('.rat-skip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = suggestions[Number(btn.dataset.i)];
        const current = (await dbGet(`accounts/${uid}/${s.plaidId}`))?.excludedMerges ?? [];
        await dbSet(`accounts/${uid}/${s.plaidId}/excludedMerges`, [...new Set([...current, s.tillerName])]);
        const row = btn.closest('.rat-row');
        row.style.opacity = '0.4';
        row.style.pointerEvents = 'none';
        btn.textContent = '✓ Dismissed';
      });
    });

    sheet.querySelectorAll('.rat-txns-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s       = suggestions[Number(btn.dataset.i)];
        const preview = document.getElementById(`rat-preview-${btn.dataset.i}`);
        if (preview.style.display !== 'none') { preview.style.display = 'none'; return; }
        const keyP = s.plaidName.toLowerCase();
        const keyT = s.tillerName.toLowerCase();
        const pTxns = txnsByAcct[keyP] ?? [];
        const tTxns = txnsByAcct[keyT] ?? [];
        const allTxns = [...pTxns, ...tTxns].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 10);
        if (!allTxns.length) { preview.innerHTML = '<p style="font-size:0.72rem;color:var(--muted);padding:6px 0">No transactions found.</p>'; }
        else {
          preview.innerHTML = allTxns.map(t => `
            <div style="display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:0.72rem;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);flex-shrink:0">${t.date ?? ''}</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.merchantName ?? t.description ?? ''}</span>
              <span style="flex-shrink:0;font-weight:600">${fmtAmt(t.amount)}</span>
            </div>`).join('');
        }
        preview.style.display = 'block';
      });
    });
  }

  overlay.querySelectorAll('#rat-close').forEach(b => b.addEventListener('click', close));
}

function syncStatusDot(account) {
  const status   = account.lastSyncStatus ?? (account.isManual ? 'manual' : null);
  const lastSync = account.lastSync;
  const dateStr  = lastSync
    ? new Date(lastSync).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  if (account.isManual) return { cls: 'dot-manual', label: 'manual' };
  if (status === 'error') return { cls: 'dot-error', label: dateStr ? `error · ${dateStr}` : 'error' };

  if (lastSync) {
    const hoursSince = (Date.now() - new Date(lastSync).getTime()) / 3600000;
    if (hoursSince <= 4)  return { cls: 'dot-ok',    label: `synced ${dateStr}` };
    if (hoursSince <= 48) return { cls: 'dot-stale', label: `${dateStr} · refresh` };
    return { cls: 'dot-error', label: `${dateStr} · stale` };
  }
  return { cls: 'dot-unknown', label: 'never synced' };
}

// ── Amazon CSV parsing helpers ────────────────────────────────────────────────

function parseFriendlyDate(str) {
  if (!str) return null;
  // "January 15, 2025" or "January 15 2025"
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const mLong = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (mLong) {
    const mo = months.indexOf(mLong[1].toLowerCase()) + 1;
    if (mo > 0) return `${mLong[3]}-${String(mo).padStart(2, '0')}-${String(mLong[2]).padStart(2, '0')}`;
  }
  // "01/15/2025" or "1/15/2025"
  const mSlash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mSlash) return `${mSlash[3]}-${mSlash[1].padStart(2, '0')}-${mSlash[2].padStart(2, '0')}`;
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

function parseAmazonCsv(text) {
  // Minimal RFC 4180 parser
  function parseCsvRows(raw) {
    const rows = [];
    let i = 0;
    while (i < raw.length) {
      const row = [];
      while (i < raw.length && raw[i] !== '\n' && raw[i] !== '\r') {
        if (raw[i] === '"') {
          let cell = ''; i++;
          while (i < raw.length) {
            if (raw[i] === '"' && raw[i + 1] === '"') { cell += '"'; i += 2; }
            else if (raw[i] === '"') { i++; break; }
            else cell += raw[i++];
          }
          row.push(cell);
        } else {
          let cell = '';
          while (i < raw.length && raw[i] !== ',' && raw[i] !== '\n' && raw[i] !== '\r') cell += raw[i++];
          row.push(cell.trim());
        }
        if (raw[i] === ',') i++;
      }
      if (raw[i] === '\r') i++;
      if (raw[i] === '\n') i++;
      if (row.length > 1 || row[0]) rows.push(row);
    }
    return rows;
  }

  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const col = name => headers.findIndex(h => h.includes(name));

  const orderIdCol      = col('order id');
  const orderDateCol    = col('order date');
  const titleCol        = col('title');
  const itemTotalCol    = col('item total');
  const shipDateCol     = col('shipment date');
  const totalChargedCol = col('total charged');

  if (orderIdCol === -1) return [];

  const orderMap = new Map();
  for (const row of rows.slice(1)) {
    const orderId = row[orderIdCol]?.trim();
    if (!orderId || orderId.toLowerCase() === 'order id') continue;
    if (!orderMap.has(orderId)) {
      const rawDate = row[orderDateCol]?.trim() ?? '';
      orderMap.set(orderId, {
        orderNumber: orderId,
        shipDate: parseFriendlyDate(rawDate) ?? rawDate,
        total: 0,
        items: [],
        _charged: null,
      });
    }
    const entry = orderMap.get(orderId);
    if (titleCol !== -1) {
      const name = row[titleCol]?.trim();
      const priceStr = row[itemTotalCol]?.trim().replace(/[$,]/g, '');
      const price = parseFloat(priceStr) || null;
      if (name && name.toLowerCase() !== 'title') {
        entry.items.push({ name, price });
        if (price) entry.total = Math.round((entry.total + price) * 100) / 100;
      }
    }
    if (totalChargedCol !== -1) {
      const chargedStr = row[totalChargedCol]?.trim().replace(/[$,]/g, '');
      const charged = parseFloat(chargedStr) || 0;
      if (charged) entry._charged = charged;
    }
    if (shipDateCol !== -1 && row[shipDateCol]?.trim()) {
      const sd = parseFriendlyDate(row[shipDateCol].trim());
      if (sd) entry.shipDate = sd;
    }
  }

  return [...orderMap.values()]
    .map(o => ({ orderNumber: o.orderNumber, shipDate: o.shipDate, total: o._charged ?? o.total, items: o.items }))
    .filter(o => o.total > 0);
}

// ── Amazon / Gmail ────────────────────────────────────────────────────────────

async function renderAmazonSection(uid, hid) {
  const el = document.getElementById('amazon-section');
  if (!el) return;

  el.innerHTML = `
    <div class="acct-group" style="margin-top:0.5rem">
      <div class="acct-group-hdr">
        <div class="acct-group-left">
          <span style="font-size:1rem;margin-right:2px">📦</span>
          <span class="acct-inst-name">Amazon Orders</span>
        </div>
      </div>
      <div id="amazon-inner"><p style="padding:0.5rem 0.75rem;color:var(--muted);font-size:0.82rem">Loading…</p></div>
    </div>`;

  const inner = el.querySelector('#amazon-inner');

  try {
    const idToken = await auth.currentUser?.getIdToken();
    const resp    = await fetch(`${WORKER_URL}/gmail/status`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { accounts } = await resp.json();
    const accountList  = Object.entries(accounts ?? {});

    if (!accountList.length) {
      inner.innerHTML = `
        <div style="padding:0.6rem 0.75rem">
          <p style="color:var(--muted);font-size:0.82rem;margin-bottom:0.5rem">Connect Gmail to import Amazon order details and match them to your transactions.</p>
          <button class="btn-primary" id="amazon-connect-first" style="width:auto;padding:0.4rem 1rem;font-size:0.82rem">Connect Gmail</button>
        </div>`;
      inner.querySelector('#amazon-connect-first').addEventListener('click', () => { location.href = buildGmailAuthUrl('main'); });
      return;
    }

    // Load orders + transactions to compute match stats (show all accounts combined)
    const [ordersRaw, txnsRaw] = await Promise.all([
      dbGet(`amazonOrders/${hid}`).catch(() => null),
      dbGet(`transactions/${hid}`).catch(() => null),
    ]);
    const allOrders = Object.entries(ordersRaw ?? {});
    const allTxns   = Object.entries(txnsRaw   ?? {});
    const totalOrders    = allOrders.length;
    const matchedCount   = countMatchedOrders(allOrders, allTxns);
    const unmatchedCount = totalOrders - matchedCount;

    const acctRows = accountList.map(([key, acct]) => {
      const label       = acct.email ? `<strong>${acct.email}</strong>` : 'Gmail account';
      const lastSyncStr = acct.lastSync
        ? new Date(acct.lastSync).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'Never synced';
      const syncCls = acct.lastSync ? 'dot-ok' : 'dot-unknown';
      return `
        <div class="acct-row amazon-acct-row" data-key="${key}" style="cursor:pointer">
          <div class="acct-row-icon" style="font-size:1.25rem">📦</div>
          <div class="acct-row-info">
            <span class="acct-row-name">${label}</span>
            <span class="acct-row-sync ${syncCls}">${lastSyncStr}</span>
          </div>
          <div style="display:flex;gap:0.35rem;align-items:center">
            <button class="btn-ghost amazon-sync-btn" data-key="${key}" style="font-size:0.75rem;padding:2px 8px;white-space:nowrap" title="Sync this account">⟳ Sync</button>
            <span style="color:var(--muted);font-size:0.85rem">›</span>
          </div>
        </div>`;
    }).join('');

    const statsBar = totalOrders > 0 ? `
      <div style="padding:0.3rem 0.75rem 0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;font-size:0.8rem">
        <span style="color:var(--muted)">${totalOrders} orders found</span>
        <span style="color:#16a34a;font-weight:600">✓ ${matchedCount} matched</span>
        ${unmatchedCount > 0 ? `<span style="color:#d97706;font-weight:600;cursor:pointer" id="amazon-view-all">⚠ ${unmatchedCount} unmatched — view →</span>` : ''}
      </div>` : '';

    inner.innerHTML = `
      ${acctRows}
      ${statsBar}
      <div style="padding:0.3rem 0.75rem 0.6rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
        <button class="btn-secondary" id="amazon-view-orders-btn" style="width:auto;padding:0.35rem 0.8rem;font-size:0.82rem">View all orders</button>
        <button class="btn-secondary" id="amazon-sync-all-btn"    style="width:auto;padding:0.35rem 0.8rem;font-size:0.82rem">Sync (7d)</button>
        <button class="btn-secondary" id="amazon-history-btn"     style="width:auto;padding:0.35rem 0.8rem;font-size:0.82rem">Get history…</button>
        <button class="btn-ghost"     id="amazon-add-btn"         style="width:auto;padding:0.35rem 0.8rem;font-size:0.82rem">+ Add Gmail</button>
      </div>
      <p id="amazon-sync-msg" style="padding:0 0.75rem;font-size:0.8rem;color:var(--muted);margin:0 0 0.5rem"></p>`;

    inner.querySelector('#amazon-view-orders-btn')?.addEventListener('click', () => openAmazonOrdersSheet(uid, hid));
    inner.querySelector('#amazon-view-all')?.addEventListener('click',        () => openAmazonOrdersSheet(uid, hid, true));

    inner.querySelector('#amazon-add-btn').addEventListener('click', () => {
      const key = Math.random().toString(36).slice(2, 10);
      location.href = buildGmailAuthUrl(key);
    });

    // Helper: run a sync call and update the section + message
    async function doSync(body, labelLoading, labelDone) {
      const msg = document.getElementById('amazon-section')?.querySelector('#amazon-sync-msg');
      if (msg) msg.textContent = labelLoading;
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch(`${WORKER_URL}/gmail/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Sync failed');
      await renderAmazonSection(uid, hid);
      const newMsg = document.getElementById('amazon-section')?.querySelector('#amazon-sync-msg');
      if (newMsg) newMsg.textContent = `${labelDone} — found ${data.messages} email${data.messages !== 1 ? 's' : ''}, parsed ${data.parsed} order${data.parsed !== 1 ? 's' : ''}.`;
    }

    // Per-account sync (7 days)
    inner.querySelectorAll('.amazon-sync-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const key = btn.dataset.key;
        btn.disabled = true; btn.textContent = '⟳ …';
        try {
          await doSync({ key, days: 7 }, 'Syncing last 7 days…', 'Synced (7d)');
        } catch (err) {
          const msg = document.getElementById('amazon-section')?.querySelector('#amazon-sync-msg');
          if (msg) msg.textContent = `Sync error: ${err.message}`;
        }
      });
    });

    // Row tap → full order sheet
    inner.querySelectorAll('.amazon-acct-row').forEach(row => {
      row.addEventListener('click', () => openAmazonOrdersSheet(uid, hid));
    });

    // Sync All (7 days)
    inner.querySelector('#amazon-sync-all-btn').addEventListener('click', async () => {
      const btn = inner.querySelector('#amazon-sync-all-btn');
      btn.disabled = true; btn.textContent = 'Syncing…';
      try {
        await doSync({ days: 7 }, 'Syncing last 7 days…', 'Synced (7d)');
      } catch (err) {
        const msg = document.getElementById('amazon-section')?.querySelector('#amazon-sync-msg');
        if (msg) msg.textContent = `Error: ${err.message}`;
      }
    });

    // Get history — opens date range sheet
    inner.querySelector('#amazon-history-btn').addEventListener('click', () => openHistorySheet(uid, hid));

  } catch (e) {
    if (inner) inner.innerHTML = `<p style="padding:0.5rem 0.75rem;color:var(--danger);font-size:0.82rem">Could not load Amazon accounts: ${e.message}</p>`;
  }
}

// Global matching -- each transaction can only be claimed by one order.
// Returns Map<orderId, [txnId, txn]>.
function matchAllOrders(orders, txns) {
  const claimed = new Set();
  const result  = new Map();

  // Newest orders get first pick on disputed transactions
  const sorted = [...orders].sort((a, b) => (b[1].shipDate ?? '').localeCompare(a[1].shipDate ?? ''));

  for (const [orderId, order] of sorted) {
    if (!order.shipDate || !order.total) continue;
    const orderTime = new Date(order.shipDate).getTime();
    const EXACT = 0.01; // floating-point tolerance only

    // Pass 1: Amazon merchant name + exact amount, 7-day window
    let hit = txns.find(([id, t]) => {
      if (claimed.has(id)) return false;
      if (!AMAZON_PAT.test(t.merchantName ?? t.description ?? '')) return false;
      if (Math.abs(t.amount - order.total) > EXACT) return false;
      return Math.abs(new Date(t.date).getTime() - orderTime) / 86_400_000 <= 7;
    });

    // Pass 2: any merchant + exact amount, 5-day window
    if (!hit) hit = txns.find(([id, t]) => {
      if (claimed.has(id)) return false;
      if (t.isTransfer || t.amount < 0) return false;
      if (Math.abs(t.amount - order.total) > EXACT) return false;
      return Math.abs(new Date(t.date).getTime() - orderTime) / 86_400_000 <= 5;
    });

    if (hit) { result.set(orderId, hit); claimed.add(hit[0]); }
  }
  return result;
}

function countMatchedOrders(orders, txns) {
  return matchAllOrders(orders, txns).size;
}

async function openAmazonOrdersSheet(uid, hid, unmatchedOnly = false) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" style="max-height:90vh">
      <div class="sheet-handle"></div>
      <div class="sheet-hdr">
        <span class="sheet-title">📦 Amazon Orders${unmatchedOnly ? ' — Unmatched' : ''}</span>
        <button class="sheet-close" id="amazon-sheet-close">✕</button>
      </div>
      <div id="amazon-sheet-body" style="padding:0.75rem;overflow-y:auto;flex:1">
        <p style="color:var(--muted);font-size:0.85rem;text-align:center;padding:1rem">Loading orders…</p>
      </div>
      <div style="padding:0.5rem 0.75rem;border-top:1px solid var(--border);display:flex;gap:0.5rem;flex-wrap:wrap">
        <button id="amazon-reset-btn" class="btn-ghost" style="flex:1;color:var(--danger);font-size:0.8rem">Reset all orders</button>
        <button id="amazon-debug-btn" class="btn-ghost" style="flex:1;font-size:0.8rem" title="Copy raw email body for debugging">Debug email</button>
        <button id="amazon-csv-btn" class="btn-ghost" style="flex:1;font-size:0.8rem" title="Import Amazon order history CSV">Import CSV</button>
        <input type="file" id="amazon-csv-input" accept=".csv" style="display:none">
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 260); };
  overlay.querySelector('#amazon-sheet-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#amazon-reset-btn').addEventListener('click', async () => {
    if (!confirm('Delete all synced Amazon orders? This cannot be undone.')) return;
    const token = await auth.currentUser?.getIdToken();
    await fetch(`${WORKER_URL}/gmail/purge`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    close();
    renderAmazonSection(uid, hid).catch(() => {});
  });

  overlay.querySelector('#amazon-debug-btn').addEventListener('click', async () => {
    const btn = overlay.querySelector('#amazon-debug-btn');
    btn.textContent = 'Fetching…';
    btn.disabled = true;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res   = await fetch(`${WORKER_URL}/gmail/debug-body`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = JSON.stringify(await res.json(), null, 2);
      await navigator.clipboard.writeText(data);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Debug email'; btn.disabled = false; }, 2000);
    } catch (err) {
      btn.textContent = 'Error';
      btn.disabled = false;
      console.error('debug-body error', err);
    }
  });

  overlay.querySelector('#amazon-csv-btn').addEventListener('click', () => {
    overlay.querySelector('#amazon-csv-input').click();
  });

  overlay.querySelector('#amazon-csv-input').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const csvBtn = overlay.querySelector('#amazon-csv-btn');
    csvBtn.textContent = 'Parsing…';
    csvBtn.disabled = true;
    try {
      const text = await file.text();
      const orders = parseAmazonCsv(text);
      if (!orders.length) {
        alert('No orders found in this CSV. Use the Amazon "Items" or "Orders and Shipments" report from your order history.');
        csvBtn.textContent = 'Import CSV';
        csvBtn.disabled = false;
        return;
      }
      const dateRange = orders.length
        ? ` (${orders.map(o => o.shipDate).filter(Boolean).sort()[0]} – ${orders.map(o => o.shipDate).filter(Boolean).sort().at(-1)})`
        : '';
      const confirmed = confirm(`Found ${orders.length} orders${dateRange}.\n\nImport with AI categorization? This will run in the cloud and may take a moment.`);
      if (!confirmed) { csvBtn.textContent = 'Import CSV'; csvBtn.disabled = false; return; }
      csvBtn.textContent = 'Importing…';
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${WORKER_URL}/gmail/import-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orders }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      alert(`Done! ${result.imported} orders imported, ${result.skipped} duplicates skipped.`);
      close();
      renderAmazonSection(uid, hid).catch(() => {});
    } catch (err) {
      alert('Import failed: ' + err.message);
      csvBtn.textContent = 'Import CSV';
      csvBtn.disabled = false;
    }
    e.target.value = '';
  });

  const body = overlay.querySelector('#amazon-sheet-body');

  try {
    const [ordersRaw, txnsRaw] = await Promise.all([
      dbGet(`amazonOrders/${hid}`).catch(() => null),
      dbGet(`transactions/${hid}`).catch(() => null),
    ]);
    const allOrders = Object.entries(ordersRaw ?? {});
    const allTxns   = Object.entries(txnsRaw   ?? {});

    if (!allOrders.length) {
      body.innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem">No orders synced yet. Hit Sync All to import from Gmail.</p>`;
      return;
    }

    // Match orders globally — each transaction claimed by at most one order
    const matched = matchAllOrders(allOrders, allTxns);





    // For diagnostics: find nearest Amazon txns (within 30 days) for each unmatched order
    const nearbyAmazonTxns = allTxns.filter(([, t]) => AMAZON_PAT.test(t.merchantName ?? t.description ?? '') && t.amount > 0);

    // Sort newest first
    const sorted = [...allOrders].sort((a, b) =>
      (b[1].shipDate ?? '').localeCompare(a[1].shipDate ?? ''));
    const toShow  = unmatchedOnly ? sorted.filter(([id]) => !matched.has(id)) : sorted;

    const totalOrders    = allOrders.length;
    const matchedCount   = matched.size;
    const unmatchedCount = totalOrders - matchedCount;

    const summaryHtml = `
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;font-size:0.82rem">
        <span style="color:var(--muted)">${totalOrders} total</span>
        <span style="color:#16a34a;font-weight:600">✓ ${matchedCount} matched</span>
        ${unmatchedCount > 0 ? `<span style="color:#d97706;font-weight:600">⚠ ${unmatchedCount} unmatched</span>` : ''}
        ${unmatchedOnly && unmatchedCount === 0 ? `<span style="color:#16a34a">All orders matched!</span>` : ''}
      </div>`;

    const orderCards = toShow.map(([orderId, order]) => {
      const isMatched = matched.has(orderId);
      const txnEntry  = matched.get(orderId);
      // For unmatched: find the 2 nearest Amazon transactions by date
      let nearbyHtml = '';
      if (!isMatched && order.shipDate) {
        const orderTime = new Date(order.shipDate).getTime();
        const nearby = nearbyAmazonTxns
          .map(([, t]) => ({ t, diff: Math.abs(new Date(t.date).getTime() - orderTime) / 86_400_000 }))
          .filter(x => x.diff <= 30)
          .sort((a, b) => a.diff - b.diff)
          .slice(0, 3);
        if (nearby.length) {
          nearbyHtml = `<div style="margin-top:0.3rem;font-size:0.75rem;color:var(--muted)">
            Nearby Amazon charges:
            ${nearby.map(({ t, diff }) =>
              `<span style="display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin:2px">
                ${t.date} · ${fmtCurrency(t.amount)} · ${t.description ?? t.merchantName} (${diff < 1 ? 'same day' : Math.round(diff) + 'd apart'})
              </span>`).join('')}
          </div>`;
        } else {
          nearbyHtml = `<div style="margin-top:0.3rem;font-size:0.75rem;color:var(--muted)">No Amazon charges found within 30 days of this order.</div>`;
        }
      }

      const statusBar = isMatched
        ? `<div style="color:#16a34a;font-size:0.78rem;font-weight:600;margin-bottom:0.3rem">
             ✓ Matched: ${txnEntry[1].description ?? txnEntry[1].merchantName ?? 'Amazon'} · ${fmtCurrency(txnEntry[1].amount)}
           </div>`
        : `<div style="color:#d97706;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem">
             ⚠ No match for ${fmtCurrency(order.total)} around ${order.shipDate ? new Date(order.shipDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
           </div>${nearbyHtml}`;

      const itemsHtml = order.items?.length
        ? order.items.slice(0, 5).map(i =>
            `<div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--muted);padding:1px 0">
               <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.name}</span>
               <span style="margin-left:0.5rem;white-space:nowrap">${fmtCurrency(i.price)}</span>
             </div>`).join('') +
          (order.items.length > 5 ? `<p style="font-size:0.75rem;color:var(--muted);margin:2px 0 0">+${order.items.length - 5} more items</p>` : '')
        : '<p style="font-size:0.75rem;color:var(--muted);margin:0">No items extracted</p>';

      const orderLabel = order.orderNumber ? `Order #${order.orderNumber}` : 'Amazon order';
      const borderColor = isMatched ? '#bbf7d0' : '#fde68a';

      return `
        <div style="border:1.5px solid ${borderColor};border-radius:10px;padding:0.6rem 0.75rem;margin-bottom:0.6rem">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.25rem">
            <div>
              <span style="font-size:0.72rem;color:var(--muted)">${order.shipDate ?? '—'}</span>
              <span style="font-size:0.72rem;color:var(--muted);margin-left:0.5rem">${orderLabel}</span>
            </div>
            <span style="font-weight:700;font-size:0.9rem">${fmtCurrency(order.total)}</span>
          </div>
          ${statusBar}
          <div style="border-top:1px solid var(--border);padding-top:0.3rem;margin-top:0.1rem">${itemsHtml}</div>
        </div>`;
    }).join('');

    body.innerHTML = summaryHtml + (toShow.length ? orderCards : `<p style="color:var(--muted);text-align:center;padding:1rem">Nothing to show.</p>`);

  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger);font-size:0.85rem">Error loading orders: ${e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function renderAccountList(accounts, uid, partnerUid) {
  const el = document.getElementById('account-list');
  if (!el) return;
  const entries = Object.entries(accounts);
  if (!entries.length) {
    el.innerHTML = `<div class="acct-empty">No accounts linked yet. Tap "+ Link Bank" to get started.</div>`;
    return;
  }

  // Group by institution
  const grouped = new Map();
  for (const [id, a] of entries) {
    const inst = a.institution ?? 'Manual';
    if (!grouped.has(inst)) grouped.set(inst, []);
    grouped.get(inst).push([id, a]);
  }

  el.innerHTML = [...grouped.entries()].map(([institution, accts]) => {
    const rep       = accts[0][1];
    const isPartner = !!rep._isPartner;
    const dot       = syncStatusDot(rep);
    const itemId    = rep.plaidItemId ?? null;
    const slot      = rep.plaidSlot ?? 1;

    const controls = !isPartner && itemId ? `
      <button class="acct-ctrl-btn btn-reconnect" data-item-id="${itemId}" data-slot="${slot}">Reconnect</button>
      <button class="acct-ctrl-btn acct-unlink-btn" data-item-id="${itemId}" data-slot="${slot}">Unlink</button>
    ` : '';

    const partnerBadge = isPartner
      ? `<span class="acct-partner-badge">Partner</span>` : '';

    return `
      <div class="acct-group">
        <div class="acct-group-hdr">
          <div class="acct-group-left">
            <span class="sync-dot ${dot.cls}"></span>
            <span class="acct-inst-name">${institution}</span>
            ${partnerBadge}
            <span class="acct-sync-label ${dot.cls}">${dot.label}</span>
          </div>
          <div class="acct-group-controls">${controls}</div>
        </div>
        ${accts.map(([id, a]) => {
          const isDebt    = a.type === 'credit';
          const lastSyncText = a.isManual ? 'Manual' :
            a.lastSync ? `Synced ${new Date(a.lastSync + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` :
            'Never synced';
          const lastSyncCls = a.isManual ? 'dot-manual' :
            !a.lastSync ? 'dot-unknown' :
            a.lastSyncStatus === 'error' ? 'dot-error' :
            (Date.now() - new Date(a.lastSync + 'T12:00:00').getTime()) > 48 * 3600000 ? 'dot-error' :
            (Date.now() - new Date(a.lastSync + 'T12:00:00').getTime()) > 4 * 3600000 ? 'dot-stale' :
            'dot-ok';
          const bal       = a.currentBalance ?? 0;
          const dispName  = a.alias ?? a.name;
          const mergedTag = (a.mergedNames ?? []).length > 0
            ? `<span class="acct-merged-badge" title="${(a.mergedNames ?? []).join(', ')}">+${(a.mergedNames ?? []).length} merged</span>` : '';
          return `
            <div class="acct-row" data-id="${id}">
              <div class="acct-row-icon">${acctIcon(a.type)}</div>
              <div class="acct-row-info">
                <span class="acct-row-name">${dispName}</span>
                <span class="acct-row-sub">${capitalize(a.subtype ?? a.type)}${mergedTag}</span>
                <span class="acct-row-sync ${lastSyncCls}">${lastSyncText}</span>
              </div>
              <span class="acct-row-bal ${isDebt ? 'debt' : ''}">${isDebt ? '−' : ''}${fmtCurrency(Math.abs(bal))}</span>
              ${!isPartner ? `<button class="acct-rename-btn" data-id="${id}" title="Rename">✎</button>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  }).join('');

  el.querySelectorAll('.btn-reconnect').forEach(btn => {
    btn.addEventListener('click', () => reconnectPlaid(uid, btn.dataset.itemId, Number(btn.dataset.slot)));
  });
  el.querySelectorAll('.acct-unlink-btn').forEach(btn => {
    btn.addEventListener('click', () => unlinkAccount(uid, btn.dataset.itemId, Number(btn.dataset.slot)));
  });

  el.querySelectorAll('.acct-rename-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row      = btn.closest('.acct-row');
      const acctId   = btn.dataset.id;
      const nameSpan = row.querySelector('.acct-row-name');
      const current  = nameSpan.textContent;
      const input    = document.createElement('input');
      input.type      = 'text';
      input.value     = current;
      input.className = 'acct-rename-input';
      nameSpan.replaceWith(input);
      input.focus();
      input.select();

      const save = async () => {
        const val = input.value.trim();
        if (val && val !== current) {
          await dbSet(`accounts/${uid}/${acctId}/alias`, val);
        }
        const next = document.createElement('span');
        next.className   = 'acct-row-name';
        next.textContent = val || current;
        input.replaceWith(next);
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  });
}

function acctIcon(type) {
  const map = { checking: '🏦', savings: '🏦', credit: '💳', investment: '📈', loan: '📋', other: '💼' };
  return map[type] ?? '🏦';
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

async function openPlaidLink(uid) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}/plaid/link-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) { alert('Could not start bank connection. Try again.'); return; }
  const { link_token, slot } = await res.json();

  if (!window.Plaid) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Save token+slot so the OAuth redirect handler can resume the flow if Venmo/etc redirects back
  sessionStorage.setItem('plaid-oauth-pending', JSON.stringify({ link_token, slot }));

  window.Plaid.create({
    token: link_token,
    onSuccess: async (publicToken) => {
      sessionStorage.removeItem('plaid-oauth-pending');
      const idTok = await auth.currentUser.getIdToken();
      await fetch(`${WORKER_URL}/plaid/exchange-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTok}` },
        body: JSON.stringify({ public_token: publicToken, slot }),
      });
      await renderAmazonSection(uid, uid).catch(() => {});
    },
    onExit: (err) => {
      if (err) console.error('Plaid exit:', err);
      // Don't clear sessionStorage on exit — user may have been redirected for OAuth
    },
  }).open();
}

export async function resumePlaidOAuthIfPending() {
  const stored = sessionStorage.getItem('plaid-oauth-pending');
  if (!stored) return;
  const { link_token, slot } = JSON.parse(stored);
  sessionStorage.removeItem('plaid-oauth-pending');

  if (!window.Plaid) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  window.Plaid.create({
    token: link_token,
    receivedRedirectUri: window.location.href, // tells Plaid this is the OAuth return
    onSuccess: async (publicToken) => {
      const uid   = auth.currentUser?.uid;
      const idTok = await auth.currentUser?.getIdToken();
      await fetch(`${WORKER_URL}/plaid/exchange-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTok}` },
        body: JSON.stringify({ public_token: publicToken, slot }),
      });
      if (uid) await renderAmazonSection(uid, uid).catch(() => {});
    },
    onExit: (err) => { if (err) console.error('Plaid OAuth resume exit:', err); },
  }).open();
}

function rebuildSyncDropdown(accounts) {
  const panel = document.getElementById('sync-account-items');
  if (!panel) return;

  const itemMap = new Map();
  for (const [, a] of Object.entries(accounts ?? {})) {
    if (a.isManual || !a.plaidItemId) continue;
    if (!itemMap.has(a.plaidItemId)) {
      itemMap.set(a.plaidItemId, { institution: a.institution ?? a.name ?? a.plaidItemId, count: 0 });
    }
    itemMap.get(a.plaidItemId).count++;
  }

  const allChkEl = document.getElementById('sync-all-accounts');
  if (allChkEl) allChkEl.checked = _syncFilterIds === null;

  panel.innerHTML = [...itemMap.entries()].map(([itemId, { institution, count }]) => `
    <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;padding:3px 0;cursor:pointer">
      <input type="checkbox" class="sync-item-chk" data-item-id="${itemId}"
        ${!_syncFilterIds || _syncFilterIds.has(itemId) ? 'checked' : ''}
        style="accent-color:var(--primary)">
      <span>${institution}<span style="color:var(--muted);font-size:0.72rem;margin-left:3px">(${count})</span></span>
    </label>
  `).join('');

  panel.querySelectorAll('.sync-item-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const checkedIds = [...panel.querySelectorAll('.sync-item-chk:checked')].map(c => c.dataset.itemId);
      const allChk = document.getElementById('sync-all-accounts');
      if (checkedIds.length === itemMap.size) {
        _syncFilterIds = null;
        if (allChk) allChk.checked = true;
      } else {
        _syncFilterIds = new Set(checkedIds);
        if (allChk) allChk.checked = false;
      }
      updateSyncFilterBtn();
    });
  });
}

async function syncTransactions(uid) {
  const btn       = document.getElementById('sync-now');
  const rangeEl   = document.getElementById('sync-range');
  const rangeVal  = rangeEl?.value ?? '90';
  let startDate, endDate;
  if (rangeVal === 'custom') {
    startDate = document.getElementById('sync-from')?.value;
    endDate   = document.getElementById('sync-to')?.value;
    if (!startDate || !endDate) { alert('Please set both start and end dates.'); return; }
  } else {
    const days = parseInt(rangeVal, 10);
    endDate   = new Date().toISOString().slice(0, 10);
    startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  }
  if (!btn) return;
  btn.textContent = 'Syncing…'; btn.disabled = true;
  const fp = document.getElementById('sync-filter-panel');
  if (fp) fp.style.display = 'none';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const body = { startDate, endDate };
    if (_syncFilterIds && _syncFilterIds.size > 0) body.itemIds = [..._syncFilterIds];
    const res = await fetch(`${WORKER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    const { synced } = await res.json();
    btn.textContent = `Sync (${synced} new)`;
    setTimeout(() => { if (btn) { btn.textContent = 'Sync'; btn.disabled = false; } }, 4000);
  } catch {
    btn.textContent = 'Sync failed'; btn.disabled = false;
  }
}

async function reconnectPlaid(uid, itemId, slot) {
  const btn = document.querySelector(`.btn-reconnect[data-item-id="${itemId}"]`);
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/plaid/reconnect-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ itemId, slot }),
    });
    if (!res.ok) throw new Error();
    const { link_token } = await res.json();

    if (!window.Plaid) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    window.Plaid.create({
      token: link_token,
      onSuccess: async (publicToken) => {
        if (btn) { btn.textContent = 'Syncing…'; btn.disabled = true; }
        try {
          const idTok = await auth.currentUser.getIdToken();
          await fetch(`${WORKER_URL}/plaid/exchange-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTok}` },
            body: JSON.stringify({ public_token: publicToken, slot }),
          });
          // Trigger an immediate sync to backfill any missed transactions
          await fetch(`${WORKER_URL}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTok}` },
          });
        } catch { /* non-fatal — Firebase was updated; cron will pick up the rest */ }
        if (btn) { btn.textContent = 'Reconnected ✓'; btn.disabled = false; }
        renderAccounts(document.getElementById('main'));
      },
      onExit: () => { if (btn) { btn.textContent = 'Reconnect'; btn.disabled = false; } },
    }).open();
  } catch {
    if (btn) { btn.textContent = 'Reconnect'; btn.disabled = false; }
  }
}

async function unlinkAccount(uid, itemId, slot) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>Unlink account?</h3>
      <p>Removes the bank connection. Synced transactions can optionally be deleted.</p>
      <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
        <input type="checkbox" id="unlink-delete-txns" /> Also delete synced transactions
      </label>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-confirm" style="flex:1;background:#ef4444;border-color:#ef4444">Unlink</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('.modal-confirm').addEventListener('click', async () => {
    const deleteTxns = modal.querySelector('#unlink-delete-txns').checked;
    modal.remove();
    try {
      const idToken = await auth.currentUser.getIdToken();
      await fetch(`${WORKER_URL}/plaid/remove-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ itemId, slot, deleteTransactions: deleteTxns }),
      });
    } catch { alert('Failed to unlink. Try again.'); }
  });
}

function openManualAccountForm(uid) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>Add Manual Account</h3>
      <input id="m-name" placeholder="Account name" />
      <select id="m-type">
        <option value="checking">Checking</option>
        <option value="savings">Savings</option>
        <option value="credit">Credit Card</option>
        <option value="investment">Investment</option>
        <option value="loan">Loan</option>
        <option value="other">Other</option>
      </select>
      <input id="m-balance" type="number" placeholder="Current balance ($)" step="0.01" />
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-save" style="flex:1">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-save').addEventListener('click', async () => {
    const name    = modal.querySelector('#m-name').value.trim();
    const type    = modal.querySelector('#m-type').value;
    const balance = Number(modal.querySelector('#m-balance').value);
    if (!name) return;
    const id = `manual_${Date.now()}`;
    await dbSet(`accounts/${uid}/${id}`, { name, type, subtype: type, currentBalance: balance, isManual: true, institution: 'Manual', lastSync: null });
    modal.remove();
  });
  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

