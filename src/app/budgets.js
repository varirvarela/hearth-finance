import { dbListen, dbSet, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth } from '../shared/format.js';
import { CATEGORIES } from '../shared/categories.js';

// ── Cascading budget tile state ───────────────────────────
let _budgetLevel   = 1;   // 1 = group tiles, 2 = category tiles, 3 = detail
let _budgetGroupId = null;
let _budgetCatId   = null;

export function renderBudgets(container) {
  const now = new Date();
  let year      = now.getFullYear();
  let month     = now.getMonth() + 1;
  let viewMode  = 'monthly'; // 'monthly' | 'annual'

  container.innerHTML = `
    <div class="page budgets">
      <div class="view-toggle-row">
        <div class="view-toggle" id="bud-view-toggle">
          <button class="view-toggle-btn active" data-mode="monthly">Monthly</button>
          <button class="view-toggle-btn" data-mode="annual">Annual</button>
        </div>
      </div>
      <div class="budget-month-nav">
        <button id="budget-prev">&#8592;</button>
        <span id="budget-period-label">${fmtMonth(year, month)}</span>
        <button id="budget-next">&#8594;</button>
      </div>
      <div class="budget-summary" id="budget-summary"></div>
      <div class="budget-pace-legend" id="budget-pace-legend" style="display:none">
        <div class="budget-pace-legend-tick"></div>
        <span id="budget-pace-legend-text"></span>
      </div>
      <div id="budget-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let latestBudgets     = {};
  let latestOwnerTxns   = {};
  let latestPartnerTxns = {};
  let latestTxns        = {};

  const refresh = () => {
    if (viewMode === 'monthly') {
      renderBudgetList(uid, latestBudgets, latestTxns, year, month);
    } else {
      renderBudgetAnnual(uid, latestBudgets, latestTxns, year);
    }
  };

  const syncNextBtn = () => {
    const today = new Date();
    if (viewMode === 'monthly') {
      document.getElementById('budget-next').disabled =
        year === today.getFullYear() && month === today.getMonth() + 1;
    } else {
      document.getElementById('budget-next').disabled = year >= today.getFullYear();
    }
  };

  const updatePeriodLabel = () => {
    document.getElementById('budget-period-label').textContent =
      viewMode === 'monthly' ? fmtMonth(year, month) : String(year);
  };

  syncNextBtn();

  // View toggle
  container.querySelector('#bud-view-toggle').querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      container.querySelector('#bud-view-toggle').querySelectorAll('.view-toggle-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === viewMode)
      );
      // Reset to current period
      year  = now.getFullYear();
      month = now.getMonth() + 1;
      updatePeriodLabel();
      syncNextBtn();
      refresh();
    });
  });

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
    if (viewMode === 'monthly') {
      month--;
      if (month < 1) { month = 12; year--; }
    } else {
      year--;
    }
    updatePeriodLabel();
    syncNextBtn();
    refresh();
  });

  document.getElementById('budget-next').addEventListener('click', () => {
    if (viewMode === 'monthly') {
      month++;
      if (month > 12) { month = 1; year++; }
    } else {
      year++;
    }
    updatePeriodLabel();
    syncNextBtn();
    refresh();
  });
}

// ── Monthly view ──────────────────────────────────────────
function renderBudgetList(uid, budgets, txns, year, month) {
  const listEl    = document.getElementById('budget-list');
  const summaryEl = document.getElementById('budget-summary');
  if (!listEl || !summaryEl) return;

  const now        = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const paceDay    = (year === now.getFullYear() && month === now.getMonth() + 1) ? now.getDate() : daysInMonth;
  const pacePct    = Math.round((paceDay / daysInMonth) * 100);
  const prefix     = `${year}-${String(month).padStart(2, '0')}`;

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

  // Summary
  let totalBudgeted = 0, totalSpent = 0;
  for (const [catId, data] of Object.entries(budgets)) {
    if (data?.monthly > 0) { totalBudgeted += data.monthly; totalSpent += spentByCat[catId] ?? 0; }
  }
  const remaining = totalBudgeted - totalSpent;
  summaryEl.innerHTML = `
    <span style="color:var(--muted)">Budget ${fmtCurrency(totalBudgeted)}</span>
    <span style="color:#ef4444">${fmtCurrency(totalSpent)} spent</span>
    <span style="color:${remaining >= 0 ? 'var(--brand)' : '#ef4444'}">${fmtCurrency(Math.abs(remaining))} ${remaining >= 0 ? 'left' : 'over'}</span>
  `;

  // Pace legend
  const legendEl = document.getElementById('budget-pace-legend');
  const legendTxtEl = document.getElementById('budget-pace-legend-text');
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  if (legendEl && legendTxtEl && isCurrentMonth) {
    legendTxtEl.textContent = `Today's pace — ${pacePct}% of month elapsed`;
    legendEl.style.display = '';
  } else if (legendEl) { legendEl.style.display = 'none'; }

  // Render breadcrumb + level
  renderBudgetNav(listEl, rootCats, rootMap, budgets, spentByCat, txns, pacePct, year, month, prefix);
}

function getCatName(catId) {
  return CATEGORIES.find(c => c.id === catId)?.name ?? catId ?? '';
}

function renderBudgetNav(listEl, rootCats, rootMap, budgets, spentByCat, txns, pacePct, year, month, prefix) {
  // Build breadcrumb HTML
  let bcHtml = '';
  if (_budgetLevel >= 2) {
    const grp = rootCats.find(r => r.id === _budgetGroupId);
    bcHtml = `<div class="bud-breadcrumb">
      <span class="bud-bc-link" data-level="1">All groups</span>
      <span class="bud-bc-sep">›</span>
      <span class="${_budgetLevel === 2 ? 'bud-bc-current' : 'bud-bc-link'}" data-level="2">${grp?.icon ?? ''} ${grp?.name ?? ''}</span>
      ${_budgetLevel === 3 ? `<span class="bud-bc-sep">›</span><span class="bud-bc-current">${getCatName(_budgetCatId)}</span>` : ''}
    </div>`;
  }

  listEl.innerHTML = bcHtml + '<div id="bud-level-content"></div>';

  listEl.querySelectorAll('.bud-bc-link').forEach(link => {
    link.addEventListener('click', () => {
      const lv = parseInt(link.dataset.level);
      if (lv === 1) { _budgetLevel = 1; _budgetGroupId = null; _budgetCatId = null; }
      if (lv === 2) { _budgetLevel = 2; _budgetCatId = null; }
      renderBudgetNav(listEl, rootCats, rootMap, budgets, spentByCat, txns, pacePct, year, month, prefix);
    });
  });

  const contentEl = document.getElementById('bud-level-content');
  if (_budgetLevel === 1) renderGroupTiles(contentEl, rootCats, rootMap, budgets, spentByCat, pacePct, listEl, rootCats, txns, year, month, prefix);
  else if (_budgetLevel === 2) renderCategoryTiles(contentEl, _budgetGroupId, rootMap, budgets, spentByCat, pacePct, listEl, rootCats, txns, year, month, prefix);
  else if (_budgetLevel === 3) renderCategoryDetail(contentEl, _budgetCatId, budgets, spentByCat, txns, pacePct, year, month, prefix);
}

function renderGroupTiles(el, rootCats, rootMap, budgets, spentByCat, pacePct, listEl, allRoots, txns, year, month, prefix) {
  const tiles = rootCats.map(root => {
    const leaves = (rootMap.get(root.id) ?? []).filter(l => (budgets[l.id]?.monthly ?? 0) > 0 || (spentByCat[l.id] ?? 0) > 0);
    if (!leaves.length) return '';

    const groupSpent  = leaves.reduce((s, l) => s + (spentByCat[l.id] ?? 0), 0);
    const groupBudget = leaves.reduce((s, l) => s + (budgets[l.id]?.monthly ?? 0), 0);
    const pct         = groupBudget > 0 ? Math.min(100, Math.round((groupSpent / groupBudget) * 100)) : 0;
    const status      = groupSpent > groupBudget ? 'over' : pct >= pacePct + 10 ? 'warn' : groupBudget > 0 ? 'good' : 'zero';
    const catCount    = leaves.length;

    return `<div class="bud-group-tile ${status}" data-group="${root.id}">
      <div class="bud-tile-hdr">
        <span class="bud-tile-icon">${root.icon}</span>
        <span class="bud-tile-cat-count">${catCount} cat${catCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="bud-tile-name">${root.name}</div>
      <div class="bud-tile-amounts">
        <span class="bud-tile-spent">${fmtCurrency(groupSpent)}</span>
        <span class="bud-tile-budget"> / ${fmtCurrency(groupBudget)}</span>
      </div>
      <div class="bud-tile-bar-track"><div class="bud-tile-bar-fill" style="width:${pct}%"></div></div>
      <div class="bud-tile-footer">
        <span class="bud-tile-pct">${pct}% ${status === 'over' ? '↑ over' : status === 'warn' ? '⚠ on pace' : 'spent'}</span>
        <span class="bud-tile-arrow">›</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="bud-group-tiles-grid">${tiles || '<p class="empty">No budgets set this month.</p>'}</div>`;

  el.querySelectorAll('.bud-group-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      _budgetLevel   = 2;
      _budgetGroupId = tile.dataset.group;
      renderBudgetNav(listEl, allRoots, rootMap, budgets, spentByCat, txns, pacePct, year, month, prefix);
    });
  });
}

function renderCategoryTiles(el, groupId, rootMap, budgets, spentByCat, pacePct, listEl, allRoots, txns, year, month, prefix) {
  const root   = CATEGORIES.find(c => c.id === groupId);
  const leaves = (rootMap.get(groupId) ?? []).filter(l => (budgets[l.id]?.monthly ?? 0) > 0 || (spentByCat[l.id] ?? 0) > 0);

  const tiles = leaves.map(leaf => {
    const spent  = spentByCat[leaf.id] ?? 0;
    const limit  = budgets[leaf.id]?.monthly ?? 0;
    const pct    = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
    const status = spent > limit && limit > 0 ? 'over' : pct >= pacePct + 10 ? 'warn' : limit > 0 ? 'good' : 'zero';
    const badge  = leaf.isFixed ? '<span class="bud-fixed-badge">Fixed</span>' : leaf.isAnnual ? '<span class="bud-fixed-badge annual">Annual</span>' : '';

    return `<div class="bud-cat-tile ${status}" data-cat="${leaf.id}">
      <div class="bud-tile-hdr">
        <div class="bud-cat-tile-icon" style="background:${leaf.color ? leaf.color + '28' : 'var(--faint)'}">${leaf.icon}</div>
        <div class="bud-tile-status-dot"></div>
      </div>
      <div class="bud-tile-name">${leaf.name}${badge}</div>
      <div class="bud-tile-amounts">
        <span class="bud-tile-spent">${fmtCurrency(spent)}</span>
        ${limit > 0 ? `<span class="bud-tile-budget"> / ${fmtCurrency(limit)}</span>` : ''}
      </div>
      ${limit > 0
        ? `<div class="bud-tile-bar-track"><div class="bud-tile-bar-fill" style="width:${pct}%"></div></div>
           <div class="bud-tile-pct">${pct}%${leaf.isFixed ? ' — fixed' : pct >= 100 ? ' ↑ over' : ''}</div>`
        : `<div class="bud-set-link" data-cat="${leaf.id}">Set budget</div>`
      }
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="bud-cat-tiles-subhdr">
      <span class="bud-cat-tiles-group-name">${root?.icon ?? ''} ${root?.name ?? ''}</span>
    </div>
    <div class="bud-cat-tiles-grid">${tiles || '<p class="empty" style="padding:16px">No categories with budgets in this group.</p>'}</div>`;

  el.querySelectorAll('.bud-cat-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      _budgetLevel  = 3;
      _budgetCatId  = tile.dataset.cat;
      renderBudgetNav(listEl, allRoots, rootMap, budgets, spentByCat, txns, pacePct, year, month, prefix);
    });
  });

  el.querySelectorAll('.bud-set-link').forEach(el2 => {
    el2.addEventListener('click', e => {
      e.stopPropagation();
      openInlineEdit(el2, auth.currentUser?.uid, el2.dataset.cat, budgets[el2.dataset.cat]?.monthly ?? 0);
    });
  });
}

function renderCategoryDetail(el, catId, budgets, spentByCat, txns, pacePct, year, month, prefix) {
  const cat    = CATEGORIES.find(c => c.id === catId) ?? { icon: '?', name: catId, color: '#64748b' };
  const spent  = spentByCat[catId] ?? 0;
  const limit  = budgets[catId]?.monthly ?? 0;
  const pct    = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
  const status = spent > limit && limit > 0 ? 'over' : pct >= pacePct + 10 ? 'warn' : limit > 0 ? 'good' : 'zero';
  const barColor = status === 'over' ? '#ef4444' : status === 'warn' ? '#f59e0b' : '#16a34a';

  // Recent transactions for this category this month
  const catTxns = Object.values(txns)
    .filter(t => t.category === catId && t.date?.startsWith(prefix) && !t.ignored && !t.isTransfer)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  const txnRows = catTxns.map(t => `
    <div class="bud-detail-txn-row">
      <div class="bud-detail-txn-icon">${cat.icon}</div>
      <div class="bud-detail-txn-name">${t.merchantName ?? t.description ?? 'Unknown'}</div>
      <div class="bud-detail-txn-date">${t.date?.slice(5) ?? ''}</div>
      <div class="bud-detail-txn-amt">${fmtCurrency(t.amount)}</div>
    </div>`).join('') || '<div style="padding:12px 0;font-size:0.8rem;color:var(--muted)">No transactions this month.</div>';

  el.innerHTML = `
    <div class="bud-detail-hdr">
      <div class="bud-detail-icon" style="background:${cat.color ? cat.color + '1a' : 'var(--faint)'}">${cat.icon}</div>
      <div>
        <div class="bud-detail-name">${cat.name}</div>
        <div class="bud-detail-meta">${catTxns.length} transaction${catTxns.length !== 1 ? 's' : ''} this month</div>
      </div>
      <div class="bud-detail-amounts-right">
        <div class="bud-detail-spent-big" style="color:${barColor}">${fmtCurrency(spent)}</div>
        ${limit > 0 ? `<div class="bud-detail-budget-line">of ${fmtCurrency(limit)} budget · ${pct}%</div>` : '<div class="bud-detail-budget-line">no budget set</div>'}
      </div>
    </div>

    ${limit > 0 ? `
    <div class="bud-detail-bar-wrap">
      <div class="bud-detail-bar-track">
        <div class="bud-detail-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        <div class="budget-pace-tick" style="left:${pacePct}%"></div>
      </div>
      <div class="bud-detail-bar-label">
        <span>$0</span>
        <span style="color:${barColor}">${fmtCurrency(spent)} (${pct}%)</span>
        <span>${fmtCurrency(limit)}</span>
      </div>
    </div>` : ''}

    <div class="bud-detail-stat-grid">
      <div class="bud-detail-stat-card">
        <div class="bud-detail-stat-label">This month</div>
        <div class="bud-detail-stat-val">${fmtCurrency(spent)}</div>
      </div>
      <div class="bud-detail-stat-card">
        <div class="bud-detail-stat-label">Transactions</div>
        <div class="bud-detail-stat-val">${catTxns.length}</div>
      </div>
      ${catTxns.length > 0 ? `
      <div class="bud-detail-stat-card">
        <div class="bud-detail-stat-label">Largest</div>
        <div class="bud-detail-stat-val">${fmtCurrency(Math.max(...catTxns.map(t => t.amount)))}</div>
      </div>
      <div class="bud-detail-stat-card">
        <div class="bud-detail-stat-label">Average</div>
        <div class="bud-detail-stat-val">${fmtCurrency(spent / catTxns.length)}</div>
      </div>` : ''}
    </div>

    <div class="bud-detail-txn-title">Recent transactions</div>
    ${txnRows}
    ${catTxns.length === 0 && limit > 0 ? `
    <div style="margin-top:14px">
      <button class="bud-edit-budget-btn" data-cat="${catId}">Edit budget (${fmtCurrency(limit)}/mo) →</button>
    </div>` : ''}
  `;

  el.querySelector('.bud-edit-budget-btn')?.addEventListener('click', e => {
    openInlineEdit(e.currentTarget, auth.currentUser?.uid, catId, budgets[catId]?.monthly ?? 0);
  });
}

// ── Annual view ───────────────────────────────────────────
function renderBudgetAnnual(uid, budgets, txns, year) {
  const listEl    = document.getElementById('budget-list');
  const summaryEl = document.getElementById('budget-summary');
  if (!listEl || !summaryEl) return;

  const now       = new Date();
  const nowYear   = now.getFullYear();
  const nowMonth  = now.getMonth() + 1;
  // For current year: YTD; for past years: full year
  const maxMonth  = year === nowYear ? nowMonth : 12;
  const yearStr   = String(year);

  // Pace tick position (only for current year)
  const pacePct = year === nowYear ? Math.round((nowMonth / 12) * 100) : null;

  // Aggregate spending for the year
  const spentByCat = {};
  for (const t of Object.values(txns)) {
    if (!t.date?.startsWith(yearStr) || t.amount <= 0 || t.ignored || t.isTransfer || t.group === 'transfer') continue;
    const m = parseInt(t.date.slice(5, 7), 10);
    if (m > maxMonth) continue;
    spentByCat[t.category] = (spentByCat[t.category] ?? 0) + t.amount;
  }

  const expenseLeaves = CATEGORIES.filter(c => c.parent && !c.isIncome);

  // Separate monthly-budget cats from annual-budget cats
  const monthlyLeaves = expenseLeaves.filter(l => !l.isAnnual);
  const annualLeaves  = expenseLeaves.filter(l => l.isAnnual);

  // Compute totals
  let totalAnnualBudget = 0;
  let totalSpent        = 0;
  for (const [catId, data] of Object.entries(budgets)) {
    if (data?.monthly > 0) {
      totalAnnualBudget += data.monthly * 12;
      totalSpent        += spentByCat[catId] ?? 0;
    }
  }

  // Summary bar
  const pct        = totalAnnualBudget > 0 ? Math.round((totalSpent / totalAnnualBudget) * 100) : 0;
  const barColor   = pacePct != null && pct > pacePct + 10 ? '#dc2626' : pct > (pacePct ?? 100) ? '#f59e0b' : '#16a34a';

  const annualRemaining = totalAnnualBudget - totalSpent;
  summaryEl.innerHTML = `
    <span style="color:var(--muted)">Budget ${fmtCurrency(totalAnnualBudget)}</span>
    <span style="color:#ef4444">${fmtCurrency(totalSpent)} YTD</span>
    <span style="color:${annualRemaining >= 0 ? 'var(--brand)' : '#ef4444'}">${fmtCurrency(Math.abs(annualRemaining))} ${annualRemaining >= 0 ? 'left' : 'over'}</span>
  `;

  const legendEl = document.getElementById('budget-pace-legend');
  if (legendEl) legendEl.style.display = 'none';

  // Build sections
  const rootMap = new Map();
  for (const leaf of expenseLeaves) {
    if (!rootMap.has(leaf.parent)) rootMap.set(leaf.parent, []);
    rootMap.get(leaf.parent).push(leaf);
  }
  const rootCats = CATEGORIES.filter(c => !c.parent && !c.isIncome && c.id !== 'transfer');

  let html = buildAnnualSection(
    'Monthly goals — annualized (×12)',
    'annual-section-monthly',
    monthlyLeaves, budgets, spentByCat, rootCats, rootMap, pacePct,
    /* useAnnual */ false
  );

  html += buildAnnualSection(
    'Annual goals',
    'annual-section-annual',
    annualLeaves, budgets, spentByCat, rootCats, rootMap, pacePct,
    /* useAnnual */ true
  );

  if (!html) {
    listEl.innerHTML = '<p class="empty">No budgets set and no spending this year.</p>';
    return;
  }

  listEl.innerHTML = html;
}

function buildAnnualSection(title, sectionClass, leaves, budgets, spentByCat, rootCats, rootMap, pacePct, useAnnual) {
  // Group leaves by their root category
  const byRoot = new Map();
  for (const leaf of leaves) {
    if (!byRoot.has(leaf.parent)) byRoot.set(leaf.parent, []);
    byRoot.get(leaf.parent).push(leaf);
  }

  let inner = '';
  for (const root of rootCats) {
    const groupLeaves = byRoot.get(root.id) ?? [];
    const visible = groupLeaves.filter(l => (budgets[l.id]?.monthly ?? 0) > 0 || (spentByCat[l.id] ?? 0) > 0);
    if (!visible.length) continue;

    inner += `<div class="budget-group">
      <div class="budget-group-header">
        <span>${root.icon}</span><span>${root.name}</span>
      </div>`;

    for (const leaf of visible) {
      const spent      = spentByCat[leaf.id] ?? 0;
      const monthly    = budgets[leaf.id]?.monthly ?? 0;
      const annualTarget = monthly * 12;
      const hasBudget  = annualTarget > 0;
      const pct        = hasBudget ? Math.min(100, (spent / annualTarget) * 100) : 0;
      const barColor   = pct >= 100 ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#16a34a';

      const tickHtml = hasBudget && pacePct != null
        ? `<div class="budget-pace-tick" style="left:${pacePct}%"></div>`
        : '';

      const barHtml = hasBudget
        ? `<div class="budget-bar"><div class="budget-bar-fill" style="width:${pct}%;background:${barColor}"></div>${tickHtml}</div>`
        : `<div class="budget-bar" style="background:transparent"></div>`;

      const amtLabel = hasBudget
        ? `<span class="budget-leaf-amt">${fmtCurrency(spent)} / ${fmtCurrency(annualTarget)}/yr</span>`
        : `<span class="budget-leaf-amt budget-limit-muted">—</span>`;

      inner += `<div class="budget-leaf">
        <span class="budget-leaf-icon">${leaf.icon}</span>
        <span class="budget-leaf-name">${leaf.name}</span>
        ${barHtml}
        ${amtLabel}
      </div>`;
    }

    inner += '</div>';
  }

  if (!inner) return '';

  return `
    <div class="${sectionClass}">
      <div class="annual-section-hdr">${title}</div>
      ${inner}
    </div>`;
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
