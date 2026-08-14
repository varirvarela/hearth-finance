import { dbListen, dbSet, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth } from '../shared/format.js';
import { CATEGORIES } from '../shared/categories.js';

export function renderBudgets(container) {
  const now = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth() + 1;

  container.innerHTML = `
    <div class="page budgets">
      <div class="budget-month-nav">
        <button id="budget-prev">&#8592;</button>
        <span id="budget-month-label">${fmtMonth(year, month)}</span>
        <button id="budget-next">&#8594;</button>
      </div>
      <div class="budget-summary" id="budget-summary"></div>
      <div id="budget-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let latestBudgets      = {};
  let latestOwnerTxns    = {};
  let latestPartnerTxns  = {};
  let latestTxns         = {};

  const refresh = () => renderBudgetList(uid, latestBudgets, latestTxns, year, month);

  const syncNextBtn = () => {
    const today = new Date();
    document.getElementById('budget-next').disabled =
      year === today.getFullYear() && month === today.getMonth() + 1;
  };

  syncNextBtn();

  dbListen(`budgets/${uid}`, snap => { latestBudgets = snap ?? {}; refresh(); });
  dbListen(`transactions/${uid}`, snap => {
    latestOwnerTxns = snap ?? {};
    latestTxns = { ...latestOwnerTxns, ...latestPartnerTxns };
    refresh();
  });

  getPartnerUid(uid).then(p => {
    if (p) {
      dbListen(`transactions/${p}`, snap => {
        latestPartnerTxns = snap ?? {};
        latestTxns = { ...latestOwnerTxns, ...latestPartnerTxns };
        refresh();
      });
    }
  });

  document.getElementById('budget-prev').addEventListener('click', () => {
    month--;
    if (month < 1) { month = 12; year--; }
    document.getElementById('budget-month-label').textContent = fmtMonth(year, month);
    syncNextBtn();
    refresh();
  });

  document.getElementById('budget-next').addEventListener('click', () => {
    month++;
    if (month > 12) { month = 1; year++; }
    document.getElementById('budget-month-label').textContent = fmtMonth(year, month);
    syncNextBtn();
    refresh();
  });
}

function renderBudgetList(uid, budgets, txns, year, month) {
  const listEl    = document.getElementById('budget-list');
  const summaryEl = document.getElementById('budget-summary');
  if (!listEl || !summaryEl) return;

  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const spentByCat = {};
  for (const t of Object.values(txns)) {
    if (t.amount > 0 && !t.ignored && !t.isTransfer && t.group !== 'transfer' && t.date?.startsWith(prefix)) {
      spentByCat[t.category] = (spentByCat[t.category] ?? 0) + t.amount;
    }
  }

  const expenseLeaves = CATEGORIES.filter(c => c.parent && !c.isIncome);

  const rootMap = new Map();
  for (const leaf of expenseLeaves) {
    if (!rootMap.has(leaf.parent)) rootMap.set(leaf.parent, []);
    rootMap.get(leaf.parent).push(leaf);
  }

  const rootCats = CATEGORIES.filter(c => !c.parent && !c.isIncome && c.id !== 'transfer' && rootMap.has(c.id));

  let totalBudgeted = 0;
  let totalSpent    = 0;
  for (const [catId, data] of Object.entries(budgets)) {
    if (data?.monthly > 0) {
      totalBudgeted += data.monthly;
      totalSpent    += spentByCat[catId] ?? 0;
    }
  }
  summaryEl.innerHTML = `
    <span>Budgeted: ${fmtCurrency(totalBudgeted)}</span>
    <span>Spent: ${fmtCurrency(totalSpent)}</span>
    <span>Remaining: ${fmtCurrency(totalBudgeted - totalSpent)}</span>
  `;

  let html = '';
  for (const root of rootCats) {
    const leaves  = rootMap.get(root.id) ?? [];
    const visible = leaves.filter(l => (budgets[l.id]?.monthly ?? 0) > 0 || (spentByCat[l.id] ?? 0) > 0);
    if (!visible.length) continue;

    html += `<div class="budget-group">
      <div class="budget-group-header" style="color:${root.color}">
        <span>${root.icon}</span><span>${root.name}</span>
      </div>`;

    for (const leaf of visible) {
      const spent    = spentByCat[leaf.id] ?? 0;
      const limit    = budgets[leaf.id]?.monthly ?? 0;
      const hasBudget = limit > 0;
      const pct      = hasBudget ? Math.min(100, (spent / limit) * 100) : 0;
      const barColor = pct >= 100 ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#16a34a';

      const badges = [
        leaf.isFixed  ? '<span class="budget-badge">Fixed</span>'  : '',
        leaf.isAnnual ? '<span class="budget-badge">Annual</span>' : '',
      ].join('');

      const limitCell = hasBudget
        ? `<span class="budget-limit" data-cat="${leaf.id}">${fmtCurrency(limit)}/mo</span>`
        : `<span class="set-budget-link" data-cat="${leaf.id}">Set budget</span>`;

      const bar = hasBudget
        ? `<div class="budget-bar-wrap"><div class="budget-bar-inner" style="width:${pct}%;background:${barColor}"></div></div>`
        : '<div class="budget-bar-wrap"></div>';

      html += `<div class="budget-leaf">
        <span>${leaf.icon}</span>
        <span class="budget-leaf-name">${leaf.name}</span>
        ${badges}
        <span class="budget-actual">${fmtCurrency(spent)}</span>
        ${limitCell}
        ${bar}
      </div>`;
    }

    html += '</div>';
  }

  if (!html) {
    listEl.innerHTML = '<p class="empty">No budgets set and no spending this month.</p>';
    return;
  }

  listEl.innerHTML = html;

  listEl.querySelectorAll('[data-cat]').forEach(el => {
    el.addEventListener('click', () =>
      openInlineEdit(el, uid, el.dataset.cat, budgets[el.dataset.cat]?.monthly ?? 0)
    );
  });
}

function openInlineEdit(el, uid, catId, currentVal) {
  const input = document.createElement('input');
  input.type      = 'number';
  input.className = 'budget-limit-input';
  input.value     = currentVal || '';
  input.min       = '0';
  input.step      = '1';
  el.replaceWith(input);
  input.focus();
  input.select();

  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    const next = document.createElement('span');
    if (currentVal > 0) {
      next.className   = 'budget-limit';
      next.textContent = `${fmtCurrency(currentVal)}/mo`;
    } else {
      next.className   = 'set-budget-link';
      next.textContent = 'Set budget';
    }
    next.dataset.cat = catId;
    input.replaceWith(next);
    next.addEventListener('click', () => openInlineEdit(next, uid, catId, currentVal));
  };

  const save = () => {
    if (cancelled) return;
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 0) {
      dbSet(`budgets/${uid}/${catId}`, { monthly: val });
    } else {
      cancel();
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}
