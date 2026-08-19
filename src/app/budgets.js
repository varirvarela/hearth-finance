import { dbListen, dbSet, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtMonth } from '../shared/format.js';
import { CATEGORIES } from '../shared/categories.js';

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

  const now       = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const paceDay   = year === now.getFullYear() && month === now.getMonth() + 1 ? now.getDate() : daysInMonth;
  const pacePct   = Math.round((paceDay / daysInMonth) * 100);

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
  const remaining = totalBudgeted - totalSpent;
  summaryEl.innerHTML = `
    <span style="color:var(--muted)">Budget ${fmtCurrency(totalBudgeted)}</span>
    <span style="color:#ef4444">${fmtCurrency(totalSpent)} spent</span>
    <span style="color:${remaining >= 0 ? 'var(--brand)' : '#ef4444'}">${fmtCurrency(Math.abs(remaining))} ${remaining >= 0 ? 'left' : 'over'}</span>
  `;

  const legendEl    = document.getElementById('budget-pace-legend');
  const legendTxtEl = document.getElementById('budget-pace-legend-text');
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  if (legendEl && legendTxtEl && isCurrentMonth) {
    legendTxtEl.textContent = `Today's pace — ${pacePct}% of month elapsed`;
    legendEl.style.display = '';
  } else if (legendEl) {
    legendEl.style.display = 'none';
  }

  let html = '';
  for (const root of rootCats) {
    const leaves  = rootMap.get(root.id) ?? [];
    const visible = leaves.filter(l => (budgets[l.id]?.monthly ?? 0) > 0 || (spentByCat[l.id] ?? 0) > 0);
    if (!visible.length) continue;

    html += `<div class="budget-group">
      <div class="budget-group-header">
        <span>${root.icon}</span><span>${root.name}</span>
      </div>`;

    for (const leaf of visible) {
      const spent     = spentByCat[leaf.id] ?? 0;
      const limit     = budgets[leaf.id]?.monthly ?? 0;
      const hasBudget = limit > 0;
      const pct       = hasBudget ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
      const barColor  = pct >= 100 ? '#dc2626' : pct >= pacePct + 15 ? '#f59e0b' : '#16a34a';
      const amtColor  = pct >= 100 ? '#dc2626' : pct >= pacePct + 15 ? '#b45309' : 'var(--text)';

      const badge = leaf.isFixed ? ' <span class="budget-badge">Fixed</span>'
                  : leaf.isAnnual ? ' <span class="budget-badge annual-badge">Annual</span>' : '';

      const barHtml = hasBudget
        ? `<div class="budget-bar"><div class="budget-bar-fill" style="width:${pct}%;background:${barColor}"></div><div class="budget-pace-tick" style="left:${pacePct}%"></div></div>`
        : `<div class="budget-bar" style="background:transparent"></div>`;

      const amtHtml = hasBudget
        ? `<span class="budget-leaf-amt" style="color:${amtColor}">${fmtCurrency(spent)} / <span class="budget-limit" data-cat="${leaf.id}">${fmtCurrency(limit)}</span></span>`
        : `<span class="budget-leaf-amt"><span class="set-budget-link" data-cat="${leaf.id}">Set</span></span>`;

      html += `<div class="budget-leaf">
        <span class="budget-leaf-icon">${leaf.icon}</span>
        <span class="budget-leaf-name">${leaf.name}${badge}</span>
        ${barHtml}
        ${amtHtml}
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
