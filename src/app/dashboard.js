import { dbListen, auth } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth, fmtRelativeDate } from '../shared/format.js';
import { getCategoryById } from '../shared/categories.js';

export function renderDashboard(container) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  container.innerHTML = `
    <div class="page dashboard">
      <h2 class="page-title">${fmtMonth(year, month)}</h2>
      <div class="card-grid">
        <div class="card" id="net-worth-card">
          <span class="card-label">Net Worth</span>
          <span class="card-value" id="net-worth">—</span>
        </div>
        <div class="card">
          <span class="card-label">Spent This Month</span>
          <span class="card-value" id="spent-month">—</span>
        </div>
        <div class="card">
          <span class="card-label">Income This Month</span>
          <span class="card-value" id="income-month">—</span>
        </div>
        <div class="card">
          <span class="card-label">Left to Spend</span>
          <span class="card-value" id="left-to-spend">—</span>
        </div>
      </div>
      <section class="section">
        <h3>Top Categories</h3>
        <div id="top-categories"></div>
      </section>
      <section class="section">
        <h3>Recent Transactions</h3>
        <div id="recent-txns"></div>
      </section>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  dbListen(`transactions/${uid}`, txns => {
    if (!container.isConnected) return;
    const monthStr = `${year}-${month}`;
    const thisMonth = Object.values(txns ?? {}).filter(t => t.date?.startsWith(monthStr) && !t.ignored && !t.pending);
    const income  = thisMonth.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const spent   = thisMonth.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

    container.querySelector('#spent-month').textContent   = fmtCurrency(spent);
    container.querySelector('#income-month').textContent  = fmtCurrency(income);
    container.querySelector('#left-to-spend').textContent = fmtCurrency(Math.max(0, income - spent));

    renderTopCategories(container, thisMonth.filter(t => t.amount > 0));
    renderRecentTxns(container, Object.values(txns ?? {}).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10));
  });

  dbListen(`accounts/${uid}`, accounts => {
    if (!container.isConnected) return;
    const netWorth = Object.values(accounts ?? {}).reduce((s, a) => {
      return s + (a.currentBalance ?? 0) * (a.type === 'credit' ? -1 : 1);
    }, 0);
    container.querySelector('#net-worth').textContent = fmtCurrency(netWorth);
  });
}

function renderTopCategories(container, txns) {
  const totals = {};
  for (const t of txns) {
    totals[t.category] = (totals[t.category] ?? 0) + t.amount;
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = sorted[0]?.[1] ?? 1;

  const rows = sorted.map(([id, amt]) => {
    const cat = getCategoryById(id);
    const pct = Math.round((amt / max) * 100);
    return `
      <div class="category-row">
        <span class="cat-icon">${cat.icon}</span>
        <div class="cat-bar-wrap">
          <span class="cat-name">${cat.name}</span>
          <div class="cat-bar"><div class="cat-bar-fill" style="width:${pct}%;background:${cat.color}"></div></div>
        </div>
        <span class="cat-amount">${fmtCurrency(amt)}</span>
      </div>`;
  }).join('');
  container.querySelector('#top-categories').innerHTML =
    rows ? `<div class="card-rows">${rows}</div>` :
    `<div class="empty"><span class="empty-icon">📊</span><span>No spending data yet.</span></div>`;
}

function renderRecentTxns(container, txns) {
  if (!txns.length) {
    container.querySelector('#recent-txns').innerHTML =
      `<div class="empty"><span class="empty-icon">💳</span><span>No transactions yet.<br>Link an account to get started.</span></div>`;
    return;
  }
  const rows = txns.map(t => {
    const cat = getCategoryById(t.category);
    return `
      <div class="txn-row">
        <span class="txn-icon">${cat.icon}</span>
        <div class="txn-meta">
          <span class="txn-desc">${t.merchantName ?? t.description}</span>
          <span class="txn-date">${fmtRelativeDate(t.date)}</span>
        </div>
        <span class="txn-amount ${t.amount < 0 ? 'income' : ''}">${t.amount < 0 ? '−' : ''}${fmtCurrency(Math.abs(t.amount))}</span>
      </div>`;
  }).join('');
  container.querySelector('#recent-txns').innerHTML = `<div class="card-rows">${rows}</div>`;
}
