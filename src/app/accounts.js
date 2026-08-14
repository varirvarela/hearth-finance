import { dbListen, dbSet, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtDate } from '../shared/format.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export function renderAccounts(container) {
  const today   = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="page accounts">
      <div id="account-list"></div>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-primary" id="link-account" style="flex:1">+ Link Bank Account</button>
        <button class="btn-secondary" id="add-manual" style="flex:1">+ Manual Account</button>
      </div>
      <div style="margin-top:0.5rem">
        <div class="sync-controls">
          <input type="date" id="sync-from" value="${ninetyAgo}" style="flex:1" />
          <input type="date" id="sync-to"   value="${today}"     style="flex:1" />
          <button class="btn-ghost" id="sync-now" style="flex:2">Sync transactions</button>
        </div>
      </div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let latestOwnerAccounts  = null;
  let latestPartnerAccounts = null;
  let resolvedPartnerUid   = null;

  const refreshAccounts = () => {
    const merged = { ...(latestOwnerAccounts ?? {}), ...(latestPartnerAccounts ?? {}) };
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

  document.getElementById('link-account').addEventListener('click', () => openPlaidLink(uid));
  document.getElementById('add-manual').addEventListener('click', () => openManualAccountForm(uid));
  document.getElementById('sync-now').addEventListener('click', () => syncTransactions(uid));
}

function renderAccountList(accounts, uid, partnerUid) {
  const el = document.getElementById('account-list');
  const entries = Object.entries(accounts);
  if (!entries.length) {
    el.innerHTML = '<p class="empty">No accounts linked yet. Add a bank account to get started.</p>';
    return;
  }

  const grouped = {};
  for (const [id, a] of entries) {
    const group = a.institution ?? 'Manual';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push([id, a]);
  }

  el.innerHTML = Object.entries(grouped).map(([institution, accts]) => {
    const rep        = accts[0][1];
    const isPartner  = !!rep._isPartner;
    const status     = rep.lastSyncStatus ?? null;
    const dotClass   = status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'unknown';
    const itemId     = rep.plaidItemId ?? null;
    const slot       = rep.plaidSlot ?? 1;
    const reconnectBtn = (!isPartner && itemId)
      ? `<button class="btn-reconnect" data-item-id="${itemId}" data-slot="${slot}">Reconnect</button>`
      : '';
    const unlinkBtn = (!isPartner && itemId)
      ? `<button class="btn-unlink btn-ghost" style="font-size:0.75rem;padding:2px 8px;color:#ef4444;border-color:#ef4444" data-item-id="${itemId}" data-slot="${slot}">Unlink</button>`
      : '';
    const partnerBadge = isPartner
      ? `<span style="background:#dbeafe;color:#1e40af;border-radius:10px;padding:1px 6px;font-size:0.75rem;font-weight:600">Partner</span>`
      : '';
    return `
    <div class="account-group">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <span class="sync-status-dot ${dotClass}"></span>
        <h3 class="account-institution" style="margin-bottom:0">${institution}</h3>
        ${partnerBadge}
        ${reconnectBtn}
        ${unlinkBtn}
      </div>
      ${accts.map(([id, a]) => `
        <div class="account-row">
          <div class="account-info">
            <span class="account-name">${a.name}</span>
            <span class="account-meta">${a.subtype ?? a.type} · Last sync ${a.lastSync ? fmtDate(a.lastSync) : 'never'}</span>
          </div>
          <span class="account-balance ${a.type === 'credit' ? 'debt' : ''}">${fmtCurrency(a.currentBalance ?? 0)}</span>
        </div>`).join('')}
    </div>`;
  }).join('');

  el.querySelectorAll('.btn-reconnect').forEach(btn => {
    btn.addEventListener('click', () => reconnectPlaid(uid, btn.dataset.itemId, Number(btn.dataset.slot)));
  });

  el.querySelectorAll('.btn-unlink').forEach(btn => {
    btn.addEventListener('click', () => unlinkAccount(uid, btn.dataset.itemId, Number(btn.dataset.slot)));
  });
}

async function openPlaidLink(uid) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}/plaid/link-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) { alert('Could not start bank connection. Try again.'); return; }
  const { link_token, slot } = await res.json();

  // Plaid Link requires the Plaid Link JS library loaded from CDN.
  // Load it dynamically so it's not part of the main bundle.
  if (!window.Plaid) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const handler = window.Plaid.create({
    token: link_token,
    onSuccess: async (publicToken) => {
      const exchRes = await fetch(`${WORKER_URL}/plaid/exchange-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ public_token: publicToken, slot }),
      });
      if (!exchRes.ok) { alert('Failed to connect account. Please try again.'); return; }
      // Worker writes account records to RTDB; dbListen will pick up the change automatically.
    },
    onExit: (err) => { if (err) console.error('Plaid Link exit error:', err); },
  });
  handler.open();
}

async function syncTransactions(uid) {
  const btn       = document.getElementById('sync-now');
  const startDate = document.getElementById('sync-from').value;
  const endDate   = document.getElementById('sync-to').value;
  btn.textContent = 'Syncing…';
  btn.disabled = true;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ startDate, endDate }),
    });
    const { synced, errors, error } = await res.json();
    if (error) throw new Error(error);
    btn.textContent = `Sync transactions (${synced} new)`;
    setTimeout(() => { btn.textContent = 'Sync transactions'; btn.disabled = false; }, 4000);
  } catch (err) {
    console.error('Sync failed:', err);
    btn.textContent = 'Sync failed — try again';
    btn.disabled = false;
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
    if (!res.ok) throw new Error('Failed to get reconnect token');
    const { link_token } = await res.json();

    if (!window.Plaid) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const handler = window.Plaid.create({
      token: link_token,
      onSuccess: () => {
        if (btn) { btn.textContent = 'Reconnected!'; btn.disabled = false; }
        setTimeout(() => { if (btn) btn.textContent = 'Reconnect'; }, 3000);
      },
      onExit: (err) => {
        if (btn) { btn.textContent = 'Reconnect'; btn.disabled = false; }
        if (err) console.error('Plaid reconnect exit error:', err);
      },
    });
    handler.open();
  } catch (err) {
    if (btn) { btn.textContent = 'Reconnect'; btn.disabled = false; }
  }
}

async function unlinkAccount(uid, itemId, slot) {
  await new Promise((resolve, reject) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <h3>Unlink account?</h3>
        <p>This will remove the bank connection and its accounts from Hearth. Your synced transactions can optionally be deleted too.</p>
        <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
          <input type="checkbox" id="unlink-delete-txns" />
          Also delete synced transactions
        </label>
        <div style="display:flex;gap:0.5rem;margin-top:1rem">
          <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
          <button class="btn-primary modal-confirm" style="flex:1;background:#ef4444;border-color:#ef4444">Unlink</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.modal-cancel').addEventListener('click', () => {
      modal.remove();
      reject(new Error('cancelled'));
    });

    modal.querySelector('.modal-confirm').addEventListener('click', async () => {
      const deleteTransactions = modal.querySelector('#unlink-delete-txns').checked;
      modal.remove();

      const btn = document.querySelector(`.btn-unlink[data-item-id="${itemId}"]`);
      if (btn) { btn.textContent = 'Unlinking…'; btn.disabled = true; }

      try {
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch(`${WORKER_URL}/plaid/remove-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ itemId, slot, deleteTransactions }),
        });
        if (!res.ok) throw new Error('Failed to unlink account');
        // Firebase listener will automatically update the account list
        resolve();
      } catch {
        alert('Failed to unlink account. Please try again.');
        if (btn) { btn.textContent = 'Unlink'; btn.disabled = false; }
        resolve();
      }
    });

    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.remove();
        reject(new Error('cancelled'));
      }
    });
  }).catch(() => {});
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
