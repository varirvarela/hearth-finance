import { dbListen, auth, getPartnerUid, getHouseholdId } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth, fmtRelativeDate } from '../shared/format.js';
import { getCategoryById, CATEGORIES } from '../shared/categories.js';
import { needsReview } from '../shared/filter-utils.js';

export function renderDashboard(container) {
  const now      = new Date();
  const nowYear  = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const nowDay   = now.getDate();

  let selYear   = nowYear;
  let selMonth  = nowMonth;
  let viewMode  = 'monthly';

  let latestTxns        = null;
  let latestOwnerTxns   = null;
  let latestPartnerTxns = null;
  let latestAccounts    = null;
  let latestBudgets     = null;

  container.innerHTML = `
    <div class="page dashboard" style="padding:0">
      <div class="dash-period-bar">
        <div class="dash-view-toggle" id="dash-view-toggle">
          <button class="dash-toggle-btn active" data-mode="monthly">Monthly</button>
          <button class="dash-toggle-btn" data-mode="annual">Annual</button>
        </div>
        <div class="dash-period-nav">
          <button class="dash-nav-btn" id="nav-prev">&#8249;</button>
          <span class="dash-period-label" id="period-title"></span>
          <button class="dash-nav-btn" id="nav-next">&#8250;</button>
        </div>
      </div>

      <div class="dash-content">
        <div class="dash-net-worth-hero">
          <div class="dash-hero-label">Net Worth</div>
          <div class="dash-hero-value" id="net-worth">—</div>
          <div class="dash-hero-sub" id="net-worth-sub"></div>
        </div>

        <div class="dash-mini-grid">
          <div class="dash-mini-card">
            <div class="dash-mini-label" id="spent-label">Spent</div>
            <div class="dash-mini-value" id="spent-val">—</div>
            <div class="dash-mini-sub" id="spent-sub"></div>
          </div>
          <div class="dash-mini-card">
            <div class="dash-mini-label">vs Budget</div>
            <div class="dash-mini-value" id="vs-budget-val">—</div>
            <div class="dash-mini-sub" id="vs-budget-sub"></div>
          </div>
          <div class="dash-mini-card">
            <div class="dash-mini-label" id="vs-prev-label">vs Last Year</div>
            <div class="dash-mini-value" id="vs-prev-val">—</div>
            <div class="dash-mini-sub" id="vs-prev-sub"></div>
          </div>
        </div>

        <div class="dash-alert-banner" id="dash-alert" style="display:none"></div>

        <div class="dash-section-card" id="spend-section">
          <div class="dash-section-label" id="spend-section-label">Spend vs Budget</div>
          <div id="spend-bars"></div>
        </div>

        <div id="dash-review-cta" style="display:none">
          <button class="dash-review-btn" id="goto-review">Review transactions →</button>
        </div>

        <div class="dash-section-card" id="pace-annual-section" style="display:none">
          <div class="dash-section-label">Annual Pace</div>
          <div id="pace-bar-annual"></div>
        </div>

        <div class="dash-section-card">
          <div class="dash-section-label">Spending Trend</div>
          <div id="trend-chart"></div>
        </div>

        <div class="dash-section-card">
          <div class="dash-section-label">Recent Transactions</div>
          <div id="recent-txns"></div>
        </div>
      </div>
    </div>
  `;

  // Wire view toggle
  const toggleEl = container.querySelector('#dash-view-toggle');
  toggleEl.querySelectorAll('.dash-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      toggleEl.querySelectorAll('.dash-toggle-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === viewMode)
      );
      selYear  = nowYear;
      selMonth = nowMonth;
      updateNav();
      render();
    });
  });

  container.querySelector('#nav-prev').addEventListener('click', () => navigate(-1));
  container.querySelector('#nav-next').addEventListener('click', () => navigate(1));

  container.querySelector('#goto-review').addEventListener('click', () => {
    location.hash = 'transactions';
  });

  function updateNav() {
    const titleEl = container.querySelector('#period-title');
    const nextBtn = container.querySelector('#nav-next');
    if (viewMode === 'monthly') {
      titleEl.textContent = fmtMonth(selYear, String(selMonth).padStart(2, '0'));
      nextBtn.disabled = selYear === nowYear && selMonth === nowMonth;
    } else {
      titleEl.textContent = `${selYear} · Annual`;
      nextBtn.disabled = selYear >= nowYear;
    }
  }

  function navigate(delta) {
    if (viewMode === 'monthly') {
      let m = selMonth + delta, y = selYear;
      if (m > 12) { m = 1; y++; }
      if (m < 1)  { m = 12; y--; }
      selMonth = m; selYear = y;
    } else {
      selYear = Math.min(nowYear, selYear + delta);
    }
    updateNav();
    render();
  }

  updateNav();

  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const hid = getHouseholdId();

  dbListen(`transactions/${hid}`, txns => {
    latestOwnerTxns = txns;
    latestTxns = { ...(latestOwnerTxns ?? {}), ...(latestPartnerTxns ?? {}) };
    render();
  });
  if (hid === uid) {
    getPartnerUid(uid).then(p => {
      if (p) {
        dbListen(`transactions/${p}`, pt => {
          latestPartnerTxns = pt;
          latestTxns = { ...(latestOwnerTxns ?? {}), ...(latestPartnerTxns ?? {}) };
          render();
        });
      }
    });
  }
  dbListen(`accounts/${hid}`, accounts => {
    latestAccounts = accounts;
    const netWorthEl = container.querySelector('#net-worth');
    if (!netWorthEl) return;
    const assets  = Object.values(accounts ?? {}).filter(a => a.type !== 'credit').reduce((s, a) => s + (a.currentBalance ?? 0), 0);
    const debt    = Object.values(accounts ?? {}).filter(a => a.type === 'credit').reduce((s, a) => s + Math.abs(a.currentBalance ?? 0), 0);
    const net     = assets - debt;
    netWorthEl.textContent = fmtCurrency(net);
    container.querySelector('#net-worth-sub').textContent = `${fmtCurrency(assets)} assets · ${fmtCurrency(debt)} debt`;
  });
  dbListen(`budgets/${hid}`, budgets => {
    latestBudgets = budgets;
    render();
  });

  function render() {
    if (!container.querySelector('#spent-label')) return;
    if (viewMode === 'monthly') renderMonthly();
    else renderAnnual();
  }

  // ── Monthly view ──────────────────────────────────────────
  function renderMonthly() {
    const allTxns   = Object.values(latestTxns ?? {});
    const monthStr  = `${selYear}-${String(selMonth).padStart(2, '0')}`;
    const thisMonth = allTxns.filter(t => t.date?.startsWith(monthStr) && !t.ignored && !t.pending);
    const expenses  = thisMonth.filter(t => t.amount > 0 && !t.isTransfer && t.group !== 'transfer');
    const income    = thisMonth.filter(t => t.amount < 0);
    const spent     = expenses.reduce((s, t) => s + t.amount, 0);
    const incomeAmt = income.reduce((s, t) => s - t.amount, 0);

    // vs budget
    const totalBudget = Object.values(latestBudgets ?? {}).reduce((s, b) => s + (b.monthly ?? 0), 0);
    const budgetDiff  = totalBudget - spent;
    const budgetPct   = totalBudget > 0 ? Math.round(Math.abs(budgetDiff) / totalBudget * 100) : 0;

    // vs same month last year
    const prevMonthStr = `${selYear - 1}-${String(selMonth).padStart(2, '0')}`;
    const prevSpent    = allTxns
      .filter(t => t.date?.startsWith(prevMonthStr) && t.amount > 0 && !t.isTransfer && t.group !== 'transfer' && !t.ignored)
      .reduce((s, t) => s + t.amount, 0);
    const prevDiff  = prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;

    // pace tick: day / days in month
    const daysInMonth = new Date(selYear, selMonth, 0).getDate();
    const paceDay     = selYear === nowYear && selMonth === nowMonth ? nowDay : daysInMonth;
    const pacePct     = Math.round((paceDay / daysInMonth) * 100);

    // review count
    const reviewCount = thisMonth.filter(t => needsReview(t)).length;

    // update labels
    container.querySelector('#spent-label').textContent  = 'Spent';
    container.querySelector('#vs-prev-label').textContent = 'vs Last Year';
    container.querySelector('#spent-val').textContent    = fmtCurrency(spent);
    container.querySelector('#spent-sub').textContent    = `of ${fmtCurrency(totalBudget)} budget`;

    const vsBudgetEl  = container.querySelector('#vs-budget-val');
    const vsBudgetSub = container.querySelector('#vs-budget-sub');
    if (totalBudget > 0) {
      const over = budgetDiff < 0;
      vsBudgetEl.textContent  = `${over ? '+' : '−'}${budgetPct}%`;
      vsBudgetEl.style.color  = over ? 'var(--red,#ef4444)' : '#16a34a';
      vsBudgetSub.textContent = over ? 'over budget' : 'under budget';
    } else {
      vsBudgetEl.textContent  = '—';
      vsBudgetEl.style.color  = '';
      vsBudgetSub.textContent = 'no budget set';
    }

    const vsPrevEl  = container.querySelector('#vs-prev-val');
    const vsPrevSub = container.querySelector('#vs-prev-sub');
    if (prevDiff !== null) {
      const better = prevDiff < 0;
      vsPrevEl.textContent  = `${prevDiff > 0 ? '+' : ''}${prevDiff}%`;
      vsPrevEl.style.color  = better ? '#16a34a' : 'var(--red,#ef4444)';
      vsPrevSub.textContent = better ? 'better ✓' : 'higher spend';
    } else {
      vsPrevEl.textContent  = '—';
      vsPrevEl.style.color  = '';
      vsPrevSub.textContent = 'no prior data';
    }

    // alert banner
    renderAlert(container, spent, totalBudget, pacePct, reviewCount, allTxns, monthStr, latestBudgets);

    // restore spend-section visibility (may have been hidden by renderAnnual)
    container.querySelector('#spend-section').style.display = '';
    container.querySelector('#pace-annual-section').style.display = 'none';

    // spend vs budget bars
    container.querySelector('#spend-section-label').textContent =
      `Spend vs Budget — Day ${paceDay} of ${daysInMonth} · ${pacePct}% pace`;
    renderSpendBars(container, expenses, latestBudgets ?? {}, pacePct, selYear, selMonth);

    // review CTA
    const ctaEl = container.querySelector('#dash-review-cta');
    ctaEl.style.display = reviewCount > 0 ? '' : 'none';
    if (reviewCount > 0) {
      container.querySelector('#goto-review').textContent = `Review ${reviewCount} transaction${reviewCount !== 1 ? 's' : ''} →`;
    }

    container.querySelector('#pace-annual-section').style.display = 'none';
    renderTrendChart(container, allTxns, selYear, selMonth, 'monthly');
    renderRecentTxns(container, allTxns);
  }

  // ── Annual view ───────────────────────────────────────────
  function renderAnnual() {
    const allTxns  = Object.values(latestTxns ?? {});
    const yearStr  = String(selYear);
    const maxMonth = selYear === nowYear ? nowMonth : 12;
    const pacePct  = selYear === nowYear ? Math.round((nowMonth / 12) * 100) : 100;

    const yearTxns = allTxns.filter(t => {
      if (!t.date?.startsWith(yearStr) || t.ignored || t.pending) return false;
      return parseInt(t.date.slice(5, 7), 10) <= maxMonth;
    });
    const expenses    = yearTxns.filter(t => t.amount > 0 && !t.isTransfer && t.group !== 'transfer');
    const spent       = expenses.reduce((s, t) => s + t.amount, 0);
    const incomeAmt   = yearTxns.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const annualBudget = Object.values(latestBudgets ?? {}).reduce((s, b) => s + (b.monthly ?? 0), 0) * 12;
    const spentPct     = annualBudget > 0 ? Math.round((spent / annualBudget) * 100) : 0;

    // vs prior year
    const prevYearStr  = String(selYear - 1);
    const prevSpent    = allTxns
      .filter(t => t.date?.startsWith(prevYearStr) && t.amount > 0 && !t.isTransfer && t.group !== 'transfer' && !t.ignored)
      .reduce((s, t) => s + t.amount, 0);
    const prevDiff = prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;

    container.querySelector('#spent-label').textContent   = 'Spent YTD';
    container.querySelector('#vs-prev-label').textContent = 'vs Last Year';
    container.querySelector('#spent-val').textContent     = fmtCurrency(spent);
    container.querySelector('#spent-sub').textContent     = `of ${fmtCurrency(annualBudget)} budget`;

    const barColor = spentPct > pacePct + 10 ? 'var(--red,#ef4444)' : spentPct > pacePct ? 'var(--amber,#f59e0b)' : '#16a34a';
    const vsBudgetEl  = container.querySelector('#vs-budget-val');
    const vsBudgetSub = container.querySelector('#vs-budget-sub');
    vsBudgetEl.textContent  = `${spentPct}%`;
    vsBudgetEl.style.color  = barColor;
    vsBudgetSub.textContent = spentPct > pacePct + 10 ? 'over annual pace' : spentPct > pacePct ? 'slightly over' : 'on pace ✓';

    const vsPrevEl  = container.querySelector('#vs-prev-val');
    const vsPrevSub = container.querySelector('#vs-prev-sub');
    if (prevDiff !== null) {
      const better = prevDiff < 0;
      vsPrevEl.textContent  = `${prevDiff > 0 ? '+' : ''}${prevDiff}%`;
      vsPrevEl.style.color  = better ? '#16a34a' : 'var(--red,#ef4444)';
      vsPrevSub.textContent = better ? 'better ✓' : 'higher spend';
    } else {
      vsPrevEl.textContent = '—'; vsPrevEl.style.color = ''; vsPrevSub.textContent = 'no prior data';
    }

    // hide alert and bars for annual — show pace bar instead
    container.querySelector('#dash-alert').style.display = 'none';
    container.querySelector('#spend-section').style.display = 'none';
    container.querySelector('#dash-review-cta').style.display = 'none';

    const paceSection = container.querySelector('#pace-annual-section');
    if (annualBudget > 0) {
      paceSection.style.display = '';
      container.querySelector('#pace-bar-annual').innerHTML = `
        <div class="pace-labels">
          <span>${fmtCurrency(spent)} YTD</span>
          <span style="color:var(--muted)">${pacePct}% of year elapsed</span>
          <span>${fmtCurrency(annualBudget)} annual budget</span>
        </div>
        <div class="pace-track">
          <div class="pace-fill" style="width:${Math.min(100, spentPct)}%;background:${barColor}"></div>
          <div class="pace-tick" style="left:${pacePct}%"></div>
        </div>
        <div class="pace-pct-label" style="color:${barColor}">${spentPct}% of annual budget used</div>
      `;
    } else {
      paceSection.style.display = 'none';
    }

    renderTrendChart(container, allTxns, selYear, selMonth, 'annual');
    renderRecentTxns(container, allTxns);
  }
}

// ── Alert banner ──────────────────────────────────────────
function renderAlert(container, spent, totalBudget, pacePct, reviewCount, allTxns, monthStr, budgets) {
  const alertEl = container.querySelector('#dash-alert');
  if (!alertEl) return;

  const spentByCat = {};
  for (const t of allTxns) {
    if (t.date?.startsWith(monthStr) && t.amount > 0 && !t.isTransfer && t.group !== 'transfer' && !t.ignored) {
      spentByCat[t.category] = (spentByCat[t.category] ?? 0) + t.amount;
    }
  }

  let overCount = 0;
  let onPaceOverCount = 0;
  for (const [catId, data] of Object.entries(budgets ?? {})) {
    const limit = data?.monthly ?? 0;
    if (!limit) continue;
    const catSpent = spentByCat[catId] ?? 0;
    const pct = catSpent / limit * 100;
    if (pct >= 100) overCount++;
    else if (pct >= pacePct + 15) onPaceOverCount++;
  }

  const parts = [];
  if (overCount > 0) parts.push(`${overCount} categor${overCount !== 1 ? 'ies' : 'y'} over budget`);
  if (onPaceOverCount > 0) parts.push(`${onPaceOverCount} on pace to overspend`);
  if (reviewCount > 0) parts.push(`${reviewCount} to review`);

  if (parts.length) {
    alertEl.style.display = '';
    alertEl.innerHTML = `⚠ ${parts.join(' · ')}`;
  } else {
    alertEl.style.display = 'none';
  }
}

// ── Category spend-vs-budget bars ────────────────────────
function renderSpendBars(container, expenses, budgets, pacePct, selYear, selMonth) {
  const barsEl = container.querySelector('#spend-bars');
  if (!barsEl) return;

  const spentByCat = {};
  for (const t of expenses) {
    spentByCat[t.category] = (spentByCat[t.category] ?? 0) + t.amount;
  }

  // All categories that have a budget OR have spending this month
  const rows = [];
  const seen = new Set();
  const leaves = CATEGORIES.filter(c => c.parent && !c.isIncome);

  for (const leaf of leaves) {
    const limit = budgets[leaf.id]?.monthly ?? 0;
    const catSpent = spentByCat[leaf.id] ?? 0;
    if (!limit && !catSpent) continue;
    if (leaf.isAnnual) continue; // annual cats excluded from monthly pace
    seen.add(leaf.id);
    rows.push({ cat: leaf, spent: catSpent, limit });
  }

  // Also include any spending in categories without budgets
  for (const [catId, amt] of Object.entries(spentByCat)) {
    if (seen.has(catId)) continue;
    const cat = getCategoryById(catId);
    if (cat.isIncome || cat.id === 'transfer' || cat.isAnnual) continue;
    rows.push({ cat, spent: amt, limit: 0 });
  }

  // Sort: over budget first, then by spending amount
  rows.sort((a, b) => {
    const aOver = a.limit > 0 && a.spent > a.limit ? 1 : 0;
    const bOver = b.limit > 0 && b.spent > b.limit ? 1 : 0;
    return bOver - aOver || b.spent - a.spent;
  });

  const maxRows = 7;
  const displayRows = rows.slice(0, maxRows);

  if (!displayRows.length) {
    barsEl.innerHTML = `<div class="empty-sm">No spending this period.</div>`;
    return;
  }

  const html = displayRows.map(({ cat, spent, limit }) => {
    const hasBudget = limit > 0;
    const pct       = hasBudget ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
    const barColor  = !hasBudget ? '#94a3b8'
      : pct >= 100       ? '#ef4444'
      : pct >= pacePct + 15 ? '#f59e0b'
      : '#16a34a';

    const amtColor  = !hasBudget ? 'var(--muted)'
      : pct >= 100       ? '#ef4444'
      : pct >= pacePct + 15 ? '#b45309'
      : pct >= 80        ? '#b45309'
      : 'var(--brand,#16a34a)';

    const tick = hasBudget ? `<div class="prog-pace" style="left:${pacePct}%"></div>` : '';
    const footerText = !hasBudget
      ? 'no budget set'
      : pct >= 100
        ? `${pct}% — ${fmtCurrency(spent - limit)} over`
        : pct >= pacePct + 15
          ? `${pct}% · on pace to overspend`
          : cat.isFixed
            ? 'Fixed — paid ✓'
            : `${pct}% · ${pct <= pacePct ? 'on track' : 'under pace ✓'}`;

    return `
      <div class="prog-row" data-cat="${cat.id}" title="Tap to see ${cat.name} transactions">
        <div class="prog-row-top">
          <span class="prog-icon">${cat.icon}</span>
          <span class="prog-name">${cat.name}</span>
          <span class="prog-amt" style="color:${amtColor}">${fmtCurrency(spent)}${hasBudget ? ' / ' + fmtCurrency(limit) : ''}</span>
        </div>
        <div class="prog-track">
          <div class="prog-fill" style="width:${hasBudget ? pct : 0}%;background:${barColor}"></div>
          ${tick}
        </div>
        <div class="prog-footer" style="color:${amtColor}">${footerText}</div>
      </div>`;
  }).join('');

  const moreCount = rows.length - maxRows;
  barsEl.innerHTML = html + (moreCount > 0
    ? `<div class="prog-more">+${moreCount} more categories</div>`
    : '');

  // Category drill-down: tap row → Transactions filtered to that category + month
  barsEl.querySelectorAll('.prog-row[data-cat]').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      sessionStorage.setItem('txn-filter-intent', JSON.stringify({
        catId: row.dataset.cat,
        year:  selYear,
        month: selMonth,
      }));
      location.hash = 'transactions';
    });
  });
}

// ── Trend chart ───────────────────────────────────────────
function renderTrendChart(container, allTxns, selYear, selMonth, viewMode) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let months;
  if (viewMode === 'annual') {
    months = Array.from({ length: 12 }, (_, i) => ({
      year: selYear, month: i + 1,
      key: `${selYear}-${String(i + 1).padStart(2, '0')}`,
    }));
  } else {
    months = [];
    for (let i = 11; i >= 0; i--) {
      let m = selMonth - i, y = selYear;
      while (m < 1) { m += 12; y--; }
      months.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` });
    }
  }

  const totals = months.map(({ key }) =>
    allTxns.filter(t => t.date?.startsWith(key) && t.amount > 0 && !t.ignored && !t.isTransfer && t.group !== 'transfer')
           .reduce((s, t) => s + t.amount, 0)
  );
  const maxSpend   = Math.max(...totals, 1);
  const selKey     = viewMode === 'annual'
    ? `${selYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    : `${selYear}-${String(selMonth).padStart(2, '0')}`;
  const tallestIdx = totals.indexOf(Math.max(...totals));
  const slotW = 340 / 12, barW = 16, maxBarH = 61, barBaseY = 88;

  const bars = months.map(({ key, month }, i) => {
    const spend = totals[i];
    const barH  = Math.max(2, (spend / maxSpend) * maxBarH);
    const x = i * slotW + (slotW - barW) / 2;
    const y = barBaseY - barH;
    const fill = key === selKey ? '#15803d' : 'var(--brand,#16a34a)';
    const cx = i * slotW + slotW / 2;
    const lbl = i === tallestIdx && spend > 0
      ? `<text x="${cx.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="7" fill="var(--muted,#64748b)">${fmtCurrency(spend)}</text>`
      : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" rx="2" fill="${fill}"/>
      ${lbl}
      <text x="${cx.toFixed(1)}" y="98" text-anchor="middle" font-size="8" fill="var(--muted,#64748b)">${MONTHS[month - 1]}</text>`;
  }).join('');

  container.querySelector('#trend-chart').innerHTML =
    `<svg viewBox="0 0 340 100" width="100%" style="display:block;overflow:visible;">${bars}</svg>`;
}

// ── Recent transactions ───────────────────────────────────
function renderRecentTxns(container, allTxns) {
  const el = container.querySelector('#recent-txns');
  if (!el) return;
  const recent = Object.values(allTxns)
    .filter(t => t.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  if (!recent.length) {
    el.innerHTML = `<div class="empty-sm">No transactions yet.</div>`;
    return;
  }
  el.innerHTML = recent.map(t => {
    const cat = getCategoryById(t.category);
    const isIncome = t.amount < 0;
    return `
      <div class="dash-txn-row">
        <span class="dash-txn-icon" style="background:${tintColor(cat.color)}">${cat.icon}</span>
        <div class="dash-txn-meta">
          <span class="dash-txn-name">${t.merchantName ?? t.description}</span>
          <span class="dash-txn-sub">${fmtRelativeDate(t.date)}</span>
        </div>
        <span class="dash-txn-amt${isIncome ? ' income' : ''}">${isIncome ? '+' : ''}${fmtCurrency(Math.abs(t.amount))}</span>
      </div>`;
  }).join('');
}

function tintColor(hex, amount = 0.85) {
  if (!hex?.startsWith('#')) return 'var(--bg)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = c => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
