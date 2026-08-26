import { dbGet, dbSet, dbListen, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtDate } from '../shared/format.js';
import { CHANGELOG } from '../shared/changelog.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

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
          <button class="btn-primary" id="sync-now" style="width:auto;padding:0.45rem 1rem;font-size:0.82rem">Sync</button>
        </div>

        <button class="acct-settings-btn" id="rationalize-accounts" style="margin-bottom:12px">
          Rationalize accounts — find duplicates →
        </button>

      </div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

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
    renderAccountList(merged, uid, resolvedPartnerUid);
  };

  dbListen(`accounts/${uid}`, accounts => {
    latestOwnerAccounts = accounts ?? {};
    refreshAccounts();
  });

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

  container.querySelector('#link-account').addEventListener('click', () => openPlaidLink(uid));
  container.querySelector('#add-manual').addEventListener('click', () => openManualAccountForm(uid));
  container.querySelector('#sync-now').addEventListener('click', () => syncTransactions(uid));
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
  container.querySelector('#rationalize-accounts').addEventListener('click', () => openRationalizeSheet(uid));
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

  window.Plaid.create({
    token: link_token,
    onSuccess: async (publicToken) => {
      const idTok = await auth.currentUser.getIdToken();
      await fetch(`${WORKER_URL}/plaid/exchange-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTok}` },
        body: JSON.stringify({ public_token: publicToken, slot }),
      });
    },
    onExit: (err) => { if (err) console.error('Plaid exit:', err); },
  }).open();
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
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ startDate, endDate }),
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
      onSuccess: () => { if (btn) { btn.textContent = 'Reconnected!'; btn.disabled = false; } },
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

