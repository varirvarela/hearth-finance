import { dbListen, dbGet, dbUpdate, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtDate }     from '../shared/format.js';
import { openImportModal } from './import.js';
import {
  getCategoryById,
  getRootCategories,
  getChildCategories,
} from '../shared/categories.js';
import { blankState, needsReview, applyFilters, countActive, normalizeSource, findDuplicates } from '../shared/filter-utils.js';
import { buildRule } from '../shared/rules.js';

const PAGE_SIZE = 100;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Source definitions for the filter UI.
// 'values' lists all normalizeSource() results that belong to this bucket.
const SOURCES = [
  { id: 'ai',     label: 'AI',     values: ['ai']            },
  { id: 'rule',   label: 'Rule',   values: ['rule']          },
  { id: 'manual', label: 'Manual', values: ['manual']        },
  { id: 'import', label: 'Import', values: ['import']        },
  { id: 'plaid',  label: 'Plaid',  values: ['plaid']         },
];

let allTxns        = [];
let partnerAllTxns = [];
let partnerInitial = 'P';
let accountMap     = {};

function getSourceBadge(source) {
  const map = {
    ai:     { bg: '#dbeafe', color: '#1d4ed8', text: 'AI'     },
    rule:   { bg: '#dcfce7', color: '#15803d', text: 'Rule'   },
    import: { bg: '#fef9c3', color: '#854d0e', text: 'Import' },
    tiller: { bg: '#fef9c3', color: '#854d0e', text: 'Import' },
    manual: { bg: '#f3e8ff', color: '#7e22ce', text: 'Manual' },
    plaid:  { bg: '#f1f5f9', color: '#475569', text: 'Plaid'  },
  };
  const s = map[source] ?? { bg: '#f1f5f9', color: '#475569', text: source ?? '—' };
  return `<span style="background:${s.bg};color:${s.color};border-radius:20px;padding:2px 8px;font-size:0.75rem;font-weight:600">${s.text}</span>`;
}

// Returns a tinted background for category icons.
// On dark desktop (≥768px) uses low-opacity hex; on mobile lightens toward white.
function tintColor(hex, amount = 0.88) {
  if (!hex || !hex.startsWith('#')) return 'var(--bg)';
  if (window.matchMedia('(min-width: 768px)').matches) return hex + '28'; // 16% opacity on dark bg
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function renderTransactions(container) {
  if (!document.getElementById('txn-detail-styles')) {
    const style = document.createElement('style');
    style.id = 'txn-detail-styles';
    style.textContent = `
      .txn-detail {
        padding: 0.9rem 1rem 0.9rem 1rem;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        font-size: 0.85rem;
      }
      .txn-detail-grid { display: grid; gap: 0.4rem; }
      .txn-detail-row { display: flex; gap: 0.5rem; align-items: flex-start; }
      .txn-dl {
        color: var(--faint);
        min-width: 120px;
        flex-shrink: 0;
        font-size: 0.78rem;
        padding-top: 2px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .txn-dv { color: var(--text); flex: 1; line-height: 1.45; }
      .txn-notes-input {
        width: 100%;
        border: 1.5px solid var(--border);
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 0.85rem;
        resize: vertical;
        font-family: inherit;
        background: var(--surface);
        color: var(--text);
        transition: border-color 0.15s;
      }
      .txn-notes-input:focus { border-color: var(--brand); outline: none; }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div class="page transactions">
      <div class="toolbar">
        <span class="toolbar-dt-title">Transactions</span>
        <input type="search" id="txn-search" placeholder="Search transactions…" />
        <button class="filter-toggle" id="filter-toggle">
          Filters <span class="filter-badge" id="filter-badge" style="display:none"></span>
        </button>
        <button class="btn-ghost txn-data-btn" id="txn-import-btn">Import</button>
        <button class="btn-ghost txn-data-btn" id="txn-export-btn">Export</button>
      </div>
      <div class="filter-panel" id="filter-panel"></div>
      <div id="dup-banner" style="display:none"></div>
      <div id="txn-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  partnerAllTxns = [];
  partnerInitial = 'P';

  const state = blankState();

  // Category drill-down from Dashboard: read sessionStorage intent
  const filterIntent = sessionStorage.getItem('txn-filter-intent');
  if (filterIntent) {
    try {
      const { catId, year, month } = JSON.parse(filterIntent);
      sessionStorage.removeItem('txn-filter-intent');
      if (catId) {
        const cat = getCategoryById(catId);
        state.cats   = [catId];
        state.groups = cat.parent ? [cat.parent] : [catId];
        if (year && month) { state.dateMode = 'month'; state.year = year; state.month = month; }
      }
    } catch { /* ignore malformed intent */ }
  }

  let filterPanelRendered = false;

  const refresh = () => {
    const combined = [...allTxns, ...partnerAllTxns]
      .sort((a, b) => b[1].date.localeCompare(a[1].date));
    const filtered = applyFilters(combined, state);
    const active   = countActive(state);
    const badge    = document.getElementById('filter-badge');
    if (badge) {
      badge.textContent   = active > 0 ? String(active) : '';
      badge.style.display = active > 0 ? 'inline-flex' : 'none';
    }
    renderPage(filtered, state, uid, refresh, accountMap);
  };

  dbListen(`transactions/${uid}`, txns => {
    allTxns = Object.entries(txns ?? {}).sort((a, b) => b[1].date.localeCompare(a[1].date));
    refresh();
    updateDupBanner(allTxns, uid);
  });

  dbListen(`accounts/${uid}`, accounts => {
    accountMap = accounts ?? {};
    refresh();
  });

  getPartnerUid(uid).then(p => {
    if (p) {
      dbGet(`users/${p}`).then(partnerUser => {
        if (partnerUser?.displayName) {
          partnerInitial = partnerUser.displayName.charAt(0).toUpperCase();
        } else if (partnerUser?.email) {
          partnerInitial = partnerUser.email.charAt(0).toUpperCase();
        }
      });
      dbListen(`transactions/${p}`, partnerTxns => {
        partnerAllTxns = Object.entries(partnerTxns ?? {})
          .map(([id, t]) => [id, { ...t, _owner: p }]);
        refresh();
      });
      dbListen(`accounts/${p}`, partnerAccts => {
        Object.assign(accountMap, partnerAccts ?? {});
        refresh();
      });
    }
  });

  document.getElementById('txn-search').addEventListener('input', e => {
    state.query = e.target.value.toLowerCase();
    state.page  = 0;
    refresh();
  });

  document.getElementById('filter-toggle').addEventListener('click', () => {
    const panel  = document.getElementById('filter-panel');
    const toggle = document.getElementById('filter-toggle');
    if (!filterPanelRendered) {
      renderFilterPanel(state, accountMap, refresh);
      filterPanelRendered = true;
    }
    panel.classList.toggle('open');
    toggle.classList.toggle('active', panel.classList.contains('open'));
  });

  document.getElementById('txn-import-btn').addEventListener('click', () => openImportModal());
  document.getElementById('txn-export-btn').addEventListener('click', () => exportTxnCsv(uid));
}

function renderFilterPanel(state, accountMap, refresh) {
  const panel   = document.getElementById('filter-panel');
  const curYear = new Date().getFullYear();

  const yearOptions = Array.from({ length: 6 }, (_, i) => {
    const y = curYear - i;
    return `<option value="${y}" ${state.year === y ? 'selected' : ''}>${y}</option>`;
  }).join('');

  const monthOptions = `<option value="0" ${state.month === 0 ? 'selected' : ''}>All months</option>`
    + MONTHS.map((m, i) => `<option value="${i + 1}" ${state.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('');

  const roots = getRootCategories();

  const groupPills = roots.map(c => `
    <button class="pill${state.groups.includes(c.id) ? ' active' : ''}"
            data-group="${c.id}"
            style="--pill-color:${c.color}">
      ${c.icon} ${c.name}
    </button>`).join('');

  // Combined account list: Plaid accounts (with alias) + Tiller accounts not already merged
  const plaidEntries = Object.entries(accountMap).filter(([, a]) => !a.isManual);
  const plaidAccounts = plaidEntries.map(([id, a]) => ({
    key:         id,
    name:        a.alias ?? a.name,
    mergedNames: a.mergedNames ?? [],
  }));

  // All Tiller names that have been merged into a Plaid account
  const mergedTillerNames = new Set(plaidAccounts.flatMap(a => a.mergedNames));

  // Exact Plaid display names (to avoid showing duplicates for exact-match Tiller)
  const plaidDisplayNames = new Set(plaidAccounts.map(a => a.name));

  const tillerNamesSeen = new Set();
  allTxns.forEach(([, t]) => {
    if ((t.source === 'tiller' || t.categorySource === 'import') && t.accountName
        && !plaidDisplayNames.has(t.accountName)
        && !mergedTillerNames.has(t.accountName)) {
      tillerNamesSeen.add(t.accountName);
    }
  });
  const tillerAccounts   = [...tillerNamesSeen].map(name => ({ key: name, name, mergedNames: [] }));
  const combinedAccounts = [...plaidAccounts, ...tillerAccounts];
  const hasAccounts      = combinedAccounts.length > 0;

  const accountSection = hasAccounts ? `
    <div class="filter-section">
      <span class="filter-label">Account</span>
      <div class="pill-group accounts-group" id="f-accounts">
        ${combinedAccounts.map(acc => `
          <button class="pill${state.accounts.includes(acc.key) ? ' active' : ''}" data-account="${acc.key}">
            ${acc.name}
          </button>`).join('')}
      </div>
    </div>` : '';

  const sourcePills = SOURCES.map(s => `
    <button class="pill${state.sources.includes(s.id) ? ' active' : ''}" data-source="${s.id}">
      ${s.label}
    </button>`).join('');

  panel.innerHTML = `
    <div class="filter-section">
      <span class="filter-label">Date</span>
      <div class="seg-ctrl">
        <button class="seg${state.dateMode === 'all'   ? ' active' : ''}" data-mode="all">All</button>
        <button class="seg${state.dateMode === 'month' ? ' active' : ''}" data-mode="month">Month</button>
        <button class="seg${state.dateMode === 'range' ? ' active' : ''}" data-mode="range">Range</button>
      </div>
      <div id="date-month-row" style="margin-top:6px;display:${state.dateMode === 'month' ? 'flex' : 'none'};gap:5px">
        <select id="f-month" style="flex:1;border:1.5px solid var(--border);border-radius:6px;padding:4px 7px;font-size:0.75rem;background:var(--bg)">${monthOptions}</select>
        <select id="f-year"  style="flex:1;border:1.5px solid var(--border);border-radius:6px;padding:4px 7px;font-size:0.75rem;background:var(--bg)">${yearOptions}</select>
      </div>
      <div id="date-range-row" style="margin-top:6px;display:${state.dateMode === 'range' ? 'flex' : 'none'};gap:5px">
        <input type="date" id="f-from" value="${state.dateFrom}" style="flex:1;border:1.5px solid var(--border);border-radius:6px;padding:4px 7px;font-size:0.75rem;background:var(--bg)">
        <input type="date" id="f-to"   value="${state.dateTo}"   style="flex:1;border:1.5px solid var(--border);border-radius:6px;padding:4px 7px;font-size:0.75rem;background:var(--bg)">
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-row">
        <div>
          <span class="filter-label">Type</span>
          <div class="seg-ctrl">
            <button class="seg${state.type === 'all'     ? ' active' : ''}" data-type="all">All</button>
            <button class="seg${state.type === 'expense' ? ' active' : ''}" data-type="expense">Expense</button>
            <button class="seg${state.type === 'income'  ? ' active' : ''}" data-type="income">Income</button>
          </div>
        </div>
        <div>
          <span class="filter-label">Amount</span>
          <div style="display:flex;gap:5px">
            <input type="number" id="f-amt-min" placeholder="Min $" value="${state.amtMin}"
              style="width:74px;padding:4px 7px;border:1.5px solid var(--border);border-radius:6px;font-size:0.75rem;background:var(--bg)">
            <input type="number" id="f-amt-max" placeholder="Max $" value="${state.amtMax}"
              style="width:74px;padding:4px 7px;border:1.5px solid var(--border);border-radius:6px;font-size:0.75rem;background:var(--bg)">
          </div>
        </div>
      </div>
    </div>

    <div class="filter-section">
      <span class="filter-label">Status</span>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <label class="f-check">
          <input type="checkbox" id="f-review"    ${state.review       ? 'checked' : ''}> Needs review
        </label>
        <label class="f-check">
          <input type="checkbox" id="f-pending"   ${state.pending      ? 'checked' : ''}> Pending
        </label>
        <label class="f-check">
          <input type="checkbox" id="f-transfers" ${state.hideTransfers ? 'checked' : ''}> Hide transfers
        </label>
      </div>
    </div>

    <div class="filter-section">
      <span class="filter-label">Category</span>
      <div class="pill-group" id="f-groups">${groupPills}</div>
      <div id="f-leaves" class="f-leaf-section" style="${state.groups.length === 0 ? 'display:none' : ''}"></div>
    </div>

    ${accountSection}

    <div class="filter-section">
      <span class="filter-label">Source</span>
      <div class="pill-group" id="f-sources">${sourcePills}</div>
    </div>

    <div class="filter-section" style="display:flex;align-items:center;justify-content:flex-end">
      <button class="btn-ghost" id="f-clear" style="width:auto;font-size:0.75rem;padding:4px 12px;border:1.5px solid var(--border);border-radius:6px">Clear all</button>
    </div>
  `;

  if (state.groups.length > 0) updateLeafSection(state, refresh);

  // ── Date mode ──
  panel.querySelectorAll('.seg[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.dateMode = btn.dataset.mode;
      state.page     = 0;
      panel.querySelectorAll('.seg[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.dateMode));
      document.getElementById('date-month-row').style.display = state.dateMode === 'month' ? 'flex' : 'none';
      document.getElementById('date-range-row').style.display = state.dateMode === 'range' ? 'flex' : 'none';
      refresh();
    });
  });

  document.getElementById('f-month').addEventListener('change', e => {
    state.month = Number(e.target.value); state.page = 0; refresh();
  });
  document.getElementById('f-year').addEventListener('change', e => {
    state.year = Number(e.target.value); state.page = 0; refresh();
  });
  document.getElementById('f-from').addEventListener('change', e => {
    state.dateFrom = e.target.value; state.page = 0; refresh();
  });
  document.getElementById('f-to').addEventListener('change', e => {
    state.dateTo = e.target.value; state.page = 0; refresh();
  });

  // ── Type ──
  panel.querySelectorAll('.seg[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type;
      state.page = 0;
      panel.querySelectorAll('.seg[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === state.type));
      refresh();
    });
  });

  // ── Amount ──
  document.getElementById('f-amt-min').addEventListener('input', e => {
    state.amtMin = e.target.value; state.page = 0; refresh();
  });
  document.getElementById('f-amt-max').addEventListener('input', e => {
    state.amtMax = e.target.value; state.page = 0; refresh();
  });

  // ── Status checkboxes ──
  document.getElementById('f-review').addEventListener('change', e => {
    state.review = e.target.checked; state.page = 0; refresh();
  });
  document.getElementById('f-pending').addEventListener('change', e => {
    state.pending = e.target.checked; state.page = 0; refresh();
  });
  document.getElementById('f-transfers').addEventListener('change', e => {
    state.hideTransfers = e.target.checked; state.page = 0; refresh();
  });

  // ── Category groups ──
  panel.querySelector('#f-groups').addEventListener('click', e => {
    const btn = e.target.closest('.pill[data-group]');
    if (!btn) return;
    const gid = btn.dataset.group;
    if (state.groups.includes(gid)) {
      state.groups = state.groups.filter(g => g !== gid);
      state.cats   = state.cats.filter(c => getCategoryById(c).parent !== gid);
    } else {
      state.groups = [...state.groups, gid];
    }
    btn.classList.toggle('active', state.groups.includes(gid));
    state.page = 0;
    updateLeafSection(state, refresh);
    refresh();
  });

  // ── Accounts ──
  // Build a lookup: accountKey → mergedNames[] so pill clicks include merged Tiller names
  const mergedNamesFor = {};
  for (const acc of combinedAccounts) mergedNamesFor[acc.key] = acc.mergedNames ?? [];

  if (hasAccounts) {
    panel.querySelector('#f-accounts').addEventListener('click', e => {
      const btn = e.target.closest('.pill[data-account]');
      if (!btn) return;
      const aid    = btn.dataset.account;
      const extras = mergedNamesFor[aid] ?? [];
      const keys   = [aid, ...extras];
      const isNowActive = !state.accounts.includes(aid);
      if (isNowActive) {
        state.accounts = [...new Set([...state.accounts, ...keys])];
      } else {
        state.accounts = state.accounts.filter(a => !keys.includes(a));
      }
      btn.classList.toggle('active', isNowActive);
      state.page = 0;
      refresh();
    });
  }

  // ── Sources ──
  panel.querySelector('#f-sources').addEventListener('click', e => {
    const btn = e.target.closest('.pill[data-source]');
    if (!btn) return;
    const sid = btn.dataset.source;
    state.sources = state.sources.includes(sid)
      ? state.sources.filter(s => s !== sid)
      : [...state.sources, sid];
    btn.classList.toggle('active', state.sources.includes(sid));
    state.page = 0;
    refresh();
  });

  // ── Clear ──
  document.getElementById('f-clear').addEventListener('click', () => {
    Object.assign(state, blankState());
    renderFilterPanel(state, accountMap, refresh);
    refresh();
  });
}

function updateLeafSection(state, refresh) {
  const container = document.getElementById('f-leaves');
  if (!container) return;

  if (state.groups.length === 0) {
    container.style.display = 'none';
    container.innerHTML     = '';
    return;
  }

  container.style.display = '';
  const leaves = state.groups.flatMap(gid => getChildCategories(gid));

  container.innerHTML = leaves.map(leaf => `
    <label class="f-check">
      <input type="checkbox" data-cat="${leaf.id}" ${state.cats.includes(leaf.id) ? 'checked' : ''}>
      ${leaf.icon} ${leaf.name}
    </label>`).join('');

  container.querySelectorAll('input[data-cat]').forEach(cb => {
    cb.addEventListener('change', () => {
      const cid = cb.dataset.cat;
      if (cb.checked) {
        if (!state.cats.includes(cid)) state.cats = [...state.cats, cid];
      } else {
        state.cats = state.cats.filter(c => c !== cid);
      }
      state.page = 0;
      if (refresh) refresh();
    });
  });
}

function renderPage(filtered, state, uid, refresh, accountMap) {
  const el = document.getElementById('txn-list');
  if (!el) return;

  if (!filtered.length) {
    el.innerHTML = `<div class="empty"><span class="empty-icon">🔍</span><span>No transactions found.</span></div>`;
    return;
  }

  const total      = filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const page       = Math.min(state.page, totalPages - 1);
  state.page       = page;

  const start = page * PAGE_SIZE;
  const end   = Math.min(start + PAGE_SIZE, total);
  const slice = filtered.slice(start, end);

  const rows = slice.map(([id, t]) => {
    const cat            = getCategoryById(t.category);
    const review         = needsReview(t);
    const isUncategorized = t.category === 'uncategorized' || !t.category;
    const isPartner      = !!t._owner;
    const acctName = accountMap[t.accountId]?.alias ?? accountMap[t.accountId]?.name ?? t.accountName ?? '';

    const partnerBadge = isPartner
      ? `<span style="background:#dbeafe;color:#1e40af;border-radius:8px;padding:1px 6px;font-size:0.68rem;font-weight:700;flex-shrink:0">${partnerInitial}</span>`
      : '';

    // Colored icon background based on category color
    const catBg = cat.color ? tintColor(cat.color, 0.88) : 'var(--bg)';

    // Sub-line: date · account [partner badge]
    const subParts = [fmtDate(t.date)];
    if (acctName) subParts.push(acctName);
    const subHTML = `<span class="txn-sub">${subParts.join(' · ')} ${partnerBadge}</span>`;

    // Suggestion strip — rendered as sibling to .txn-row inside .txn-item
    let suggestionHTML = '';
    if (review && !isPartner) {
      if (t.category !== 'uncategorized' && t.categorySource === 'ai' && (t.aiConfidence ?? 0) > 0) {
        suggestionHTML = `
          <div class="sug-strip ai">
            <span class="sug-lbl ai">AI</span>
            <span class="sug-cat">${cat.icon} ${cat.name}</span>
            <button class="btn-quick-confirm" data-id="${id}" data-cat="${t.category}">✓ Confirm</button>
            <button class="btn-quick-change"  data-id="${id}" data-cat="${t.category}">Change</button>
          </div>`;
      } else {
        suggestionHTML = `
          <div class="sug-strip warn">
            <span class="sug-lbl warn">⚠ Uncategorized</span>
            <button class="btn-quick-change" data-id="${id}" data-cat="${t.category}" style="margin-left:auto">Categorize →</button>
          </div>`;
      }
    }

    return `
      <div class="txn-item">
        <div class="txn-row${review ? ' needs-review' : ''}${isUncategorized ? ' is-uncategorized' : ''}" data-id="${id}">
          <button class="txn-icon cat-btn" title="Change category" data-id="${id}" data-cat="${t.category}"
                  style="--cat-bg:${catBg}"${isPartner ? ' disabled' : ''}>${cat.icon}</button>
          <div class="txn-meta">
            <span class="txn-desc">${t.merchantName ?? t.description}</span>
            ${subHTML}
          </div>
          <div class="txn-right">
            <span class="txn-amount ${t.amount < 0 ? 'income' : ''}">${t.amount < 0 ? '+' : ''}${fmtCurrency(Math.abs(t.amount))}</span>
            ${t.pending ? '<span class="txn-pending-badge">Pending</span>' : ''}
          </div>
        </div>
        ${suggestionHTML}
      </div>`;
  }).join('');

  const paginationHTML = total > PAGE_SIZE ? `
    <div class="pagination">
      <button class="btn-ghost page-btn" data-p="${page - 1}" ${page === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="page-info">Page ${page + 1} of ${totalPages}</span>
      <button class="btn-ghost page-btn" data-p="${page + 1}" ${page === totalPages - 1 ? 'disabled' : ''}>Next →</button>
    </div>` : '';

  // Active category filter chips
  const activeCats = state.cats.length > 0 ? state.cats.map(cid => {
    const c = getCategoryById(cid);
    return `<span class="txn-filter-chip">${c.icon} ${c.name} <button class="txn-chip-clear" data-cat="${cid}">✕</button></span>`;
  }).join('') : '';
  const filterChips = activeCats ? `<div class="txn-filter-chips">${activeCats}</div>` : '';

  el.innerHTML = `
    ${filterChips}
    <div class="txn-summary">${total.toLocaleString()} transactions · showing ${start + 1}–${end}</div>
    <div class="card-rows">${rows}</div>
    ${paginationHTML}
  `;

  // Wire chip clear buttons
  el.querySelectorAll('.txn-chip-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.cat;
      state.cats   = state.cats.filter(c => c !== cid);
      state.groups = state.groups.filter(g => {
        const cat = getCategoryById(cid);
        return g !== (cat.parent ?? cid);
      });
      state.page = 0;
      refresh();
    });
  });

  // ── Category icon button ──
  el.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const row = btn.closest('.txn-row');
      openCategoryPicker(btn.dataset.id, btn.dataset.cat, uid, row);
    });
  });

  // ── Quick confirm (AI suggestion) ──
  el.querySelectorAll('.btn-quick-confirm').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const txnId = btn.dataset.id;
      const catId = btn.dataset.cat;
      const cat   = getCategoryById(catId);
      await dbUpdate(`transactions/${uid}/${txnId}`, {
        categorySource: 'manual',
        needsReview:    false,
      });
      const row = btn.closest('.txn-item')?.querySelector('.txn-row');
      if (row) {
        const entry = slice.find(([sid]) => sid === txnId);
        showRulePrompt(row, entry?.[1] ?? {}, cat, uid);
      }
    });
  });

  // ── Quick change (opens picker) ──
  el.querySelectorAll('.btn-quick-change').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const row = btn.closest('.txn-item')?.querySelector('.txn-row') ?? btn.closest('.txn-row');
      openCategoryPicker(btn.dataset.id, btn.dataset.cat, uid, row);
    });
  });

  // ── Pagination ──
  el.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.page = Number(btn.dataset.p);
      refresh();
    });
  });

  // ── Row expand (detail panel) ──
  el.querySelectorAll('.txn-row').forEach(row => {
    const id    = row.dataset.id;
    const entry = slice.find(([sid]) => sid === id);
    if (!entry) return;
    const [, t] = entry;

    row.addEventListener('click', e => {
      if (e.target.closest('.cat-btn')) return;

      const item = row.closest('.txn-item') ?? row;

      // Close rule prompt if open after this item
      item.nextElementSibling?.classList.contains('rule-prompt') && item.nextElementSibling.remove();

      const existingDetail = document.querySelector('.txn-detail');
      if (existingDetail) {
        const wasThisItem = existingDetail.previousElementSibling === item;
        existingDetail.remove();
        if (wasThisItem) return;
      }

      const isPartner   = !!t._owner;
      const accountName = t.accountName || accountMap[t.accountId]?.name || '—';
      const srcBadge    = getSourceBadge(t.categorySource);

      const detail = document.createElement('div');
      detail.className = 'txn-detail';
      detail.innerHTML = `
        <div class="txn-detail-grid">
          <div class="txn-detail-row"><span class="txn-dl">Description</span><span class="txn-dv">${t.description}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Original</span><span class="txn-dv">${t.fullDescription ?? t.originalDescription ?? '—'}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Account</span><span class="txn-dv">${accountName}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Date</span><span class="txn-dv">${t.date}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Source</span><span class="txn-dv">${srcBadge}</span></div>
          ${t.aiConfidence != null ? `<div class="txn-detail-row"><span class="txn-dl">AI confidence</span><span class="txn-dv">${Math.round(t.aiConfidence * 100)}%</span></div>` : ''}
          ${t.plaidCategory ? `<div class="txn-detail-row"><span class="txn-dl">Plaid category</span><span class="txn-dv">${t.plaidCategory}</span></div>` : ''}
          <div class="txn-detail-row"><span class="txn-dl">Notes</span><span class="txn-dv"><textarea class="txn-notes-input" data-id="${id}" rows="2" placeholder="Add a note…"${isPartner ? ' disabled' : ''}>${t.notes ?? ''}</textarea></span></div>
          <div class="txn-detail-row"><span class="txn-dl">Transfer</span><span class="txn-dv"><label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer"><input type="checkbox" class="txn-transfer-chk" data-id="${id}" ${t.isTransfer ? 'checked' : ''}${isPartner ? ' disabled' : ''}> Mark as inter-account transfer</label></span></div>
        </div>
      `;

      item.insertAdjacentElement('afterend', detail);

      if (!isPartner) {
        const originalNotes = t.notes ?? '';
        detail.querySelector('.txn-notes-input').addEventListener('blur', e2 => {
          if (e2.target.value !== originalNotes) {
            dbUpdate(`transactions/${uid}/${id}`, { notes: e2.target.value });
          }
        });
        detail.querySelector('.txn-transfer-chk').addEventListener('change', e2 => {
          dbUpdate(`transactions/${uid}/${id}`, { isTransfer: e2.target.checked });
        });
      }
    });
  });
}

// ── Show rule-creation prompt after category change ────────────────────────

function showRulePrompt(row, txn, catObj, uid) {
  // Remove any pre-existing prompt elsewhere on the page
  document.querySelectorAll('.rule-prompt').forEach(el => el.remove());

  const merchant = (txn.merchantName ?? txn.description ?? '').trim();
  if (!merchant || merchant.length < 3) return;

  const prompt = document.createElement('div');
  prompt.className = 'rule-prompt';
  prompt.innerHTML = `
    <span class="rule-prompt-text">
      Always categorize <strong>${merchant}</strong> as <strong>${catObj.icon} ${catObj.name}</strong>?
    </span>
    <button class="btn-rule-yes">Add rule</button>
    <button class="btn-rule-skip">Skip</button>
  `;

  // Insert after the txn-item (or after its detail panel if one is open)
  const item   = row.closest?.('.txn-item') ?? row;
  const target = item.nextElementSibling?.classList.contains('txn-detail') ? item.nextElementSibling : item;
  target.insertAdjacentElement('afterend', prompt);

  prompt.querySelector('.btn-rule-yes').addEventListener('click', async () => {
    const ruleId = `rule_${Date.now()}`;
    await dbUpdate(`rules/${uid}/${ruleId}`, buildRule({
      name:       `${merchant} → ${catObj.name}`,
      matchField: 'description',
      matchOp:    'contains',
      matchValue: merchant.toLowerCase(),
      categoryId: catObj.id,
      priority:   50,
    }));
    prompt.innerHTML = `<span style="color:var(--brand);font-weight:600;font-size:0.85rem">✓ Rule saved</span>`;
    setTimeout(() => prompt.remove(), 2000);
  });

  prompt.querySelector('.btn-rule-skip').addEventListener('click', () => prompt.remove());
}

// ── Category picker modal ──────────────────────────────────────────────────

function openCategoryPicker(txnId, currentCat, uid, rowEl) {
  const currentCatObj = getCategoryById(currentCat);
  const currentGroup  = currentCatObj.parent ?? currentCat;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);

  function renderGroupStep() {
    const groups = getRootCategories();
    modal.innerHTML = `
      <div class="modal modal-picker">
        <h3>Categoría</h3>
        <div class="picker-groups">
          ${groups.map(g => `
            <button class="picker-group-btn${g.id === currentGroup ? ' active' : ''}"
                    data-group="${g.id}"
                    style="--group-color:${g.color}">
              <span class="picker-group-icon">${g.icon}</span>
              <span>${g.name}</span>
            </button>`).join('')}
        </div>
        <div style="margin-top:1rem">
          <button class="btn-ghost modal-cancel" style="width:100%">Cancelar</button>
        </div>
      </div>
    `;
    modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('.picker-group-btn').forEach(btn => {
      btn.addEventListener('click', () => renderLeafStep(btn.dataset.group));
    });
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  function renderLeafStep(groupId) {
    const group  = getCategoryById(groupId);
    const leaves = getChildCategories(groupId).filter(c => !c.hide || c.id === currentCat);

    modal.innerHTML = `
      <div class="modal modal-picker">
        <button class="picker-back-btn">← ${group.icon} ${group.name}</button>
        <div class="picker-leaves">
          ${leaves.map(c => `
            <button class="picker-leaf-btn${c.id === currentCat ? ' active' : ''}"
                    data-id="${c.id}"
                    style="--leaf-color:${c.color}">
              <span>${c.icon}</span>
              <span>${c.name}</span>
              ${c.isFixed  ? '<span class="leaf-badge">Fijo</span>'   : ''}
              ${c.isAnnual ? '<span class="leaf-badge annual">Anual</span>' : ''}
            </button>`).join('')}
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:1rem">
          <button class="btn-ghost modal-cancel" style="flex:1">Cancelar</button>
        </div>
      </div>
    `;

    modal.querySelector('.picker-back-btn').addEventListener('click', renderGroupStep);
    modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());

    modal.querySelectorAll('.picker-leaf-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = getCategoryById(btn.dataset.id);
        await dbUpdate(`transactions/${uid}/${txnId}`, {
          category:       btn.dataset.id,
          group:          cat.parent ?? btn.dataset.id,
          isFixed:        cat.isFixed  ?? false,
          isAnnual:       cat.isAnnual ?? false,
          categorySource: 'manual',
          needsReview:    false,
        });
        modal.remove();

        // Show rule-creation prompt after saving
        if (rowEl) {
          const txnEntry = allTxns.find(([id]) => id === txnId) ??
                           partnerAllTxns.find(([id]) => id === txnId);
          showRulePrompt(rowEl, txnEntry?.[1] ?? {}, cat, uid);
        }
      });
    });

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  renderGroupStep();
}

// ── Duplicate detection banner ─────────────────────────────────────────────
let _dupPairs = [];
let _dupReviewOverlay = null;

function updateDupBanner(txnEntries, uid) {
  const banner = document.getElementById('dup-banner');
  if (!banner) return;
  if (_dupReviewOverlay) return; // don't update banner while review is open
  _dupPairs = findDuplicates(txnEntries);
  if (_dupPairs.length === 0) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = '';
  banner.innerHTML = `
    <div class="dup-banner">
      <span class="dup-banner-icon">⚠</span>
      <span class="dup-banner-text">${_dupPairs.length} potential duplicate${_dupPairs.length > 1 ? 's' : ''} found</span>
      <button class="dup-banner-btn" id="dup-review-btn">Review →</button>
    </div>`;
  banner.querySelector('#dup-review-btn').addEventListener('click', () => openDupReview(_dupPairs, uid));
}

function openDupReview(pairs, uid) {
  if (_dupReviewOverlay) return; // already open — prevent stacking
  let idx = 0;

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  _dupReviewOverlay = overlay;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    _dupReviewOverlay = null;
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
  };

  function renderPair() {
    if (!overlay.isConnected) return; // overlay was removed — stop
    if (idx >= pairs.length) {
      const sheet = overlay.querySelector('.sheet');
      if (!sheet) return;
      sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-hdr"><span class="sheet-title">All duplicates reviewed</span><button class="sheet-close" id="dc">✕</button></div>
        <div style="padding:24px;text-align:center;font-size:0.85rem;color:var(--muted)">No more potential duplicates.</div>`;
      overlay.querySelector('#dc')?.addEventListener('click', close);
      return;
    }
    const [idA, a, idB, b] = pairs[idx];
    const fmt = (t) => {
      const cat = getCategoryById(t.category);
      return `
        <div class="dup-card">
          <div class="dup-card-name">${t.merchantName ?? t.description}</div>
          <div class="dup-card-meta">${t.date} · ${cat.icon} ${cat.name}</div>
          <div class="dup-card-amt">${t.amount < 0 ? '+' : ''}$${Math.abs(t.amount).toFixed(2)}</div>
          ${t.accountName ? `<div class="dup-card-acct">${t.accountName}</div>` : ''}
        </div>`;
    };

    overlay.innerHTML = `
      <div class="sheet" style="max-height:85vh">
        <div class="sheet-handle"></div>
        <div class="sheet-hdr">
          <span class="sheet-title">Duplicate ${idx + 1} of ${pairs.length}</span>
          <button class="sheet-close" id="dc">✕</button>
        </div>
        <div style="padding:12px 16px">
          <p style="font-size:0.75rem;color:var(--muted);margin:0 0 10px">Same amount, date, and merchant. Keep one and delete the other.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            ${fmt(a)}${fmt(b)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <button class="btn-primary" id="keep-a" style="font-size:0.78rem;padding:8px">Keep A · Delete B</button>
            <button class="btn-primary" id="keep-b" style="font-size:0.78rem;padding:8px">Keep B · Delete A</button>
          </div>
          <button class="btn-secondary" id="dup-skip" style="width:100%;font-size:0.78rem;padding:8px">Skip (keep both)</button>
        </div>
      </div>`;

    overlay.querySelector('#dc').addEventListener('click', close);
    overlay.querySelector('#keep-a').addEventListener('click', async () => {
      await dbUpdate(`transactions/${uid}/${idB}`, { ignored: true });
      idx++; renderPair();
    });
    overlay.querySelector('#keep-b').addEventListener('click', async () => {
      await dbUpdate(`transactions/${uid}/${idA}`, { ignored: true });
      idx++; renderPair();
    });
    overlay.querySelector('#dup-skip').addEventListener('click', async () => {
      const aOk = [...(a.dupOk ?? []), idB];
      const bOk = [...(b.dupOk ?? []), idA];
      await Promise.all([
        dbUpdate(`transactions/${uid}/${idA}`, { dupOk: aOk }),
        dbUpdate(`transactions/${uid}/${idB}`, { dupOk: bOk }),
      ]);
      idx++; renderPair();
    });
  }

  renderPair();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

async function exportTxnCsv(uid) {
  const txns = await dbGet(`transactions/${uid}`);
  if (!txns) { alert('No transactions to export.'); return; }
  const rows = [['Date','Description','Merchant','Amount','Category','Account','Notes']];
  for (const t of Object.values(txns)) {
    rows.push([t.date, t.description, t.merchantName ?? '', t.amount, t.category, t.accountId, t.notes ?? '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `hearth-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}
