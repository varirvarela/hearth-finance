import { dbListen, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth, fmtRelativeDate } from '../shared/format.js';
import { getCategoryById } from '../shared/categories.js';

export function renderDashboard(container) {
  const now      = new Date();
  const nowYear  = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  let selYear   = nowYear;
  let selMonth  = nowMonth;
  let viewMode  = 'monthly'; // 'monthly' | 'annual'

  let latestTxns        = null;
  let latestOwnerTxns   = null;
  let latestPartnerTxns = null;
  let latestAccounts    = null;
  let latestBudgets     = null;

  container.innerHTML = `
    <style>
      .dash-nav { display:flex; align-items:center; gap:8px; margin-bottom:16px; }
      .dash-nav-btn { background:none; border:1px solid var(--border,#e2e8f0); border-radius:6px; width:28px; height:28px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; color:var(--text,#0f172a); }
      .dash-nav-btn:disabled { opacity:0.35; cursor:default; }
    </style>
    <div class="page dashboard">
      <div class="view-toggle-row">
        <div class="view-toggle" id="view-toggle">
          <button class="view-toggle-btn active" data-mode="monthly">Monthly</button>
          <button class="view-toggle-btn" data-mode="annual">Annual</button>
        </div>
      </div>
      <div class="dash-nav">
        <button class="dash-nav-btn" id="nav-prev">&#8592;</button>
        <h2 class="page-title" id="period-title" style="margin:0;flex:1;text-align:center;"></h2>
        <button class="dash-nav-btn" id="nav-next">&#8594;</button>
      </div>
      <div class="card-grid">
        <div class="card" id="net-worth-card">
          <span class="card-label">Net Worth</span>
          <span class="card-value" id="net-worth">—</span>
        </div>
        <div class="card">
          <span class="card-label" id="spent-label">Spent This Month</span>
          <span class="card-value" id="spent-month">—</span>
        </div>
        <div class="card">
          <span class="card-label" id="income-label">Income This Month</span>
          <span class="card-value" id="income-month">—</span>
        </div>
        <div class="card">
          <span class="card-label" id="vs-label">vs Budget</span>
          <span class="card-value" id="vs-budget">—</span>
        </div>
      </div>
      <section class="section">
        <h3 id="top-cats-title">Top Categories</h3>
        <div id="top-categories"></div>
      </section>
      <section class="section" id="pace-section" style="display:none">
        <h3>Annual Pace</h3>
        <div id="pace-bar-wrap" class="pace-bar-wrap"></div>
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

  const toggleEl    = container.querySelector('#view-toggle');
  const prevBtn     = container.querySelector('#nav-prev');
  const nextBtn     = container.querySelector('#nav-next');
  const titleEl     = container.querySelector('#period-title');
  const spentLabel  = container.querySelector('#spent-label');
  const incomeLabel = container.querySelector('#income-label');
  const vsLabel     = container.querySelector('#vs-label');
  const paceSection = container.querySelector('#pace-section');

  function updateNav() {
    if (viewMode === 'monthly') {
      titleEl.textContent = fmtMonth(selYear, String(selMonth).padStart(2, '0'));
      nextBtn.disabled = selYear === nowYear && selMonth === nowMonth;
    } else {
      titleEl.textContent = String(selYear);
      nextBtn.disabled = selYear >= nowYear;
    }
  }

  function render() {
    if (!container.isConnected) return;
    if (viewMode === 'monthly') renderMonthly();
    else renderAnnual();
  }

  function renderMonthly() {
    spentLabel.textContent  = 'Spent This Month';
    incomeLabel.textContent = 'Income This Month';
    vsLabel.textContent     = 'vs Budget';
    paceSection.style.display = 'none';
    container.querySelector('#top-cats-title').textContent = 'Top Categories';

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

    renderTopCategories(container, thisMonth.filter(t => t.amount > 0 && !t.isTransfer && t.group !== 'transfer'));
    renderTrendChart(container, allTxns, selYear, selMonth, 'monthly');

    const recent = allTxns
      .filter(t => t.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
    renderRecentTxns(container, recent);
  }

  function renderAnnual() {
    spentLabel.textContent  = 'Spent YTD';
    incomeLabel.textContent = 'Income YTD';
    vsLabel.textContent     = 'vs Annual Budget';
    container.querySelector('#top-cats-title').textContent = 'Top Categories (Year)';

    const allTxns  = Object.values(latestTxns ?? {});
    const yearStr  = String(selYear);

    // For current year: include all months up to today; for past years: full year
    const maxMonth = selYear === nowYear ? nowMonth : 12;
    const yearTxns = allTxns.filter(t => {
      if (!t.date?.startsWith(yearStr) || t.ignored || t.pending) return false;
      const m = parseInt(t.date.slice(5, 7), 10);
      return m <= maxMonth;
    });

    const income = yearTxns.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const spent  = yearTxns.filter(t => t.amount > 0 && !t.isTransfer && t.group !== 'transfer').reduce((s, t) => s + t.amount, 0);

    container.querySelector('#spent-month').textContent  = fmtCurrency(spent);
    container.querySelector('#income-month').textContent = fmtCurrency(income);

    // Annual budget = sum of monthly * 12
    const annualBudget = Object.values(latestBudgets ?? {}).reduce((s, b) => s + (b.monthly ?? 0), 0) * 12;
    const budgetDiff   = annualBudget - spent;
    const vsBudgetEl   = container.querySelector('#vs-budget');
    vsBudgetEl.textContent = fmtCurrency(Math.abs(budgetDiff));
    vsBudgetEl.style.color = budgetDiff >= 0 ? '#16a34a' : '#dc2626';

    // Pace bar (only for current year)
    if (selYear === nowYear && annualBudget > 0) {
      paceSection.style.display = '';
      const pace    = Math.round((nowMonth / 12) * 100);
      const spentPct = Math.round((spent / annualBudget) * 100);
      const barColor = spentPct > pace + 10 ? '#dc2626' : spentPct > pace ? '#f59e0b' : '#16a34a';
      container.querySelector('#pace-bar-wrap').innerHTML = `
        <div class="pace-labels">
          <span>${fmtCurrency(spent)} spent</span>
          <span style="color:var(--muted)">${pace}% of year elapsed</span>
          <span>${fmtCurrency(annualBudget)} budget</span>
        </div>
        <div class="pace-track">
          <div class="pace-fill" style="width:${Math.min(100, spentPct)}%;background:${barColor}"></div>
          <div class="pace-tick" style="left:${pace}%"></div>
        </div>
        <div class="pace-pct-label" style="color:${barColor}">${spentPct}% of annual budget used</div>
      `;
    } else {
      paceSection.style.display = 'none';
    }

    renderTopCategories(container, yearTxns.filter(t => t.amount > 0 && !t.isTransfer && t.group !== 'transfer'));
    renderTrendChart(container, allTxns, selYear, selMonth, 'annual');

    const recent = allTxns
      .filter(t => t.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
    renderRecentTxns(container, recent);
  }

  function navigate(delta) {
    if (viewMode === 'monthly') {
      let m = selMonth + delta;
      let y = selYear;
      if (m > 12) { m = 1;  y++; }
      if (m < 1)  { m = 12; y--; }
      selMonth = m;
      selYear  = y;
    } else {
      selYear = Math.min(nowYear, selYear + delta);
    }
    updateNav();
    render();
  }

  // View toggle
  toggleEl.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      toggleEl.querySelectorAll('.view-toggle-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === viewMode)
      );
      // Reset to current period when switching
      selYear  = nowYear;
      selMonth = nowMonth;
      updateNav();
      render();
    });
  });

  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(1));
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

function renderTrendChart(container, allTxns, selYear, selMonth, viewMode) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let months;
  if (viewMode === 'annual') {
    // Show all 12 months of the selected year
    months = Array.from({ length: 12 }, (_, i) => ({
      year: selYear,
      month: i + 1,
      key: `${selYear}-${String(i + 1).padStart(2, '0')}`,
    }));
  } else {
    // Last 12 months ending at selMonth
    months = [];
    for (let i = 11; i >= 0; i--) {
      let m = selMonth - i;
      let y = selYear;
      while (m < 1) { m += 12; y--; }
      months.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` });
    }
  }

  const totals = months.map(({ key }) =>
    allTxns
      .filter(t => t.date?.startsWith(key) && t.amount > 0 && !t.ignored && !t.isTransfer && t.group !== 'transfer')
      .reduce((s, t) => s + t.amount, 0)
  );

  const maxSpend   = Math.max(...totals, 0);
  const selKey     = viewMode === 'annual'
    ? `${selYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    : `${selYear}-${String(selMonth).padStart(2, '0')}`;
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
