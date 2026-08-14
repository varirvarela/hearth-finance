import { dbListen, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth, fmtRelativeDate } from '../shared/format.js';
import { getCategoryById } from '../shared/categories.js';

export function renderDashboard(container) {
  const now      = new Date();
  const nowYear  = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  let selYear  = nowYear;
  let selMonth = nowMonth;
  let latestTxns      = null;
  let latestOwnerTxns  = null;
  let latestPartnerTxns = null;
  let latestAccounts  = null;
  let latestBudgets   = null;

  container.innerHTML = `
    <style>
      .dash-nav { display:flex; align-items:center; gap:8px; margin-bottom:16px; }
      .dash-nav-btn { background:none; border:1px solid var(--border,#e2e8f0); border-radius:6px; width:28px; height:28px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; color:var(--text,#0f172a); }
      .dash-nav-btn:disabled { opacity:0.35; cursor:default; }
    </style>
    <div class="page dashboard">
      <div class="dash-nav">
        <button class="dash-nav-btn" id="nav-prev">&#8592;</button>
        <h2 class="page-title" id="month-title" style="margin:0;flex:1;text-align:center;"></h2>
        <button class="dash-nav-btn" id="nav-next">&#8594;</button>
      </div>
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
          <span class="card-label">vs Budget</span>
          <span class="card-value" id="vs-budget">—</span>
        </div>
      </div>
      <section class="section">
        <h3>Top Categories</h3>
        <div id="top-categories"></div>
      </section>
      <section class="section">
        <h3>Spending Trend</h3>
        <div id="trend-chart"></div>
      </section>
      <section class="section">
        <h3>Recent Transactions</h3>
        <div id="recent-txns"></div>
      </section>
    </div>
  `;

  function updateNav() {
    container.querySelector('#month-title').textContent =
      fmtMonth(selYear, String(selMonth).padStart(2, '0'));
    container.querySelector('#nav-next').disabled =
      selYear === nowYear && selMonth === nowMonth;
  }

  function render() {
    if (!container.isConnected) return;

    const monthStr  = `${selYear}-${String(selMonth).padStart(2, '0')}`;
    const allTxns   = Object.values(latestTxns ?? {});
    const thisMonth = allTxns.filter(t => t.date?.startsWith(monthStr) && !t.ignored && !t.pending);
    const income    = thisMonth.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const spent     = thisMonth.filter(t => t.amount > 0 && !t.isTransfer && t.group !== 'transfer').reduce((s, t) => s + t.amount, 0);

    container.querySelector('#spent-month').textContent  = fmtCurrency(spent);
    container.querySelector('#income-month').textContent = fmtCurrency(income);

    const totalBudget = Object.values(latestBudgets ?? {}).reduce((s, b) => s + (b.monthly ?? 0), 0);
    const budgetDiff  = totalBudget - spent;
    const vsBudgetEl  = container.querySelector('#vs-budget');
    vsBudgetEl.textContent = fmtCurrency(Math.abs(budgetDiff));
    vsBudgetEl.style.color = budgetDiff >= 0 ? '#16a34a' : '#dc2626';

    renderTopCategories(container, thisMonth.filter(t => t.amount > 0));
    renderTrendChart(container, allTxns, selYear, selMonth);

    const recent = allTxns
      .filter(t => t.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
    renderRecentTxns(container, recent);
  }

  function navigate(delta) {
    let m = selMonth + delta;
    let y = selYear;
    if (m > 12) { m = 1;  y++; }
    if (m < 1)  { m = 12; y--; }
    selMonth = m;
    selYear  = y;
    updateNav();
    render();
  }

  container.querySelector('#nav-prev').addEventListener('click', () => navigate(-1));
  container.querySelector('#nav-next').addEventListener('click', () => navigate(1));
  updateNav();

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  dbListen(`transactions/${uid}`, txns => {
    latestOwnerTxns = txns;
    latestTxns = { ...(latestOwnerTxns ?? {}), ...(latestPartnerTxns ?? {}) };
    render();
  });

  getPartnerUid(uid).then(p => {
    if (p) {
      dbListen(`transactions/${p}`, partnerTxns => {
        latestPartnerTxns = partnerTxns;
        latestTxns = { ...(latestOwnerTxns ?? {}), ...(latestPartnerTxns ?? {}) };
        render();
      });
    }
  });

  dbListen(`accounts/${uid}`, accounts => {
    latestAccounts = accounts;
    if (!container.isConnected) return;
    const netWorth = Object.values(accounts ?? {}).reduce((s, a) => {
      return s + (a.currentBalance ?? 0) * (a.type === 'credit' ? -1 : 1);
    }, 0);
    container.querySelector('#net-worth').textContent = fmtCurrency(netWorth);
  });

  dbListen(`budgets/${uid}`, budgets => {
    latestBudgets = budgets;
    render();
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

function renderTrendChart(container, allTxns, selYear, selMonth) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = [];
  for (let i = 11; i >= 0; i--) {
    let m = selMonth - i;
    let y = selYear;
    while (m < 1) { m += 12; y--; }
    months.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` });
  }

  const totals = months.map(({ key }) =>
    allTxns
      .filter(t => t.date?.startsWith(key) && t.amount > 0 && !t.ignored && !t.isTransfer && t.group !== 'transfer')
      .reduce((s, t) => s + t.amount, 0)
  );

  const maxSpend   = Math.max(...totals, 0);
  const selKey     = `${selYear}-${String(selMonth).padStart(2, '0')}`;
  const tallestIdx = totals.indexOf(Math.max(...totals));
  const slotW      = 340 / 12;
  const barW       = 16;
  const maxBarH    = 61;
  const barBaseY   = 88;

  const bars = months.map(({ key, month }, i) => {
    const spend = totals[i];
    const barH  = maxSpend > 0 ? Math.max(2, (spend / maxSpend) * maxBarH) : 2;
    const x     = i * slotW + (slotW - barW) / 2;
    const y     = barBaseY - barH;
    const fill  = key === selKey ? '#15803d' : 'var(--brand,#16a34a)';
    const cx    = i * slotW + slotW / 2;

    const amtLabel = i === tallestIdx && maxSpend > 0
      ? `<text x="${cx.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="7" fill="var(--muted,#64748b)">${fmtCurrency(spend)}</text>`
      : '';

    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" rx="2" fill="${fill}"/>
      ${amtLabel}
      <text x="${cx.toFixed(1)}" y="98" text-anchor="middle" font-size="8" fill="var(--muted,#64748b)">${MONTHS[month - 1]}</text>`;
  }).join('');

  container.querySelector('#trend-chart').innerHTML =
    `<svg viewBox="0 0 340 100" width="100%" height="auto" style="display:block;overflow:visible;">${bars}</svg>`;
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
