import { dbGet, dbSet, dbListen, auth } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth } from '../shared/format.js';
import { getRootCategories, getCategoryById } from '../shared/categories.js';

export function renderBudgets(container) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  container.innerHTML = `
    <div class="page budgets">
      <div class="period-toggle">
        <button class="active" data-period="monthly">Monthly</button>
        <button data-period="annual">Annual</button>
      </div>
      <div id="budget-period-label" class="page-title">${fmtMonth(year, month)}</div>
      <div id="budget-list"></div>
      <button class="btn-primary" id="add-budget" style="margin-top:1rem">+ Add Budget</button>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let period = 'monthly';

  const render = () => {
    const budgetPath = period === 'monthly'
      ? `budgets/${uid}/${year}/monthly/${month}`
      : `budgets/${uid}/${year}/annual`;
    const txnPath = `transactions/${uid}`;

    Promise.all([dbGet(budgetPath), dbGet(txnPath)]).then(([budgets, txns]) => {
      renderBudgetList(budgets ?? {}, txns ?? {}, period, year, month);
    });
  };

  document.querySelectorAll('.period-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      period = btn.dataset.period;
      document.getElementById('budget-period-label').textContent =
        period === 'monthly' ? fmtMonth(year, month) : String(year);
      render();
    });
  });

  document.getElementById('add-budget').addEventListener('click', () => openBudgetEditor(uid, period, year, month, render));
  render();
}

function renderBudgetList(budgets, txns, period, year, month) {
  const el = document.getElementById('budget-list');
  const entries = Object.entries(budgets);
  if (!entries.length) { el.innerHTML = '<p class="empty">No budgets set. Tap + Add Budget to start.</p>'; return; }

  const monthStr = `${year}-${month}`;
  const txnArr   = Object.values(txns).filter(t => !t.ignored && !t.pending && t.amount > 0);

  const spentByCategory = {};
  for (const t of txnArr) {
    if (period === 'monthly' && !t.date?.startsWith(monthStr)) continue;
    if (period === 'annual'  && !t.date?.startsWith(String(year))) continue;
    spentByCategory[t.category] = (spentByCategory[t.category] ?? 0) + t.amount;
  }

  el.innerHTML = entries.map(([catId, { limit }]) => {
    const cat   = getCategoryById(catId);
    const spent = spentByCategory[catId] ?? 0;
    const pct   = Math.min(100, Math.round((spent / limit) * 100));
    const color = pct >= 100 ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#16a34a';
    return `
      <div class="budget-row">
        <div class="budget-header">
          <span>${cat.icon} ${cat.name}</span>
          <span>${fmtCurrency(spent)} / ${fmtCurrency(limit)}</span>
        </div>
        <div class="budget-bar">
          <div class="budget-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="budget-footer">
          <span style="color:${color}">${pct}% used</span>
          <span>${fmtCurrency(Math.max(0, limit - spent))} remaining</span>
        </div>
      </div>`;
  }).join('');
}

function openBudgetEditor(uid, period, year, month, onSave) {
  const cats = getRootCategories().filter(c => !c.isIncome);
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>Add Budget</h3>
      <select id="budget-cat">
        ${cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
      </select>
      <input type="number" id="budget-limit" placeholder="Monthly limit ($)" min="1" step="1" />
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-save" style="flex:1">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.modal-save').addEventListener('click', async () => {
    const catId = modal.querySelector('#budget-cat').value;
    const limit = Number(modal.querySelector('#budget-limit').value);
    if (!limit || limit <= 0) return;
    const path = period === 'monthly'
      ? `budgets/${uid}/${year}/monthly/${month}/${catId}`
      : `budgets/${uid}/${year}/annual/${catId}`;
    await dbSet(path, { limit });
    modal.remove();
    onSave();
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
