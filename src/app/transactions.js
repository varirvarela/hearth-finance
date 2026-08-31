import { dbListen, dbGet, dbSet, dbUpdate, dbRemove, auth, getPartnerUid, getHouseholdId } from '../shared/firebase.js';
import { fmtCurrency, fmtDate }     from '../shared/format.js';
import { openImportModal } from './import.js';
import {
  getCategoryById,
  getRootCategories,
  getChildCategories,
  CATEGORY_MAP,
} from '../shared/categories.js';
import { blankState, needsReview, applyFilters, countActive, normalizeSource, findDuplicates } from '../shared/filter-utils.js';
import { buildRule, evaluateRules } from '../shared/rules.js';
import { openRuleEditor } from './automation.js';
import { normalizeMerchant } from '../shared/normalize-merchant.js';

const PAGE_SIZE = 100;
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

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

let allTxns          = [];
let partnerAllTxns   = [];
let partnerInitial   = 'P';
let accountMap       = {};
let allRulesSnapshot = {};
let _merchantRules   = {}; // normalizedName → { catId, confirmedAt }
let _catDescriptions = {};
const _aiSugCache    = new Map(); // txnId → { catId, source }

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
      .txn-detail-actions {
        margin-top: 0.9rem; padding-top: 0.7rem; border-top: 1px solid var(--border);
        display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
      }
      .btn-delete-txn {
        font-size: 0.8rem; color: #ef4444; background: none;
        border: 1.5px solid #ef4444; border-radius: 8px; padding: 4px 12px;
        cursor: pointer; opacity: 0.65; transition: opacity 0.15s;
      }
      .btn-delete-txn:hover { opacity: 1; }
      .delete-confirm { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
      .delete-confirm-msg { font-size: 0.82rem; color: var(--text); }
      .btn-delete-confirm {
        font-size: 0.8rem; background: #ef4444; color: #fff; border: none;
        border-radius: 8px; padding: 4px 12px; cursor: pointer;
      }
      .btn-delete-cancel {
        font-size: 0.8rem; background: none; border: 1.5px solid var(--border);
        border-radius: 8px; padding: 4px 10px; cursor: pointer; color: var(--text);
      }
      .btn-ai-suggest {
        font-size: 0.8rem; background: none; border: 1.5px solid var(--brand);
        color: var(--brand); border-radius: 8px; padding: 4px 12px;
        cursor: pointer; opacity: 0.8; transition: opacity 0.15s; margin-left: auto;
      }
      .btn-ai-suggest:hover { opacity: 1; }
      .btn-ai-suggest:disabled { opacity: 0.45; cursor: default; }
      .btn-create-rule {
        font-size: 0.8rem; background: none; border: 1.5px solid var(--muted);
        color: var(--muted); border-radius: 8px; padding: 4px 12px;
        cursor: pointer; opacity: 0.75; transition: opacity 0.15s;
      }
      .btn-create-rule:hover { opacity: 1; color: var(--text); border-color: var(--text); }
      .detail-ai-result {
        flex-basis: 100%; display: flex; align-items: center; gap: 0.6rem;
        flex-wrap: wrap; font-size: 0.82rem; padding-top: 4px;
      }
      .btn-ai-accept {
        font-size: 0.8rem; background: var(--brand); color: #fff; border: none;
        border-radius: 8px; padding: 4px 12px; cursor: pointer;
      }
      .btn-ai-keep {
        font-size: 0.8rem; background: none; border: 1.5px solid var(--border);
        border-radius: 8px; padding: 4px 10px; cursor: pointer; color: var(--text);
      }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div class="page transactions">
      <div class="toolbar">
        <span class="toolbar-dt-title">Transactions</span>
        <input type="search" id="txn-search" placeholder="Search transactions…" />
        <button class="filter-toggle" id="filter-toggle">
          <span class="filter-toggle-label">Filter</span>
          <span class="filter-badge hidden" id="filter-active-count"></span>
        </button>
        <div class="toolbar-data-actions">
          <button class="txn-data-btn" id="txn-import-btn">↑ Import</button>
          <button class="txn-data-btn" id="txn-export-btn">↓ Export</button>
        </div>
      </div>
      <div class="filter-panel" id="filter-panel"></div>
      <div id="dup-banner" style="display:none"></div>
      <div id="txn-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const hid = getHouseholdId();

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
    const badge    = document.getElementById('filter-active-count');
    if (badge) {
      badge.textContent = active > 0 ? String(active) : '';
      badge.classList.toggle('hidden', active === 0);
    }
    renderPage(filtered, state, hid, refresh, accountMap);
  };

  dbListen(`accounts/${hid}`, accounts => {
    accountMap = accounts ?? {};
    if (allTxns.length) refresh(); // skip until transactions are loaded
  });

  dbListen(`rules/${hid}`, rules => {
    allRulesSnapshot = rules ?? {};
  });

  // Load learned merchant rules — written each time the user confirms a suggestion
  dbListen(`merchantRules/${hid}`, rules => { _merchantRules = rules ?? {}; });

  dbGet(`categoryDescriptions/${hid}`).then(d => { _catDescriptions = d ?? {}; }).catch(() => {});

  // Preload ALL stored suggestions into cache before the first render so that
  // suggestCategory() can surface them synchronously — no async strip-patching needed.
  ;(async () => {
    try {
      const sugs = await dbGet(`suggestions/${hid}`);
      const count = Object.keys(sugs ?? {}).length;
      console.log(`[Hearth] suggestions preload: ${count} entries loaded`);
      for (const [txnId, sug] of Object.entries(sugs ?? {})) {
        if (sug?.catId && sug.catId !== 'uncategorized') _aiSugCache.set(txnId, sug);
      }
    } catch (e) {
      console.error('[Hearth] suggestions preload failed:', e);
    }

    dbListen(`transactions/${hid}`, txns => {
      allTxns = Object.entries(txns ?? {}).sort((a, b) => b[1].date.localeCompare(a[1].date));
      refresh();
      updateDupBanner(allTxns, hid);
    });

    // Keep listening so suggestions written after load (e.g. new batch run) still appear.
    dbListen(`suggestions/${hid}`, saved => {
      for (const [txnId, sug] of Object.entries(saved ?? {})) {
        if (_aiSugCache.has(txnId)) continue;
        if (sug?.catId && sug.catId !== 'uncategorized') {
          _aiSugCache.set(txnId, sug);
          updateSugStrip(txnId, sug);
        }
      }
    });
  })();

  if (hid === uid) getPartnerUid(uid).then(p => {
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
  document.getElementById('txn-export-btn').addEventListener('click', () => exportTxnCsv(hid));
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

// ── Tiered category suggestion helpers ────────────────────────────────────────

function suggestCategory(txnId, txn, allRules) {
  const isValidCat = id => id && id !== 'uncategorized' && getCategoryById(id).id !== 'uncategorized';

  // Tier 1: rules (evaluated against the rules object directly)
  const ruleMatch = evaluateRules(txn, allRules);
  if (ruleMatch && isValidCat(ruleMatch)) return { catId: ruleMatch, source: 'rule' };

  // Tier 2: keyword heuristics — all IDs match the real taxonomy
  const text = ((txn.merchantName ?? '') + ' ' + (txn.description ?? '')).toLowerCase();
  const KEYWORDS = [
    // Transfers (must be first — high confidence)
    [/\btransfer\b|transferencia|entre cuentas|wire transfer|sent to|received from/i, 'transfer_cuentas'],
    [/\bach\b.*debit|ach electronic|electronic.*debit|online.*scheduled payment/i,   'transfer_cuentas'],
    [/pago.*tarjeta|card payment|tarjeta.*pago|credit card payment/i,               'transfer_tarjeta'],
    // Delivery
    [/uber eats|rappi|didi food|doordash|grubhub|pedidos ya/i,                     'salidas_delivery'],
    // Dining & bars
    [/restaurante|restaurant|café|cafe|coffee|starbucks|sushi|pizza|taco|burger|mcdonald|kfc|subway|bar |cantina/i, 'salidas_comunes'],
    // Streaming & subscriptions
    [/netflix|spotify|disney\+|hbo|apple.*sub|amazon prime|youtube premium|deezer|paramount/i, 'suscripciones_comunes'],
    // Telecom (before utilities so it matches first)
    [/telmex|totalplay|izzi|megacable|infinitum|at&t|att fijo|teléfono fijo|internet.*hogar/i, 'telecom_fijo'],
    // Utilities
    [/\bcfe\b|luz eléctrica|sacmex|\bconagua\b|gas natural fenosa|sempra|agua potable/i, 'utilities_comunes'],
    // Super & farmacia
    [/walmart|costco|sam.?s club|soriana|chedraui|h.?e.?b|oxxo|7.?eleven|farmacia|similares|benavides|san pablo|superama|coppel/i, 'super_farmacia_comunes'],
    // Shopping
    [/amazon|mercado libre|shein|liverpool|palacio de hierro|zara|h&m|forever 21|sears/i, 'shopping_comunes'],
    // Auto — fuel & tolls
    [/gasolina|pemex|bp |shell|total.?gas|combustible|\bpeaje\b|\bcaseta\b|tag iave|autopass/i, 'auto_comunes'],
    // Auto — service & insurance
    [/seguro.*auto|auto.*seguro|car insurance|mantenimiento auto|servicio.*auto|nissan|honda service/i, 'auto_comunes_anual'],
    // Kids — school
    [/colegio|escuela|material escolar|útiles|papelería|librería escolar/i,         'kids_colegio'],
    [/\btuition\b|inscripción|matrícula|cuota escolar/i,                             'kids_tuition'],
    // Kids activities
    [/kids.*actividad|actividad.*niños|fútbol.*niños|clases.*niños/i,               'kids_activities'],
    // Salud
    [/doctor|médico|medico|hospital|clínica|clinica|dentista|farmacia benavides|farmacias del ahorro|laboratorio/i, 'salud_comunes'],
    // Entertainment & events
    [/cinepolis|cinemex|cineteca|teatro|concierto|ticketmaster|superboletos|show|espectáculo/i, 'salidas_eventos'],
    // Casa — cleaning
    [/limpieza|cleaning service|servicio hogar|mucama|srvc hogar/i,                  'casa_comunes_mensual'],
    // Casa — mortgage/rent
    [/hipoteca|mortgage|infonavit|fovissste|\brenta\b|arrendamiento/i,              'casa_fijo_mensual'],
    // Gym & fitness
    [/smartfit|equinox|sport.?city|gym|crossfit|\bspin\b|gimnasio/i,                'adult_activities'],
    // Travel
    [/airbnb|booking\b|expedia|vrbo|marriott|hilton|hyatt|four seasons|hotel\b/i,   'travel_vari'],
    [/aeromexico|volaris|vivaaerobus|delta|united|american airlines|aerol[ií]nea/i,  'travel_vari'],
    // Venmo
    [/\bvenmo\b/i, 'venmo'],
    // Donations
    [/donación|donation|donativo|charity|cruz roja/i,                                'donation'],
    // Business
    [/accenture|infosys|deloitte|kpmg|expense report/i,                              'business_accenture'],
  ];
  for (const [pattern, catId] of KEYWORDS) {
    if (pattern.test(text) && isValidCat(catId)) return { catId, source: 'heuristic' };
  }

  // Tier 3: cached Worker result if already fetched
  const cached = _aiSugCache.get(txnId);
  if (cached !== undefined) {
    return cached && isValidCat(cached.catId) ? cached : null;
  }

  // Return null if nothing found yet (Worker call triggered separately)
  return null;
}


const _EXAMPLE_STOP = new Set(['payment', 'purchase', 'debit', 'credit', 'charge', 'transfer', 'from', 'received', 'sent', 'with', 'using']);

function buildExamples(txn, confirmedTxns, max = 10) {
  const words = ((txn.merchantName ?? '') + ' ' + (txn.description ?? ''))
    .toLowerCase().split(/\W+/).filter(w => w.length > 3 && !_EXAMPLE_STOP.has(w));

  const scored = confirmedTxns.map(t => {
    const tText = ((t.merchantName ?? '') + ' ' + (t.description ?? '')).toLowerCase();
    const score = words.reduce((n, w) => n + (tText.includes(w) ? 1 : 0), 0);
    return { t, score };
  });

  const withMatch = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
  const matchSet  = new Set(withMatch.map(x => x.t));
  const recent    = confirmedTxns.filter(t => !matchSet.has(t)).slice(0, max - withMatch.length);

  return [...withMatch.map(x => x.t), ...recent].map(t => ({
    merchantName: t.merchantName,
    description:  t.description,
    category:     t.category,
    amount:       t.amount,
    date:         t.date,
  }));
}

// Tier 4: call the AI Worker when Tiers 1–3 all missed.
// Saves the result to Firebase so it becomes a Tier 3 hit on next load.
async function fetchAiSuggestion(txnId, txn, uid) {
  if (_aiSugCache.has(txnId)) return;
  _aiSugCache.set(txnId, null); // mark in-flight
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) { _aiSugCache.set(txnId, false); resetSugStrip(txnId); return; }

    const confirmedTxns = [...allTxns, ...partnerAllTxns]
      .filter(([, t]) => t.category && t.category !== 'uncategorized' && t.categorySource !== 'ai')
      .map(([, t]) => t);
    const examples = buildExamples(txn, confirmedTxns);

    const res = await fetch(`${WORKER_URL}/categorize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body:    JSON.stringify({
        txn,
        merchantRules: _merchantRules,
        // Merge user overrides with built-in descriptions so the AI has full context
        // even for categories the user hasn't customized yet.
        categoryDescriptions: Object.fromEntries(
          Object.entries(CATEGORY_MAP)
            .filter(([, c]) => c.parent)
            .map(([id, c]) => [id, _catDescriptions[id] || c.description || ''])
        ),
        examples,
      }),
    });

    if (!res.ok) { _aiSugCache.set(txnId, false); resetSugStrip(txnId); return; }

    const result = await res.json();

    if (result.quotaExhausted || !result.category || result.category === 'uncategorized') {
      _aiSugCache.set(txnId, false);
      resetSugStrip(txnId);
      return;
    }

    const sug = { catId: result.category, source: 'ai', conf: result.confidence };
    _aiSugCache.set(txnId, sug);
    dbSet(`suggestions/${uid}/${txnId}`, sug); // persist so next load skips the AI call
    updateSugStrip(txnId, sug);
  } catch {
    _aiSugCache.set(txnId, false);
    resetSugStrip(txnId);
  }
}

// Resets an "Analyzing…" strip back to "Uncategorized" when AI returns nothing.
function resetSugStrip(txnId) {
  const row = document.querySelector(`.txn-row[data-id="${txnId}"]`);
  if (!row) return;
  const strip = row.closest('.txn-item')?.querySelector('.sug-strip');
  if (!strip) return;
  strip.className = 'sug-strip warn';
  strip.innerHTML = `
    <span class="sug-lbl warn">⚠ Uncategorized</span>
    <button class="btn-quick-change" data-id="${txnId}" data-cat="uncategorized" style="margin-left:auto">Categorize →</button>`;
  strip.querySelector('.btn-quick-change')?.addEventListener('click', e => {
    e.stopPropagation();
    row.querySelector('.cat-btn')?.click();
  });
}

// Writes a merchant → category mapping to Firebase so future transactions are auto-matched.
function learnMerchant(uid, txnId, catId) {
  const txn = (allTxns.find(([id]) => id === txnId) ?? partnerAllTxns.find(([id]) => id === txnId))?.[1];
  const key = normalizeMerchant(txn?.merchantName ?? txn?.description);
  if (key && key.length >= 3) {
    dbSet(`merchantRules/${uid}/${key}`, { catId, confirmedAt: Date.now() });
  }
}

function sugSourceLabel(sug) {
  const base = sug.source === 'ai' ? 'AI' : sug.source === 'rule' ? 'Rule' : sug.source === 'learned' ? 'Learned' : 'Suggested';
  const conf = sug.conf != null ? ` · ${Math.round(sug.conf * 100)}%` : '';
  const hint = sug.hint ? ` · ${sug.hint}` : '';
  return `${base}${conf}${hint}`;
}

function updateSugStrip(txnId, sug) {
  const row = document.querySelector(`.txn-row[data-id="${txnId}"]`);
  if (!row) return;
  const strip = row.closest('.txn-item')?.querySelector('.sug-strip');
  if (!strip) return;
  const cat       = getCategoryById(sug.catId);
  const parentCat = cat.parent ? getCategoryById(cat.parent) : null;
  const catLabel  = parentCat ? `${parentCat.icon} ${parentCat.name} › ${cat.icon} ${cat.name}` : `${cat.icon} ${cat.name}`;
  const cls = sug.source === 'ai' ? 'ai' : 'heuristic';
  strip.className = `sug-strip ${cls}`;
  strip.innerHTML = `
    <span class="sug-lbl ${cls}">${sugSourceLabel(sug)}</span>
    <span class="sug-cat">${catLabel}</span>
    <button class="btn-quick-confirm" data-id="${txnId}" data-cat="${sug.catId}">✓ Confirm</button>
    <button class="btn-quick-change"  data-id="${txnId}" data-cat="${sug.catId}">Change</button>`;
  const uid = auth.currentUser?.uid;
  const hid = getHouseholdId();
  strip.querySelector('.btn-quick-confirm')?.addEventListener('click', e => {
    e.stopPropagation();
    if (!uid) return;
    strip.remove();
    row.classList.remove('needs-review', 'is-uncategorized');
    const catBtn = row.querySelector('.cat-btn');
    if (catBtn) { catBtn.textContent = cat.icon; catBtn.style.setProperty('--cat-bg', cat.color ? cat.color + '28' : 'var(--faint)'); }
    learnMerchant(hid, txnId, sug.catId);
    dbUpdate(`transactions/${hid}/${txnId}`, { category: sug.catId, categorySource: 'manual', needsReview: false });
  });
  strip.querySelector('.btn-quick-change')?.addEventListener('click', e => {
    e.stopPropagation();
    const catBtn = row.querySelector('.cat-btn');
    if (catBtn) catBtn.click();
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
        const confLabel = ` · ${Math.round(t.aiConfidence * 100)}%`;
        suggestionHTML = `
          <div class="sug-strip ai">
            <span class="sug-lbl ai">AI${confLabel}</span>
            <span class="sug-cat">${cat.icon} ${cat.name}</span>
            <button class="btn-quick-confirm" data-id="${id}" data-cat="${t.category}">✓ Confirm</button>
            <button class="btn-quick-change"  data-id="${id}" data-cat="${t.category}">Change</button>
          </div>`;
      } else {
        // Tiered suggestion for truly uncategorized rows
        const sug = suggestCategory(id, t, allRulesSnapshot);
        if (sug) {
          const sugCat    = getCategoryById(sug.catId);
          const parentCat = sugCat.parent ? getCategoryById(sugCat.parent) : null;
          const catLabel  = parentCat ? `${parentCat.icon} ${parentCat.name} › ${sugCat.icon} ${sugCat.name}` : `${sugCat.icon} ${sugCat.name}`;
          const stripCls  = sug.source === 'ai' ? 'ai' : 'heuristic';
          suggestionHTML = `
            <div class="sug-strip ${stripCls}">
              <span class="sug-lbl ${stripCls}">${sugSourceLabel(sug)}</span>
              <span class="sug-cat">${catLabel}</span>
              <button class="btn-quick-confirm" data-id="${id}" data-cat="${sug.catId}">✓ Confirm</button>
              <button class="btn-quick-change"  data-id="${id}" data-cat="${sug.catId}">Change</button>
            </div>`;
        } else {
          const cacheState = _aiSugCache.get(id);
          if (cacheState === false) {
            // AI confirmed no category available
            suggestionHTML = `
              <div class="sug-strip warn">
                <span class="sug-lbl warn">⚠ Uncategorized</span>
                <button class="btn-quick-change" data-id="${id}" data-cat="${t.category}" style="margin-left:auto">Categorize →</button>
              </div>`;
          } else {
            // undefined (not yet tried) or null (in-flight) → show Analyzing
            suggestionHTML = `
              <div class="sug-strip analyzing" id="sug-${id}">
                <span class="sug-lbl analyzing">Analyzing…</span>
              </div>`;
            if (cacheState === undefined) setTimeout(() => fetchAiSuggestion(id, t, uid), 0);
          }
        }
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
      // Immediate DOM update — don't wait for Firebase round-trip
      const item = btn.closest('.txn-item');
      item?.querySelector('.sug-strip')?.remove();
      item?.querySelector('.txn-row')?.classList.remove('needs-review', 'is-uncategorized');
      item?.querySelector('.cat-btn')?.setAttribute('data-cat', catId);
      item?.querySelector('.cat-btn')?.style.setProperty('--cat-bg', cat.color ? cat.color + '28' : 'var(--faint)');
      if (item?.querySelector('.cat-btn')) item.querySelector('.cat-btn').textContent = cat.icon;
      learnMerchant(uid, txnId, catId);
      await dbUpdate(`transactions/${uid}/${txnId}`, {
        category:       catId,
        categorySource: 'manual',
        needsReview:    false,
      });
      const row = item?.querySelector('.txn-row');
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

  // ── Tap anywhere on the suggestion strip (except buttons) to expand full category lineage ──
  el.querySelectorAll('.sug-strip').forEach(strip => {
    strip.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      e.stopPropagation();
      strip.querySelector('.sug-cat')?.classList.toggle('sug-cat-expanded');
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
      const detailCat   = getCategoryById(t.category);
      const detailParent = detailCat.parent ? getCategoryById(detailCat.parent) : null;
      const catDisplay  = detailParent
        ? `${detailParent.icon} ${detailParent.name} › ${detailCat.icon} ${detailCat.name}`
        : `${detailCat.icon} ${detailCat.name}`;

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
          <div class="txn-detail-row">
            <span class="txn-dl">Category</span>
            <span class="txn-dv" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
              <span>${catDisplay}</span>
              ${!isPartner ? `<button class="detail-change-cat btn-ghost" style="font-size:0.78rem;padding:2px 8px">Change</button>` : ''}
            </span>
          </div>
          <div class="txn-detail-row"><span class="txn-dl">Notes</span><span class="txn-dv"><textarea class="txn-notes-input" data-id="${id}" rows="2" placeholder="Add a note…"${isPartner ? ' disabled' : ''}>${t.notes ?? ''}</textarea></span></div>
          <div class="txn-detail-row"><span class="txn-dl">Transfer</span><span class="txn-dv"><label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer"><input type="checkbox" class="txn-transfer-chk" data-id="${id}" ${t.isTransfer ? 'checked' : ''}${isPartner ? ' disabled' : ''}> Mark as inter-account transfer</label></span></div>
        </div>
        ${!isPartner ? `
        <div class="txn-detail-actions">
          <button class="btn-delete-txn">Delete transaction</button>
          <div class="delete-confirm" hidden>
            <span class="delete-confirm-msg">Permanently delete this transaction?</span>
            <button class="btn-delete-confirm">Delete</button>
            <button class="btn-delete-cancel">Cancel</button>
          </div>
          <button class="btn-ai-suggest">✦ Ask AI</button>
          <button class="btn-create-rule">+ Create rule</button>
          <div class="detail-ai-result" hidden></div>
        </div>` : ''}
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

        detail.querySelector('.detail-change-cat')?.addEventListener('click', e2 => {
          e2.stopPropagation();
          openCategoryPicker(id, t.category, uid, item.querySelector('.txn-row'));
        });

        const deleteBtn  = detail.querySelector('.btn-delete-txn');
        const confirmDiv = detail.querySelector('.delete-confirm');
        deleteBtn.addEventListener('click', () => {
          deleteBtn.hidden = true;
          confirmDiv.hidden = false;
        });
        confirmDiv.querySelector('.btn-delete-cancel').addEventListener('click', () => {
          deleteBtn.hidden = false;
          confirmDiv.hidden = true;
        });
        confirmDiv.querySelector('.btn-delete-confirm').addEventListener('click', async () => {
          item.remove();
          detail.remove();
          await dbRemove(`transactions/${uid}/${id}`);
        });

        // ── On-demand AI suggestion ──
        const aiBtn    = detail.querySelector('.btn-ai-suggest');
        const aiResult = detail.querySelector('.detail-ai-result');

        aiBtn.addEventListener('click', async () => {
          aiBtn.disabled = true;
          aiBtn.textContent = 'Thinking…';
          aiResult.hidden = true;

          try {
            const idToken = await auth.currentUser?.getIdToken();
            const confirmedTxns = [...allTxns, ...partnerAllTxns]
              .filter(([, tx]) => tx.category && tx.category !== 'uncategorized' && tx.categorySource !== 'ai')
              .map(([, tx]) => tx);

            const res = await fetch(`${WORKER_URL}/categorize`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
              body:    JSON.stringify({
                txn: t,
                merchantRules: _merchantRules,
                categoryDescriptions: Object.fromEntries(
                  Object.entries(CATEGORY_MAP)
                    .filter(([, c]) => c.parent)
                    .map(([cid, c]) => [cid, _catDescriptions[cid] || c.description || ''])
                ),
                examples: buildExamples(t, confirmedTxns),
              }),
            });

            const result = res.ok ? await res.json() : null;
            const sugCatId = result?.category;
            const sugCat   = sugCatId && sugCatId !== 'uncategorized' ? getCategoryById(sugCatId) : null;

            if (!sugCat || sugCat.id === 'uncategorized') {
              aiResult.hidden = false;
              aiResult.innerHTML = `<span>AI couldn't determine a category for this transaction.</span>
                <button class="btn-ai-keep">OK</button>`;
              aiResult.querySelector('.btn-ai-keep').addEventListener('click', () => {
                aiResult.hidden = true;
                aiBtn.disabled = false;
                aiBtn.textContent = '✦ Ask AI';
              });
            } else {
              const sugParent  = sugCat.parent ? getCategoryById(sugCat.parent) : null;
              const sugDisplay = sugParent
                ? `${sugParent.icon} ${sugParent.name} › ${sugCat.icon} ${sugCat.name}`
                : `${sugCat.icon} ${sugCat.name}`;
              const conf = result.confidence ? ` · ${Math.round(result.confidence * 100)}%` : '';

              aiResult.hidden = false;
              aiResult.innerHTML = `
                <span>AI suggests: <strong>${sugDisplay}</strong>${conf}</span>
                <button class="btn-ai-accept">Accept</button>
                <button class="btn-ai-keep">Keep current</button>`;

              aiResult.querySelector('.btn-ai-accept').addEventListener('click', async () => {
                learnMerchant(uid, id, sugCat.id);
                await dbUpdate(`transactions/${uid}/${id}`, {
                  category:       sugCat.id,
                  group:          sugCat.parent ?? sugCat.id,
                  isFixed:        sugCat.isFixed  ?? false,
                  isAnnual:       sugCat.isAnnual ?? false,
                  categorySource: 'manual',
                  needsReview:    false,
                });
                // Firebase listener will re-render; detail closes naturally
              });

              aiResult.querySelector('.btn-ai-keep').addEventListener('click', () => {
                aiResult.hidden = true;
                aiBtn.disabled = false;
                aiBtn.textContent = '✦ Ask AI';
              });
            }
          } catch {
            aiResult.hidden = false;
            aiResult.innerHTML = `<span>Error calling AI.</span>
              <button class="btn-ai-keep">OK</button>`;
            aiResult.querySelector('.btn-ai-keep').addEventListener('click', () => {
              aiResult.hidden = true;
              aiBtn.disabled = false;
              aiBtn.textContent = '✦ Ask AI';
            });
          }

          if (aiBtn.textContent === 'Thinking…') {
            aiBtn.disabled = false;
            aiBtn.textContent = '✦ Ask AI';
          }
        });

        // ── Create rule from transaction ──
        detail.querySelector('.btn-create-rule')?.addEventListener('click', () => {
          const conditions = [];
          if (t.merchantName?.trim())
            conditions.push({ field: 'merchant',     op: 'contains', value: t.merchantName.trim() });
          if (t.description?.trim())
            conditions.push({ field: 'description',  op: 'contains', value: t.description.trim() });
          if (t.accountName?.trim())
            conditions.push({ field: 'accountName',  op: 'equals',   value: t.accountName.trim() });
          if (!conditions.length)
            conditions.push({ field: 'description',  op: 'contains', value: '' });

          const aiSug   = _aiSugCache.get(id);
          const sugCatId = aiSug?.catId && aiSug.catId !== 'uncategorized' ? aiSug.catId : null;
          const catId    = (t.category && t.category !== 'uncategorized') ? t.category : sugCatId;

          const prefill = { conditions, actionValue: catId, priority: 50 };
          openRuleEditor(uid, null, prefill, catId);
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
        learnMerchant(uid, txnId, btn.dataset.id);
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

async function updateDupBanner(txnEntries, uid) {
  const banner = document.getElementById('dup-banner');
  if (!banner) return;
  if (_dupReviewOverlay) return; // don't update banner while review is open

  // Auto-dismiss pending → settled Plaid pairs (same amount, merchant, within 5 days)
  const clean = s => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const autoDismissed = new Set();
  for (const [pid, pt] of txnEntries) {
    if (!pt.pending || pt.ignored || pt.isTransfer || pt.group === 'transfer') continue;
    const cents = Math.round((pt.amount ?? 0) * 100);
    const nameP = clean(pt.merchantName ?? pt.description);
    if (!nameP) continue;
    const match = txnEntries.find(([sid, st]) => {
      if (sid === pid || st.pending || st.ignored || st.isTransfer) return false;
      if (Math.round((st.amount ?? 0) * 100) !== cents) return false;
      if (Math.abs(new Date(pt.date) - new Date(st.date)) > 5 * 86400000) return false;
      const nameS = clean(st.merchantName ?? st.description);
      return nameS === nameP || nameS.includes(nameP) || nameP.includes(nameS);
    });
    if (match) {
      autoDismissed.add(pid);
      dbUpdate(`transactions/${uid}/${pid}`, { ignored: true }); // fire-and-forget
    }
  }

  const filtered = autoDismissed.size
    ? txnEntries.filter(([id]) => !autoDismissed.has(id))
    : txnEntries;

  _dupPairs = findDuplicates(filtered);
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
    setTimeout(() => {
      overlay.remove();
      updateDupBanner(allTxns, uid); // refresh with fresh dupOk data after review closes
    }, 260);
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

    const isPendingPair = !!a.pending !== !!b.pending;
    const pendingHint = isPendingPair ? `
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:0.78rem;color:#92400e">
        ⏳ <b>Pending → Settled:</b> Same transaction at different stages. Keep the settled version (${a.pending ? 'B' : 'A'}).
      </div>` : '';

    overlay.innerHTML = `
      <div class="sheet" style="max-height:85vh">
        <div class="sheet-handle"></div>
        <div class="sheet-hdr">
          <span class="sheet-title">Duplicate ${idx + 1} of ${pairs.length}</span>
          <button class="sheet-close" id="dc">✕</button>
        </div>
        <div style="padding:12px 16px">
          ${pendingHint}
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
      const normOk = v => Array.isArray(v) ? [...v] : Object.values(v ?? {});
      const okA = normOk(a.dupOk); if (!okA.includes(idB)) okA.push(idB);
      const okB = normOk(b.dupOk); if (!okB.includes(idA)) okB.push(idA);
      try {
        // dbSet on the subpath avoids Firebase update() array serialization issues
        await Promise.all([
          dbSet(`transactions/${uid}/${idA}/dupOk`, okA),
          dbSet(`transactions/${uid}/${idB}/dupOk`, okB),
        ]);
      } catch (err) {
        console.error('dupOk write failed:', err);
      }
      idx++;
      if (idx >= pairs.length) { close(); } else { renderPair(); }
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
