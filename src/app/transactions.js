import { dbListen, dbGet, dbUpdate, auth, getPartnerUid } from '../shared/firebase.js';
import { fmtCurrency, fmtDate }     from '../shared/format.js';
import {
  getCategoryById,
  getRootCategories,
  getChildCategories,
} from '../shared/categories.js';

const PAGE_SIZE = 100;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function blankState() {
  return {
    query:         '',
    dateMode:      'all',
    year:          new Date().getFullYear(),
    month:         new Date().getMonth() + 1,
    dateFrom:      '',
    dateTo:        '',
    type:          'all',
    amtMin:        '',
    amtMax:        '',
    groups:        [],
    cats:          [],
    accounts:      [],
    review:        false,
    pending:       false,
    hideTransfers: true,
    page:          0,
  };
}

let allTxns        = [];
let partnerAllTxns = [];
let partnerInitial = 'P';
let accountMap     = {};

function getSourceBadge(source) {
  const map = {
    ai:     { bg: '#dbeafe', color: '#1d4ed8', text: 'AI' },
    rule:   { bg: '#dcfce7', color: '#15803d', text: 'Rule' },
    import: { bg: '#fef9c3', color: '#854d0e', text: 'Import' },
    tiller: { bg: '#fef9c3', color: '#854d0e', text: 'Import' },
    manual: { bg: '#f3e8ff', color: '#7e22ce', text: 'Manual' },
    plaid:  { bg: '#f1f5f9', color: '#475569', text: 'Plaid' },
  };
  const s = map[source] ?? { bg: '#f1f5f9', color: '#475569', text: source ?? '—' };
  return `<span style="background:${s.bg};color:${s.color};border-radius:20px;padding:2px 8px;font-size:0.75rem;font-weight:600">${s.text}</span>`;
}

export function renderTransactions(container) {
  if (!document.getElementById('txn-detail-styles')) {
    const style = document.createElement('style');
    style.id = 'txn-detail-styles';
    style.textContent = `
      .txn-detail { padding: 0.75rem 1rem; background: #f8fafc; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
      .txn-detail-grid { display: grid; gap: 0.35rem; }
      .txn-detail-row { display: flex; gap: 0.5rem; align-items: flex-start; }
      .txn-dl { color: var(--muted); min-width: 110px; flex-shrink: 0; font-size: 0.8rem; padding-top: 2px; }
      .txn-dv { color: var(--text); flex: 1; }
      .txn-notes-input { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 0.85rem; resize: vertical; font-family: inherit; }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div class="page transactions">
      <div class="toolbar">
        <input type="search" id="txn-search" placeholder="Search…" />
        <button class="btn-ghost filter-toggle" id="filter-toggle">
          Filters <span class="filter-badge" id="filter-badge" style="display:none"></span>
        </button>
      </div>
      <div class="filter-panel" id="filter-panel"></div>
      <div id="txn-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  partnerAllTxns = [];
  partnerInitial = 'P';

  const state = blankState();
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
    const panel = document.getElementById('filter-panel');
    if (!filterPanelRendered) {
      renderFilterPanel(state, accountMap, refresh);
      filterPanelRendered = true;
    }
    panel.classList.toggle('open');
  });
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

  // Build combined accounts list: Plaid accounts + Tiller accounts from transactions
  const plaidAccounts = Object.entries(accountMap)
    .filter(([, a]) => !a.isManual)
    .map(([id, a]) => ({ key: id, name: a.name }));

  const plaidNames       = new Set(plaidAccounts.map(a => a.name));
  const tillerNamesSeen  = new Set();
  allTxns.forEach(([, t]) => {
    if ((t.source === 'tiller' || t.categorySource === 'import') && t.accountName && !plaidNames.has(t.accountName)) {
      tillerNamesSeen.add(t.accountName);
    }
  });
  const tillerAccounts   = [...tillerNamesSeen].map(name => ({ key: name, name }));
  const combinedAccounts = [...plaidAccounts, ...tillerAccounts];
  const hasAccounts      = combinedAccounts.length > 0;

  const accountSection = hasAccounts ? `
    <div class="filter-section">
      <span class="filter-label">Account</span>
      <div class="pill-group" id="f-accounts">
        ${combinedAccounts.map(acc => `
          <button class="pill${state.accounts.includes(acc.key) ? ' active' : ''}" data-account="${acc.key}">
            ${acc.name}
          </button>`).join('')}
      </div>
    </div>` : '';

  panel.innerHTML = `
    <div class="filter-section">
      <span class="filter-label">Date</span>
      <div class="seg-ctrl">
        <button class="seg${state.dateMode === 'all'   ? ' active' : ''}" data-mode="all">All</button>
        <button class="seg${state.dateMode === 'month' ? ' active' : ''}" data-mode="month">Month</button>
        <button class="seg${state.dateMode === 'range' ? ' active' : ''}" data-mode="range">Range</button>
      </div>
      <div id="date-month-row" style="${state.dateMode !== 'month' ? 'display:none' : ''}">
        <select id="f-month">${monthOptions}</select>
        <select id="f-year">${yearOptions}</select>
      </div>
      <div id="date-range-row" style="${state.dateMode !== 'range' ? 'display:none' : ''}">
        <input type="date" id="f-from" value="${state.dateFrom}">
        <input type="date" id="f-to"   value="${state.dateTo}">
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
          <div style="display:flex;gap:0.5rem">
            <input type="number" id="f-amt-min" placeholder="Min $" value="${state.amtMin}" style="width:80px">
            <input type="number" id="f-amt-max" placeholder="Max $" value="${state.amtMax}" style="width:80px">
          </div>
        </div>
      </div>
    </div>

    <div class="filter-section">
      <span class="filter-label">Category</span>
      <div class="pill-group" id="f-groups">${groupPills}</div>
      <div id="f-leaves" class="f-leaf-section" style="${state.groups.length === 0 ? 'display:none' : ''}"></div>
    </div>

    ${accountSection}

    <div class="filter-section">
      <span class="filter-label">Status</span>
      <label class="f-check">
        <input type="checkbox" id="f-review" ${state.review ? 'checked' : ''}> Needs review
      </label>
      <label class="f-check">
        <input type="checkbox" id="f-pending" ${state.pending ? 'checked' : ''}> Pending
      </label>
      <label class="f-check">
        <input type="checkbox" id="f-transfers" ${state.hideTransfers ? 'checked' : ''}> Hide transfers
      </label>
    </div>

    <div class="filter-section">
      <button class="btn-ghost" id="f-clear">Clear filters</button>
    </div>
  `;

  if (state.groups.length > 0) updateLeafSection(state, refresh);

  panel.querySelectorAll('.seg[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.dateMode = btn.dataset.mode;
      state.page     = 0;
      panel.querySelectorAll('.seg[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.dateMode));
      document.getElementById('date-month-row').style.display = state.dateMode === 'month' ? '' : 'none';
      document.getElementById('date-range-row').style.display = state.dateMode === 'range' ? '' : 'none';
      refresh();
    });
  });

  document.getElementById('f-month').addEventListener('change', e => {
    state.month = Number(e.target.value);
    state.page  = 0;
    refresh();
  });

  document.getElementById('f-year').addEventListener('change', e => {
    state.year = Number(e.target.value);
    state.page = 0;
    refresh();
  });

  document.getElementById('f-from').addEventListener('change', e => {
    state.dateFrom = e.target.value;
    state.page     = 0;
    refresh();
  });

  document.getElementById('f-to').addEventListener('change', e => {
    state.dateTo = e.target.value;
    state.page   = 0;
    refresh();
  });

  panel.querySelectorAll('.seg[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type;
      state.page = 0;
      panel.querySelectorAll('.seg[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === state.type));
      refresh();
    });
  });

  document.getElementById('f-amt-min').addEventListener('input', e => {
    state.amtMin = e.target.value;
    state.page   = 0;
    refresh();
  });

  document.getElementById('f-amt-max').addEventListener('input', e => {
    state.amtMax = e.target.value;
    state.page   = 0;
    refresh();
  });

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

  if (hasAccounts) {
    panel.querySelector('#f-accounts').addEventListener('click', e => {
      const btn = e.target.closest('.pill[data-account]');
      if (!btn) return;
      const aid = btn.dataset.account;
      if (state.accounts.includes(aid)) {
        state.accounts = state.accounts.filter(a => a !== aid);
      } else {
        state.accounts = [...state.accounts, aid];
      }
      btn.classList.toggle('active', state.accounts.includes(aid));
      state.page = 0;
      refresh();
    });
  }

  document.getElementById('f-review').addEventListener('change', e => {
    state.review = e.target.checked;
    state.page   = 0;
    refresh();
  });

  document.getElementById('f-pending').addEventListener('change', e => {
    state.pending = e.target.checked;
    state.page    = 0;
    refresh();
  });

  document.getElementById('f-transfers').addEventListener('change', e => {
    state.hideTransfers = e.target.checked;
    state.page          = 0;
    refresh();
  });

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

function applyFilters(txns, state) {
  return txns.filter(([, t]) => {
    if (state.hideTransfers && (t.isTransfer || t.group === 'transfer')) return false;

    if (state.query) {
      const q = state.query;
      if (
        !t.description?.toLowerCase().includes(q) &&
        !t.merchantName?.toLowerCase().includes(q) &&
        !t.notes?.toLowerCase().includes(q)
      ) return false;
    }

    if (state.dateMode === 'month') {
      if (state.month === 0) {
        if (!t.date?.startsWith(String(state.year))) return false;
      } else {
        const prefix = `${state.year}-${String(state.month).padStart(2, '0')}`;
        if (!t.date?.startsWith(prefix)) return false;
      }
    }

    if (state.dateMode === 'range') {
      if (state.dateFrom && t.date < state.dateFrom) return false;
      if (state.dateTo   && t.date > state.dateTo)   return false;
    }

    if (state.type === 'expense' && t.amount <= 0) return false;
    if (state.type === 'income'  && t.amount >= 0) return false;

    if (state.amtMin && Math.abs(t.amount) < Number(state.amtMin)) return false;
    if (state.amtMax && Math.abs(t.amount) > Number(state.amtMax)) return false;

    if (state.groups.length > 0 && !state.groups.includes(t.group))    return false;
    if (state.cats.length   > 0 && !state.cats.includes(t.category))   return false;

    if (state.accounts.length > 0 &&
        !(state.accounts.includes(t.accountId) || state.accounts.includes(t.accountName))) return false;

    if (state.review  && !needsReview(t))    return false;
    if (state.pending && t.pending !== true) return false;

    return true;
  });
}

function countActive(state) {
  let count = 0;
  if (state.dateMode !== 'all')       count++;
  if (state.type !== 'all')           count++;
  if (state.amtMin || state.amtMax)   count++;
  if (state.groups.length > 0)        count++;
  if (state.accounts.length > 0)      count++;
  if (state.review)                   count++;
  if (state.pending)                  count++;
  return count;
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
    const cat       = getCategoryById(t.category);
    const review    = needsReview(t);
    const isPartner = !!t._owner;
    const acctName  = t.accountName || accountMap[t.accountId]?.name || '';
    const partnerBadge = isPartner
      ? `<span style="background:#dbeafe;color:#1e40af;border-radius:10px;padding:1px 6px;font-size:0.7rem;font-weight:700">${partnerInitial}</span>`
      : '';
    const acctHTML = acctName
      ? `<span class="txn-acct" style="font-size:0.75rem;color:var(--muted);display:block;margin-top:1px">${acctName} ${partnerBadge}</span>`
      : (isPartner ? `<span class="txn-acct" style="font-size:0.75rem;color:var(--muted);display:block;margin-top:1px">${partnerBadge}</span>` : '');
    return `
      <div class="txn-row${review ? ' needs-review' : ''}" data-id="${id}">
        <button class="txn-icon cat-btn" title="Change category" data-id="${id}" data-cat="${t.category}"${isPartner ? ' disabled' : ''}>${cat.icon}</button>
        <div class="txn-meta">
          <span class="txn-desc">${t.merchantName ?? t.description}</span>
          <span class="txn-date">${fmtDate(t.date)} · <span class="cat-tag" style="color:${cat.color}">${cat.name}</span>${review ? ' <span class="review-tag">· revisar</span>' : ''}</span>
          ${acctHTML}
        </div>
        <span class="txn-amount ${t.amount < 0 ? 'income' : ''}">${t.amount < 0 ? '−' : ''}${fmtCurrency(Math.abs(t.amount))}</span>
      </div>`;
  }).join('');

  const paginationHTML = total > PAGE_SIZE ? `
    <div class="pagination">
      <button class="btn-ghost page-btn" data-p="${page - 1}" ${page === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="page-info">Page ${page + 1} of ${totalPages}</span>
      <button class="btn-ghost page-btn" data-p="${page + 1}" ${page === totalPages - 1 ? 'disabled' : ''}>Next →</button>
    </div>` : '';

  el.innerHTML = `
    <div class="txn-summary">${total.toLocaleString()} transactions · showing ${start + 1}–${end}</div>
    <div class="card-rows">${rows}</div>
    ${paginationHTML}
  `;

  el.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => openCategoryPicker(btn.dataset.id, btn.dataset.cat, uid));
  });

  el.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.page = Number(btn.dataset.p);
      refresh();
    });
  });

  el.querySelectorAll('.txn-row').forEach(row => {
    const id    = row.dataset.id;
    const entry = slice.find(([sid]) => sid === id);
    if (!entry) return;
    const [, t] = entry;

    row.addEventListener('click', e => {
      if (e.target.closest('.cat-btn')) return;

      const existingDetail = document.querySelector('.txn-detail');
      if (existingDetail) {
        const wasThisRow = existingDetail.previousElementSibling === row;
        existingDetail.remove();
        if (wasThisRow) return;
      }

      const isPartner       = !!t._owner;
      const accountName     = t.accountName || accountMap[t.accountId]?.name || '—';
      const sourceBadgeHTML = getSourceBadge(t.categorySource);

      const detail = document.createElement('div');
      detail.className = 'txn-detail';
      detail.innerHTML = `
        <div class="txn-detail-grid">
          <div class="txn-detail-row"><span class="txn-dl">Description</span><span class="txn-dv">${t.description}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Original</span><span class="txn-dv">${t.fullDescription ?? t.originalDescription ?? '—'}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Account</span><span class="txn-dv">${accountName}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Date</span><span class="txn-dv">${t.date}</span></div>
          <div class="txn-detail-row"><span class="txn-dl">Source</span><span class="txn-dv">${sourceBadgeHTML}</span></div>
          ${t.aiConfidence != null ? `<div class="txn-detail-row"><span class="txn-dl">AI confidence</span><span class="txn-dv">${Math.round(t.aiConfidence * 100)}%</span></div>` : ''}
          ${t.plaidCategory ? `<div class="txn-detail-row"><span class="txn-dl">Plaid category</span><span class="txn-dv">${t.plaidCategory}</span></div>` : ''}
          <div class="txn-detail-row"><span class="txn-dl">Notes</span><span class="txn-dv"><textarea class="txn-notes-input" data-id="${id}" rows="2" placeholder="Add a note…"${isPartner ? ' disabled' : ''}>${t.notes ?? ''}</textarea></span></div>
          <div class="txn-detail-row"><span class="txn-dl">Transfer</span><span class="txn-dv"><label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer"><input type="checkbox" class="txn-transfer-chk" data-id="${id}" ${t.isTransfer ? 'checked' : ''}${isPartner ? ' disabled' : ''}> Mark as inter-account transfer (excluded from spending)</label></span></div>
        </div>
      `;

      row.insertAdjacentElement('afterend', detail);

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

function needsReview(t) {
  return t.needsReview === true || t.category === 'uncategorized' || (t.aiConfidence != null && t.aiConfidence < 0.75);
}

function openCategoryPicker(txnId, currentCat, uid) {
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
              ${c.isFixed ? '<span class="leaf-badge">Fijo</span>' : ''}
              ${c.isAnnual ? '<span class="leaf-badge annual">Anual</span>' : ''}
            </button>`).join('')}
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:1rem">
          <button class="btn-ghost modal-cancel" style="flex:1">Cancelar</button>
          <button class="btn-secondary modal-rule" style="flex:1">+ Regla</button>
        </div>
      </div>
    `;

    modal.querySelector('.picker-back-btn').addEventListener('click', renderGroupStep);
    modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-rule').addEventListener('click', () => {
      const t = allTxns.find(([id]) => id === txnId)?.[1];
      if (t && (t.merchantName || t.description)) {
        sessionStorage.setItem('pendingRule', JSON.stringify({
          matchValue: t.merchantName ?? t.description,
          name: `${t.merchantName ?? t.description} → category`,
        }));
      }
      modal.remove();
      location.hash = '#settings';
    });

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
      });
    });

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  renderGroupStep();
}
