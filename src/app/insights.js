import { dbListen, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency } from '../shared/format.js';
import { getCategoryById, CATEGORIES } from '../shared/categories.js';

export function renderInsights(container) {
  const now      = new Date();
  const nowYear  = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const nowDay   = now.getDate();

  container.innerHTML = `
    <div class="page insights">
      <div class="insights-header">
        <h2 class="page-title" style="margin-bottom:2px">Insights</h2>
        <div class="insights-subtitle" id="insights-date">Loading…</div>
      </div>
      <div id="insights-list">
        <div class="insights-loading">Analyzing your spending…</div>
      </div>
      <div class="insights-footer">
        <button class="insights-rules-link" id="insights-go-rules">Manage categorization rules →</button>
      </div>
    </div>
  `;

  container.querySelector('#insights-go-rules').addEventListener('click', () => {
    location.hash = 'automation';
  });

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let latestOwnerTxns   = null;
  let latestPartnerTxns = null;
  let latestBudgets     = null;

  const refresh = () => {
    const allTxns = { ...(latestOwnerTxns ?? {}), ...(latestPartnerTxns ?? {}) };
    if (latestOwnerTxns === null || latestBudgets === null) return;
    renderInsightCards(container, allTxns, latestBudgets, nowYear, nowMonth, nowDay);
  };

  dbListen(`transactions/${uid}`, txns => { latestOwnerTxns = txns ?? {}; refresh(); });
  dbListen(`budgets/${uid}`, b => { latestBudgets = b ?? {}; refresh(); });
  getPartnerUid(uid).then(p => {
    if (p) {
      dbListen(`transactions/${p}`, pt => { latestPartnerTxns = pt ?? {}; refresh(); });
    }
  });
}

function renderInsightCards(container, allTxnsObj, budgets, year, month, day) {
  const dateEl = container.querySelector('#insights-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' · Updated on load';
  }

  const monthStr    = `${year}-${String(month).padStart(2, '0')}`;
  const prevMonthStr = month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const pacePct     = Math.round((day / daysInMonth) * 100);

  const allTxns = Object.values(allTxnsObj);

  // Spending by category this month
  const spentByCat = {};
  const txnsByCat  = {};
  for (const t of allTxns) {
    if (!t.date?.startsWith(monthStr) || t.amount <= 0 || t.isTransfer || t.group === 'transfer' || t.ignored) continue;
    spentByCat[t.category] = (spentByCat[t.category] ?? 0) + t.amount;
    if (!txnsByCat[t.category]) txnsByCat[t.category] = [];
    txnsByCat[t.category].push(t);
  }

  // Spending by category last month (for anomaly detection)
  const spentByCatPrev = {};
  for (const t of allTxns) {
    if (!t.date?.startsWith(prevMonthStr) || t.amount <= 0 || t.isTransfer || t.group === 'transfer' || t.ignored) continue;
    spentByCatPrev[t.category] = (spentByCatPrev[t.category] ?? 0) + t.amount;
  }

  // Spending by merchant this month
  const spentByMerchant = {};
  for (const t of allTxns) {
    if (!t.date?.startsWith(monthStr) || t.amount <= 0 || t.isTransfer || t.group === 'transfer' || t.ignored) continue;
    const key = (t.merchantName ?? t.description ?? '').toLowerCase();
    spentByMerchant[key] = (spentByMerchant[key] ?? 0) + t.amount;
  }

  // Total monthly budget
  const totalBudget = Object.values(budgets).reduce((s, b) => s + (b.monthly ?? 0), 0);
  const totalSpent  = Object.values(spentByCat).reduce((s, v) => s + v, 0);

  const insights = [];

  // ── 1. Categories over budget (red) ──────────────────────
  const leaves = CATEGORIES.filter(c => c.parent && !c.isIncome && !c.isAnnual);
  for (const cat of leaves) {
    const limit = budgets[cat.id]?.monthly ?? 0;
    if (!limit) continue;
    const spent = spentByCat[cat.id] ?? 0;
    const pct   = Math.round((spent / limit) * 100);
    if (pct >= 100) {
      const over = fmtCurrency(spent - limit);
      insights.push({
        border: 'var(--red,#ef4444)', dot: '#ef4444', priority: 1,
        title: `${cat.icon} ${cat.name} is ${pct}% over budget`,
        sub: `${fmtCurrency(spent)} spent of ${fmtCurrency(limit)} budget. ${over} over limit with ${daysInMonth - day} days remaining.`,
        link: { label: `→ Review ${cat.name} transactions`, cat: cat.id },
      });
    }
  }

  // ── 2. Categories on pace to overspend (amber) ────────────
  for (const cat of leaves) {
    const limit = budgets[cat.id]?.monthly ?? 0;
    if (!limit) continue;
    const spent = spentByCat[cat.id] ?? 0;
    const pct   = Math.round((spent / limit) * 100);
    const projectedSpend = day > 0 ? Math.round((spent / day) * daysInMonth) : 0;
    if (pct < 100 && pct >= pacePct + 15 && projectedSpend > limit) {
      const projectedPct = Math.round((projectedSpend / limit) * 100);
      insights.push({
        border: 'var(--amber,#f59e0b)', dot: '#f59e0b', priority: 2,
        title: `${cat.icon} ${cat.name} on pace to overspend`,
        sub: `${fmtCurrency(spent)} of ${fmtCurrency(limit)} in ${day} days. Current pace projects ${fmtCurrency(projectedSpend)} — ${projectedPct}% of your monthly target.`,
        link: { label: `→ See ${cat.name} spending`, cat: cat.id },
      });
    }
  }

  // ── 3. Anomalies vs last month (purple) ──────────────────
  for (const [catId, spent] of Object.entries(spentByCat)) {
    const prevSpent = spentByCatPrev[catId] ?? 0;
    if (!prevSpent || prevSpent < 20) continue;
    const ratio = spent / prevSpent;
    if (ratio >= 3) {
      const cat = getCategoryById(catId);
      if (cat.isIncome || cat.id === 'transfer') continue;
      insights.push({
        border: '#8b5cf6', dot: '#8b5cf6', priority: 3,
        title: `${cat.icon} ${cat.name} is ${Math.round(ratio)}× your usual rate`,
        sub: `${fmtCurrency(spent)} this month vs ${fmtCurrency(prevSpent)} last month. This is ${Math.round((ratio - 1) * 100)}% higher than normal — worth reviewing.`,
        link: { label: `→ Review ${cat.name} transactions`, cat: catId },
      });
    }
  }

  // ── 4. Subscription overlaps (blue) ──────────────────────
  const subKeywords = ['amazon prime', 'prime video', 'netflix', 'hulu', 'disney', 'apple tv', 'hbo', 'peacock', 'paramount'];
  const foundSubs = subKeywords.filter(k => Object.keys(spentByMerchant).some(m => m.includes(k)));
  if (foundSubs.length >= 3) {
    const total = foundSubs.reduce((s, k) => {
      const found = Object.entries(spentByMerchant).find(([m]) => m.includes(k));
      return s + (found ? found[1] : 0);
    }, 0);
    if (total > 20) {
      insights.push({
        border: '#3b82f6', dot: '#3b82f6', priority: 4,
        title: `${foundSubs.length} streaming subscriptions detected`,
        sub: `${foundSubs.slice(0, 3).map(k => k.replace(/^\w/, c => c.toUpperCase())).join(', ')} = ${fmtCurrency(total)}/month. Some may overlap — worth reviewing.`,
        link: { label: '→ Review subscriptions', cat: null },
      });
    }
  }

  // ── 5. Good news: categories well under pace (green) ─────
  let goodCount = 0;
  for (const cat of leaves) {
    const limit = budgets[cat.id]?.monthly ?? 0;
    if (!limit || cat.isFixed) continue;
    const spent = spentByCat[cat.id] ?? 0;
    const pct   = Math.round((spent / limit) * 100);
    if (pct <= pacePct - 20 && pct > 0 && goodCount < 2) {
      const remaining = fmtCurrency(limit - spent);
      insights.push({
        border: '#16a34a', dot: '#16a34a', priority: 5,
        title: `${cat.icon} Great month for ${cat.name}`,
        sub: `${fmtCurrency(spent)} of ${fmtCurrency(limit)} budget used — ${remaining} remaining with more than half the month left.`,
        link: null,
      });
      goodCount++;
    }
  }

  // ── 6. Annual budget alerts (amber) ──────────────────────
  const annualLeaves = CATEGORIES.filter(c => c.parent && !c.isIncome && c.isAnnual);
  const yearStr      = String(year);
  for (const cat of annualLeaves) {
    const annualBudget = (budgets[cat.id]?.monthly ?? 0) * 12;
    if (!annualBudget) continue;
    const ytdSpent = allTxns
      .filter(t => t.date?.startsWith(yearStr) && t.category === cat.id && t.amount > 0 && !t.ignored)
      .reduce((s, t) => s + t.amount, 0);
    const pct = Math.round((ytdSpent / annualBudget) * 100);
    const annualPace = Math.round((month / 12) * 100);
    if (pct < annualPace - 30 && ytdSpent < annualBudget * 0.5) {
      insights.push({
        border: 'var(--amber,#f59e0b)', dot: '#f59e0b', priority: 4,
        title: `${cat.icon} ${cat.name} budget ${100 - pct}% unused`,
        sub: `Only ${fmtCurrency(ytdSpent)} of ${fmtCurrency(annualBudget)} annual budget spent by ${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })}. ${fmtCurrency(annualBudget - ytdSpent)} remaining.`,
        link: { label: `→ Annual ${cat.name} budget`, cat: cat.id },
      });
    }
  }

  // Sort by priority then render
  insights.sort((a, b) => a.priority - b.priority);

  const listEl = container.querySelector('#insights-list');
  if (!listEl) return;

  if (!insights.length) {
    listEl.innerHTML = `
      <div class="insights-empty">
        <div class="insights-empty-icon">✓</div>
        <div class="insights-empty-title">All clear</div>
        <div class="insights-empty-sub">No spending alerts this month. Check back as the month progresses.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = insights.map(ins => `
    <div class="insight" style="border-left-color:${ins.border}">
      <div class="insight-dot" style="background:${ins.dot}"></div>
      <div class="insight-body">
        <div class="insight-title">${ins.title}</div>
        <div class="insight-sub">${ins.sub}</div>
        ${ins.link ? `<div class="insight-link" data-cat="${ins.link.cat ?? ''}">${ins.link.label}</div>` : ''}
      </div>
    </div>
  `).join('');

  // Wire category drill-downs
  listEl.querySelectorAll('.insight-link[data-cat]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      location.hash = 'transactions';
    });
  });
}
