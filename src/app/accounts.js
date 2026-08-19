import { dbGet, dbSet, dbListen, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtDate } from '../shared/format.js';
import { signOut } from 'firebase/auth';
import { openImportModal } from './import.js';
import { CHANGELOG } from '../shared/changelog.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export function renderAccounts(container) {
  const today     = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

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

        <div class="acct-sync-row">
          <input type="date" id="sync-from" value="${ninetyAgo}" />
          <input type="date" id="sync-to"   value="${today}" />
          <button class="btn-ghost" id="sync-now">Sync</button>
        </div>

        <!-- Settings section -->
        <div class="acct-settings">
          <div class="acct-settings-hdr">Settings</div>

          <div class="acct-settings-group">
            <div class="acct-settings-label">Partner Sharing</div>
            <div id="partner-section"></div>
          </div>

          <div class="acct-settings-group">
            <div class="acct-settings-label">Data</div>
            <button class="acct-settings-btn" id="import-csv">Import Tiller CSV…</button>
            <button class="acct-settings-btn" id="export-csv">Export CSV</button>
            <button class="acct-settings-btn" id="go-automation">Manage categorization rules →</button>
          </div>

          <div class="acct-settings-group">
            <div class="acct-settings-label">About</div>
            <div class="acct-settings-about">Hearth Finance · v${CHANGELOG[0].version}</div>
            <button class="acct-settings-btn" id="show-changelog">What's new →</button>
          </div>

          <button class="btn-danger" id="sign-out" style="margin-top:1rem;width:100%;border-radius:8px;font-size:0.78rem">Sign Out</button>
        </div>
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
  container.querySelector('#import-csv').addEventListener('click', () => openImportModal());
  container.querySelector('#export-csv').addEventListener('click', () => exportCsv(uid));
  container.querySelector('#sign-out').addEventListener('click', () => signOut(auth));
  container.querySelector('#go-automation').addEventListener('click', () => { location.hash = 'automation'; });
  container.querySelector('#show-changelog').addEventListener('click', () => openChangelogSheet());

  renderPartnerSection(uid);
}

function openChangelogSheet() {
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

function syncStatusDot(account) {
  const status   = account.lastSyncStatus ?? (account.isManual ? 'manual' : null);
  const lastSync = account.lastSync;

  if (account.isManual) return { cls: 'dot-manual', label: 'manual' };
  if (status === 'error') return { cls: 'dot-error', label: 'error' };

  if (lastSync) {
    const hoursSince = (Date.now() - new Date(lastSync).getTime()) / 3600000;
    if (hoursSince <= 4)  return { cls: 'dot-ok',    label: 'synced ✓' };
    if (hoursSince <= 48) return { cls: 'dot-stale', label: 'stale' };
    return { cls: 'dot-error', label: 'stale' };
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
          const isDebt = a.type === 'credit';
          const bal = a.currentBalance ?? 0;
          return `
            <div class="acct-row">
              <div class="acct-row-icon">${acctIcon(a.type)}</div>
              <div class="acct-row-info">
                <span class="acct-row-name">${a.name}</span>
                <span class="acct-row-sub">${capitalize(a.subtype ?? a.type)} · Last sync ${a.lastSync ? fmtDate(a.lastSync) : 'never'}</span>
              </div>
              <span class="acct-row-bal ${isDebt ? 'debt' : ''}">${isDebt ? '−' : ''}${fmtCurrency(Math.abs(bal))}</span>
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
  const startDate = document.getElementById('sync-from').value;
  const endDate   = document.getElementById('sync-to').value;
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

function renderPartnerSection(uid) {
  const el = document.getElementById('partner-section');
  if (!el) return;
  dbGet(`users/${uid}`).then(user => {
    if (user?.partnerUid) {
      dbGet(`users/${user.partnerUid}`).then(partner => {
        el.innerHTML = `<div class="acct-settings-about">Sharing with <strong>${partner?.name ?? partner?.email ?? 'your partner'}</strong>.</div>`;
      });
    } else {
      el.innerHTML = `
        <button class="acct-settings-btn" id="send-invite">Send invite code</button>
        <div style="display:flex;gap:6px;margin-top:6px">
          <input id="invite-code-input" placeholder="Enter invite code" style="flex:1;border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;font-size:0.85rem" />
          <button class="btn-primary" id="accept-invite" style="width:auto;padding:8px 14px">Join</button>
        </div>
      `;
      el.querySelector('#send-invite').addEventListener('click', () => generateInvite(uid));
      el.querySelector('#accept-invite').addEventListener('click', () => acceptInvite(uid));
    }
  });
}

async function generateInvite(uid) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  await dbSet(`invites/${code}`, { fromUid: uid, email: auth.currentUser.email, createdAt: Date.now(), accepted: false });
  await dbSet(`users/${uid}/inviteCode`, code);
  alert(`Your invite code: ${code}\n\nShare this with your partner.`);
}

async function acceptInvite(uid) {
  const code   = document.getElementById('invite-code-input').value.trim().toUpperCase();
  const invite = await dbGet(`invites/${code}`);
  if (!invite || invite.accepted) { alert('Invalid or already-used invite code.'); return; }
  await dbSet(`invites/${code}/accepted`, true);
  await dbSet(`invites/${code}/acceptedBy`, uid);
  await dbSet(`users/${uid}/partnerUid`, invite.fromUid);
  await dbSet(`users/${invite.fromUid}/partnerUid`, uid);
  renderPartnerSection(uid);
}

async function exportCsv(uid) {
  const txns = await dbGet(`transactions/${uid}`);
  if (!txns) { alert('No transactions to export.'); return; }
  const rows = [['Date', 'Description', 'Merchant', 'Amount', 'Category', 'Account', 'Notes']];
  for (const t of Object.values(txns)) {
    rows.push([t.date, t.description, t.merchantName ?? '', t.amount, t.category, t.accountId, t.notes ?? '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `hearth-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
