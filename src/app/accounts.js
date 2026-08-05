import { dbListen, dbSet, auth } from '../shared/firebase.js';
import { fmtCurrency, fmtDate } from '../shared/format.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export function renderAccounts(container) {
  container.innerHTML = `
    <div class="page accounts">
      <div id="account-list"></div>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-primary" id="link-account" style="flex:1">+ Link Bank Account</button>
        <button class="btn-secondary" id="add-manual" style="flex:1">+ Manual Account</button>
      </div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  dbListen(`accounts/${uid}`, accounts => {
    renderAccountList(accounts ?? {});
  });

  document.getElementById('link-account').addEventListener('click', () => openPlaidLink(uid));
  document.getElementById('add-manual').addEventListener('click', () => openManualAccountForm(uid));
}

function renderAccountList(accounts) {
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

  el.innerHTML = Object.entries(grouped).map(([institution, accts]) => `
    <div class="account-group">
      <h3 class="account-institution">${institution}</h3>
      ${accts.map(([id, a]) => `
        <div class="account-row">
          <div class="account-info">
            <span class="account-name">${a.name}</span>
            <span class="account-meta">${a.subtype ?? a.type} · Last sync ${a.lastSync ? fmtDate(a.lastSync) : 'never'}</span>
          </div>
          <span class="account-balance ${a.type === 'credit' ? 'debt' : ''}">${fmtCurrency(a.currentBalance ?? 0)}</span>
        </div>`).join('')}
    </div>`).join('');
}

async function openPlaidLink(uid) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}/plaid/link-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) { alert('Could not start bank connection. Try again.'); return; }
  const { link_token } = await res.json();

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
    onSuccess: async (publicToken, metadata) => {
      const exchRes = await fetch(`${WORKER_URL}/plaid/exchange-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ public_token: publicToken }),
      });
      if (!exchRes.ok) { alert('Failed to connect account. Please try again.'); return; }
      // Worker writes account records to RTDB; dbListen will pick up the change automatically.
    },
    onExit: (err) => { if (err) console.error('Plaid Link exit error:', err); },
  });
  handler.open();
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
