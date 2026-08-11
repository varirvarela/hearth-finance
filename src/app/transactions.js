import { dbListen, dbUpdate, auth } from '../shared/firebase.js';
import { fmtCurrency, fmtDate }     from '../shared/format.js';
import {
  CATEGORIES,
  getCategoryById,
  getRootCategories,
  getChildCategories,
} from '../shared/categories.js';

export function renderTransactions(container) {
  container.innerHTML = `
    <div class="page transactions">
      <div class="toolbar">
        <input type="search" id="txn-search" placeholder="Search…" />
        <select id="txn-cat-filter">
          <option value="">All</option>
          <option value="__review__">⚠ Needs review</option>
          ${getRootCategories().map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
        </select>
      </div>
      <div id="txn-list"></div>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let allTxns = [];

  const refresh = () => {
    const query     = document.getElementById('txn-search').value.toLowerCase();
    const catFilter = document.getElementById('txn-cat-filter').value;

    const filtered = allTxns.filter(([, t]) => {
      if (catFilter === '__review__') {
        if (!needsReview(t)) return false;
      } else if (catFilter) {
        // Filter by group (denormalized) or by the category itself
        if (t.group !== catFilter && t.category !== catFilter) return false;
      }
      if (query && !t.description?.toLowerCase().includes(query) && !t.merchantName?.toLowerCase().includes(query)) return false;
      return true;
    });
    renderList(filtered, uid);
  };

  dbListen(`transactions/${uid}`, txns => {
    allTxns = Object.entries(txns ?? {}).sort((a, b) => b[1].date.localeCompare(a[1].date));
    refresh();
  });

  document.getElementById('txn-search').addEventListener('input', refresh);
  document.getElementById('txn-cat-filter').addEventListener('change', refresh);
}

function needsReview(t) {
  return t.needsReview === true || t.category === 'uncategorized' || (t.aiConfidence != null && t.aiConfidence < 0.75);
}

function renderList(entries, uid) {
  const el = document.getElementById('txn-list');
  if (!entries.length) {
    el.innerHTML = `<div class="empty"><span class="empty-icon">🔍</span><span>No transactions found.</span></div>`;
    return;
  }

  const rows = entries.map(([id, t]) => {
    const cat    = getCategoryById(t.category);
    const review = needsReview(t);
    return `
      <div class="txn-row${review ? ' needs-review' : ''}" data-id="${id}">
        <button class="txn-icon cat-btn" title="Change category" data-id="${id}" data-cat="${t.category}">${cat.icon}</button>
        <div class="txn-meta">
          <span class="txn-desc">${t.merchantName ?? t.description}</span>
          <span class="txn-date">${fmtDate(t.date)} · <span class="cat-tag" style="color:${cat.color}">${cat.name}</span>${review ? ' <span class="review-tag">· revisar</span>' : ''}</span>
        </div>
        <span class="txn-amount ${t.amount < 0 ? 'income' : ''}">${t.amount < 0 ? '−' : ''}${fmtCurrency(Math.abs(t.amount))}</span>
      </div>`;
  }).join('');

  el.innerHTML = `<div class="card-rows">${rows}</div>`;

  el.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => openCategoryPicker(btn.dataset.id, btn.dataset.cat, uid));
  });
}

// ── Two-step category picker ─────────────────────────────────────────────────

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
    modal.querySelector('.modal-rule').addEventListener('click', () => { modal.remove(); /* TODO: open rule builder */ });

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
