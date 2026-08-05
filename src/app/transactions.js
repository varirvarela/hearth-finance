import { dbListen, dbUpdate, dbPush, auth } from '../shared/firebase.js';
import { fmtCurrency, fmtDate } from '../shared/format.js';
import { CATEGORIES, getCategoryById } from '../shared/categories.js';

export function renderTransactions(container) {
  container.innerHTML = `
    <div class="page transactions">
      <div class="toolbar">
        <input type="search" id="txn-search" placeholder="Search…" />
        <select id="txn-cat-filter">
          <option value="">All categories</option>
          ${CATEGORIES.filter(c => !c.parent).map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
        </select>
      </div>
      <div id="txn-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let allTxns = [];

  const refresh = () => {
    const query  = document.getElementById('txn-search').value.toLowerCase();
    const catFilter = document.getElementById('txn-cat-filter').value;
    const filtered = allTxns.filter(([, t]) => {
      if (catFilter && t.category !== catFilter && !t.category?.startsWith(catFilter + '_')) return false;
      if (query && !t.description?.toLowerCase().includes(query) && !t.merchantName?.toLowerCase().includes(query)) return false;
      return true;
    });
    renderList(filtered, uid);
  };

  dbListen(`transactions/${uid}`, txns => {
    allTxns = Object.entries(txns ?? {}).sort((a, b) => b[1].date.localeCompare(a[1].date));
    refresh();
  });

  document.getElementById('txn-search').addEventListener('input', refresh);
  document.getElementById('txn-cat-filter').addEventListener('change', refresh);
}

function renderList(entries, uid) {
  const el = document.getElementById('txn-list');
  if (!entries.length) {
    el.innerHTML = `<div class="empty"><span class="empty-icon">🔍</span><span>No transactions found.</span></div>`;
    return;
  }

  const rows = entries.map(([id, t]) => {
    const cat = getCategoryById(t.category);
    return `
      <div class="txn-row" data-id="${id}">
        <button class="txn-icon cat-btn" title="Change category" data-id="${id}" data-cat="${t.category}">${cat.icon}</button>
        <div class="txn-meta">
          <span class="txn-desc">${t.merchantName ?? t.description}</span>
          <span class="txn-date">${fmtDate(t.date)} · <span class="cat-tag" style="color:${cat.color}">${cat.name}</span></span>
        </div>
        <span class="txn-amount ${t.amount < 0 ? 'income' : ''}">${t.amount < 0 ? '−' : ''}${fmtCurrency(Math.abs(t.amount))}</span>
      </div>`;
  }).join('');

  el.innerHTML = `<div class="card-rows">${rows}</div>`;

  el.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => openCategoryPicker(btn.dataset.id, btn.dataset.cat, uid));
  });
}

function openCategoryPicker(txnId, currentCat, uid) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>Choose category</h3>
      <div class="cat-picker">
        ${CATEGORIES.filter(c => !c.parent).map(c => `
          <button class="cat-pick-btn ${c.id === currentCat ? 'active' : ''}" data-id="${c.id}" style="border-color:${c.color}">
            ${c.icon} ${c.name}
          </button>`).join('')}
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-rule" style="flex:1">+ Create Rule</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('.cat-pick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await dbUpdate(`transactions/${uid}/${txnId}`, { category: btn.dataset.id, categorySource: 'manual' });
      modal.remove();
    });
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-rule').addEventListener('click', () => { modal.remove(); /* TODO: open rule builder */ });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
