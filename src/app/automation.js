import { dbListen, dbSet, dbPush, dbRemove, dbUpdate, dbGet, auth, getHouseholdId } from '../shared/firebase.js';
import { CATEGORIES, getCategoryById, getCategoryBudgetFields } from '../shared/categories.js';
import { buildRule, evaluateRules } from '../shared/rules.js';
import { fmtCurrency } from '../shared/format.js';

export function renderAutomation(container) {
  const uid = auth.currentUser?.uid;
  const hid = getHouseholdId();

  container.innerHTML = `
    <div class="page automation">
      <div class="auto-header">
        <h2 class="page-title" style="margin-bottom:0">Automation</h2>
        <div id="auto-stats" class="auto-stats"></div>
      </div>

      <div class="auto-toolbar">
        <input id="auto-search" class="auto-search" type="search" placeholder="Search merchant or pattern…" />
        <button class="btn-primary auto-add-btn" id="auto-add-rule">+ Rule</button>
      </div>

      <div class="auto-sort-bar">
        Sort: <span class="auto-sort-label">By category</span>
        &nbsp;·&nbsp;
        <button class="btn-apply-rules" id="auto-apply-rules">Re-apply all rules to transactions</button>
      </div>

      <div id="auto-rules-list"></div>

      <div class="auto-footer-link">
        <a href="#settings" id="auto-settings-link">Other settings (import, partner, recurring) →</a>
      </div>

      <div class="auto-recurring-section section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <h3 style="margin:0">Recurring Transactions</h3>
          <button class="btn-secondary" id="auto-add-recurring" style="width:auto;padding:0.4rem 0.9rem;font-size:0.82rem">+ Add</button>
        </div>
        <div id="auto-recurring-list"></div>
        <div style="margin-top:0.75rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
          <select id="auto-recurring-month" style="border:1.5px solid var(--border);border-radius:8px;padding:0.45rem 0.6rem;font-size:0.9rem;background:var(--surface);color:var(--text)"></select>
          <button class="btn-primary" id="auto-generate-recurring" style="width:auto;padding:0.5rem 1rem">Generate</button>
          <span id="auto-generate-status" style="font-size:0.85rem;color:var(--muted)"></span>
        </div>
      </div>
    </div>
  `;

  if (!uid) return;

  let allRules = {};
  let searchQuery = '';

  container.querySelector('#auto-settings-link').addEventListener('click', e => {
    e.preventDefault();
    location.hash = 'settings';
  });

  container.querySelector('#auto-add-rule').addEventListener('click', () => openRuleEditor(hid));

  container.querySelector('#auto-search').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderRulesList(hid, allRules, searchQuery, selectedCatId);
  });

  container.querySelector('#auto-apply-rules').addEventListener('click', () => applyAllRules(hid, allRules));

  dbListen(`rules/${hid}`, rules => {
    allRules = rules ?? {};
    renderStats(container, allRules);
    renderRulesList(hid, allRules, searchQuery, selectedCatId);
  });

  dbListen(`recurring/${hid}`, items => renderRecurring(items ?? {}, hid));
  populateMonthSelect();

  container.querySelector('#auto-add-recurring').addEventListener('click', () => openRecurringEditor(hid));
  container.querySelector('#auto-generate-recurring').addEventListener('click', () => {
    const yearMonth = document.getElementById('auto-recurring-month').value;
    generateForMonth(hid, yearMonth);
  });
}

function renderStats(container, rules) {
  const entries = Object.values(rules);
  const total   = entries.length;
  const active  = entries.filter(r => r.enabled !== false).length;
  const paused  = total - active;
  const el = container.querySelector('#auto-stats');
  if (!el) return;
  el.textContent = paused > 0
    ? `${active} active · ${paused} paused`
    : `${total} rule${total !== 1 ? 's' : ''}`;
}

function renderRulesList(uid, rules, query, selectedCatId) {
  const listEl = document.getElementById('auto-rules-list');
  if (!listEl) return;

  // Apply search filter across all rules
  const allEntries = Object.entries(rules);
  const filtered = query
    ? allEntries.filter(([, r]) =>
        r.matchValue?.toLowerCase().includes(query) ||
        r.name?.toLowerCase().includes(query) ||
        getCategoryById(r.actionValue)?.name?.toLowerCase().includes(query)
      )
    : allEntries;

  if (!allEntries.length) {
    listEl.innerHTML = `
      <div class="auto-empty">
        <div class="auto-empty-icon">⚙</div>
        <div>No rules yet.</div>
        <div style="font-size:0.8rem;color:var(--muted);margin-top:4px">Rules automatically categorize transactions as they arrive.</div>
      </div>`;
    return;
  }

  // Group by target category
  const byCat = new Map();
  for (const [id, r] of filtered) {
    const catId = r.actionValue ?? 'uncategorized';
    if (!byCat.has(catId)) byCat.set(catId, []);
    byCat.get(catId).push([id, r]);
  }

  if (!byCat.size) {
    listEl.innerHTML = `<div class="auto-empty"><div>No rules match "${query}".</div></div>`;
    return;
  }

  // ── CATEGORY DETAIL VIEW ──────────────────────────────────
  if (selectedCatId && byCat.has(selectedCatId)) {
    const cat      = getCategoryById(selectedCatId);
    const catRules = byCat.get(selectedCatId);

    // Group rules by matchField
    const byField = new Map();
    const FIELD_LABELS = {
      description: 'Description',
      merchant:    'Merchant Name',
      accountName: 'Account Name',
      amount:      'Amount',
      source:      'Source',
    };
    for (const [id, r] of catRules) {
      const field = r.matchField ?? 'description';
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field).push([id, r]);
    }

    let html = `
      <div class="auto-cat-detail-hdr">
        <button class="auto-back-btn" id="auto-back-btn">← All categories</button>
        <div class="auto-cat-detail-title">
          <span class="auto-cat-detail-icon">${cat.icon}</span>
          <span>${cat.name}</span>
          <span class="auto-group-count">${catRules.length}</span>
        </div>
        <button class="btn-primary auto-add-btn" id="auto-add-cat-rule" style="font-size:0.75rem;padding:4px 12px" data-cat="${selectedCatId}">+ Add rule</button>
      </div>`;

    for (const [field, fieldRules] of byField) {
      const label = FIELD_LABELS[field] ?? field;
      html += `
        <div class="auto-field-group">
          <div class="auto-field-group-hdr">${label}</div>
          <div class="auto-field-rules">
            ${fieldRules.sort((a, b) => (a[1].priority ?? 50) - (b[1].priority ?? 50)).map(([id, r]) => `
              <div class="auto-rule-card ${r.enabled !== false ? '' : 'is-paused'}">
                <div class="auto-rule-when">
                  <span class="auto-rule-op">${r.matchOp ?? 'contains'}</span>
                  <span class="auto-rule-pattern">"${escHtml(r.matchValue ?? '')}"</span>
                </div>
                <div class="auto-rule-meta">
                  <span class="auto-rule-priority">p${r.priority ?? 50}</span>
                  <div class="auto-rule-actions">
                    <button class="auto-rule-edit auto-link-btn" data-id="${id}">Edit</button>
                    <button class="auto-rule-delete auto-link-btn" data-id="${id}" style="color:var(--danger,#dc2626)">✕</button>
                    <div class="auto-rule-toggle ${r.enabled !== false ? 'is-on' : ''}" data-id="${id}"></div>
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </div>`;
    }

    listEl.innerHTML = html;

    // Wire back button
    listEl.querySelector('#auto-back-btn').addEventListener('click', () => {
      selectedCatId = null;
      renderRulesList(uid, rules, query, null);
    });

    // Wire add rule for this category
    listEl.querySelector('#auto-add-cat-rule')?.addEventListener('click', e => {
      openRuleEditor(uid, null, null, e.currentTarget.dataset.cat);
    });

    // Wire toggles, edits, deletes
    listEl.querySelectorAll('.auto-rule-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const current = toggle.classList.contains('is-on');
        toggle.classList.toggle('is-on', !current);
        dbSet(`rules/${uid}/${toggle.dataset.id}/enabled`, !current);
      });
    });
    listEl.querySelectorAll('.auto-rule-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const rule = allRulesRef[btn.dataset.id];
        if (rule) openRuleEditor(uid, btn.dataset.id, rule);
      });
    });
    listEl.querySelectorAll('.auto-rule-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this rule?')) dbRemove(`rules/${uid}/${btn.dataset.id}`);
      });
    });
    allRulesRef = rules;
    return;
  }

  // ── TILES GRID VIEW ──────────────────────────────────────
  const sortedCats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);

  const tilesHtml = sortedCats.map(([catId, catRules]) => {
    const cat    = getCategoryById(catId);
    const total  = catRules.length;
    const active = catRules.filter(([, r]) => r.enabled !== false).length;
    const paused = total - active;
    const fields = [...new Set(catRules.map(([, r]) => r.matchField ?? 'description'))];
    const fieldLabels = { description: 'desc', merchant: 'merchant', accountName: 'account', amount: 'amount', source: 'source' };
    const fieldBadges = fields.map(f => `<span class="auto-field-badge">${fieldLabels[f] ?? f}</span>`).join('');

    return `
      <div class="auto-cat-tile" data-cat="${catId}" role="button" tabindex="0">
        <div class="auto-cat-tile-top">
          <span class="auto-cat-tile-icon">${cat.icon}</span>
          ${paused > 0 ? `<span class="auto-paused-badge">${paused} paused</span>` : ''}
        </div>
        <div class="auto-cat-tile-name">${cat.name}</div>
        <div class="auto-cat-tile-count">${total} rule${total !== 1 ? 's' : ''}</div>
        <div class="auto-cat-tile-fields">${fieldBadges}</div>
      </div>`;
  }).join('');

  listEl.innerHTML = `<div class="auto-tiles-grid">${tilesHtml}</div>`;

  // Wire tile clicks
  listEl.querySelectorAll('.auto-cat-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      selectedCatId = tile.dataset.cat;
      renderRulesList(uid, rules, query, selectedCatId);
    });
  });
  allRulesRef = rules;
}

let allRulesRef = {};
let selectedCatId = null;

function renderRuleCard(id, rule, cat) {
  const enabled   = rule.enabled !== false;
  const matchCnt  = rule.matchCount ?? null;
  const countHtml = matchCnt != null ? `· ${matchCnt} match${matchCnt !== 1 ? 'es' : ''}` : '';
  const pri       = rule.priority ?? 50;

  return `
    <div class="auto-rule-card ${enabled ? '' : 'is-paused'}">
      <div class="auto-rule-when">
        <span class="auto-rule-field">${rule.matchField ?? 'description'}</span>
        <span class="auto-rule-op">${rule.matchOp ?? 'contains'}</span>
        <span class="auto-rule-pattern">"${escHtml(rule.matchValue ?? '')}"</span>
      </div>
      <div class="auto-rule-then">
        <span class="auto-rule-arrow">→</span>
        <span class="auto-cat-icon">${cat.icon}</span>
        <span class="auto-cat-name">${cat.name}</span>
      </div>
      <div class="auto-rule-meta">
        <span class="auto-rule-priority">Priority ${pri} ${countHtml}</span>
        <div class="auto-rule-actions">
          <button class="auto-rule-edit auto-link-btn" data-id="${id}">Edit</button>
          <button class="auto-rule-delete auto-link-btn" data-id="${id}" style="color:var(--danger,#dc2626)">✕</button>
          <div class="auto-rule-toggle ${enabled ? 'is-on' : ''}" data-id="${id}" title="${enabled ? 'Pause rule' : 'Enable rule'}"></div>
        </div>
      </div>
    </div>`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openRuleEditor(uid, ruleId = null, prefill = null, prefillCatId = null) {
  const isEdit   = ruleId != null;
  const expCats  = CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer' && c.parent);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const catOptions = expCats.map(c =>
    `<option value="${c.id}" ${(prefill?.actionValue ?? prefillCatId) === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
  ).join('');

  const selField = prefill?.matchField ?? 'description';
  const selOp    = prefill?.matchOp    ?? 'contains';
  const selPri   = prefill?.priority   ?? 50;

  modal.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit Rule' : 'New Rule'}</h3>

      <label class="modal-label">When</label>
      <div class="rule-editor-row">
        <select id="re-field" class="rule-editor-sel">
          <option value="description"  ${selField === 'description'  ? 'selected' : ''}>description</option>
          <option value="merchant"     ${selField === 'merchant'     ? 'selected' : ''}>merchant name</option>
          <option value="accountName"  ${selField === 'accountName'  ? 'selected' : ''}>account name</option>
          <option value="amount"       ${selField === 'amount'       ? 'selected' : ''}>amount ($)</option>
          <option value="source"       ${selField === 'source'       ? 'selected' : ''}>source</option>
        </select>
        <select id="re-op" class="rule-editor-sel">
          <option value="contains"   ${selOp === 'contains'   ? 'selected' : ''}>contains</option>
          <option value="startsWith" ${selOp === 'startsWith' ? 'selected' : ''}>starts with</option>
          <option value="equals"     ${selOp === 'equals'     ? 'selected' : ''}>equals</option>
          <option value="gt"         ${selOp === 'gt'         ? 'selected' : ''}>greater than</option>
          <option value="lt"         ${selOp === 'lt'         ? 'selected' : ''}>less than</option>
        </select>
      </div>
      <input id="re-value" class="rule-editor-input" type="text" placeholder="Merchant name or pattern…" value="${escHtml(prefill?.matchValue ?? '')}" />

      <label class="modal-label" style="margin-top:1rem">Then categorize as</label>
      <select id="re-cat" class="rule-editor-sel" style="width:100%">${catOptions}</select>

      <label class="modal-label" style="margin-top:1rem">Priority</label>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <label class="rule-pri-option ${selPri <= 30 ? 'is-selected' : ''}" id="re-pri-auto-lbl">
          <input type="radio" name="re-pri" id="re-pri-auto" value="30" ${selPri <= 30 ? 'checked' : ''} style="display:none"/>
          <div class="rule-pri-label">Auto</div>
          <div class="rule-pri-sub">Priority 30</div>
        </label>
        <label class="rule-pri-option ${selPri > 30 ? 'is-selected' : ''}" id="re-pri-custom-lbl">
          <input type="radio" name="re-pri" id="re-pri-custom" value="custom" ${selPri > 30 ? 'checked' : ''} style="display:none"/>
          <div class="rule-pri-label">Custom</div>
          <input id="re-pri-val" class="rule-editor-input" type="number" min="1" max="100" value="${selPri}" style="margin-top:4px;padding:4px 8px;font-size:0.8rem" ${selPri <= 30 ? 'disabled' : ''}/>
        </label>
      </div>

      <div class="rule-preview" id="re-preview"></div>

      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-save" style="flex:1">${isEdit ? 'Save Changes' : 'Save Rule'} →</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const fieldEl = modal.querySelector('#re-field');
  const opEl    = modal.querySelector('#re-op');
  const valEl   = modal.querySelector('#re-value');
  const catEl   = modal.querySelector('#re-cat');
  const priAutoEl   = modal.querySelector('#re-pri-auto');
  const priCustomEl = modal.querySelector('#re-pri-custom');
  const priValEl    = modal.querySelector('#re-pri-val');
  const previewEl   = modal.querySelector('#re-preview');

  const updatePreview = () => {
    const cat = getCategoryById(catEl.value);
    previewEl.innerHTML = `
      <span class="rule-preview-label">Preview</span>
      When <strong>${fieldEl.value}</strong> ${opEl.value} <strong>"${escHtml(valEl.value || '…')}"</strong><br>
      → Set category to <strong>${cat.icon} ${cat.name}</strong>
    `;
  };

  [fieldEl, opEl, valEl, catEl].forEach(el => el.addEventListener('input', updatePreview));
  updatePreview();

  // Priority radio toggle styling
  [priAutoEl, priCustomEl].forEach(radio => {
    radio.addEventListener('change', () => {
      modal.querySelector('#re-pri-auto-lbl').classList.toggle('is-selected', priAutoEl.checked);
      modal.querySelector('#re-pri-custom-lbl').classList.toggle('is-selected', priCustomEl.checked);
      priValEl.disabled = priAutoEl.checked;
    });
  });

  modal.querySelector('.modal-save').addEventListener('click', async () => {
    const matchValue = valEl.value.trim();
    if (!matchValue) { valEl.focus(); return; }

    const priority = priAutoEl.checked ? 30 : Math.max(1, Math.min(100, parseInt(priValEl.value, 10) || 30));
    const catId    = catEl.value;
    const cat      = getCategoryById(catId);

    const rule = buildRule({
      name:       `${matchValue} → ${cat.name}`,
      matchField: fieldEl.value,
      matchOp:    opEl.value,
      matchValue,
      categoryId: catId,
      priority,
    });

    if (isEdit) {
      await dbSet(`rules/${uid}/${ruleId}`, { ...rule, createdAt: prefill.createdAt ?? Date.now() });
    } else {
      await dbPush(`rules/${uid}`, rule);
    }
    modal.remove();
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  valEl.focus();
}

async function applyAllRules(uid, rules) {
  const btn = document.getElementById('auto-apply-rules');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Applying…';

  const txns = await dbGet(`transactions/${uid}`);
  if (!txns) {
    btn.disabled = false;
    btn.textContent = 'Re-apply all rules to transactions';
    return;
  }

  const patch = {};
  let count = 0;

  for (const [txnId, t] of Object.entries(txns)) {
    if (t.categorySource === 'manual') continue;
    const newCat = evaluateRules(t, rules);
    if (!newCat || newCat === t.category) continue;
    const bf = getCategoryBudgetFields(newCat);
    patch[`transactions/${uid}/${txnId}/category`]       = newCat;
    patch[`transactions/${uid}/${txnId}/group`]          = bf.group;
    patch[`transactions/${uid}/${txnId}/isFixed`]        = bf.isFixed;
    patch[`transactions/${uid}/${txnId}/isAnnual`]       = bf.isAnnual;
    patch[`transactions/${uid}/${txnId}/categorySource`] = 'rule';
    patch[`transactions/${uid}/${txnId}/needsReview`]    = false;
    count++;
  }

  if (count > 0) await dbUpdate('', patch);

  btn.disabled = false;
  btn.textContent = count > 0
    ? `Updated ${count} transaction${count !== 1 ? 's' : ''} ✓`
    : 'No changes needed';
  setTimeout(() => {
    const b = document.getElementById('auto-apply-rules');
    if (b) b.textContent = 'Re-apply all rules to transactions';
  }, 4000);
}

function populateMonthSelect() {
  const sel = document.getElementById('auto-recurring-month');
  if (!sel) return;
  const now = new Date();
  const options = [];
  for (let i = 1; i >= -12; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const key  = `${yyyy}-${mm}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const selected = i === 0 ? ' selected' : '';
    options.push(`<option value="${key}"${selected}>${label}</option>`);
  }
  sel.innerHTML = options.join('');
}

function renderRecurring(items, uid) {
  const el = document.getElementById('auto-recurring-list');
  if (!el) return;
  const entries = Object.entries(items);
  if (!entries.length) {
    el.innerHTML = '<p class="empty" style="margin-bottom:0">No recurring transactions yet.</p>';
    return;
  }
  el.innerHTML = entries.map(([id, r]) => {
    const cat = getCategoryById(r.category);
    const amountStyle = r.amount < 0 ? 'color:var(--color-income,#16a34a)' : '';
    return `
      <div class="rule-row">
        <div class="rule-info">
          <span class="rule-name">${cat.icon} ${r.name}</span>
          <span class="rule-desc" style="${amountStyle}">${fmtCurrency(r.amount)} · Day ${r.dayOfMonth}</span>
        </div>
        <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:0.8rem;color:var(--muted)">
          <input type="checkbox" class="recurring-toggle" data-id="${id}" ${r.enabled ? 'checked' : ''}> On
        </label>
        <button class="auto-link-btn" data-id="${id}" style="color:var(--danger,#dc2626)">✕</button>
      </div>`;
  }).join('');

  el.querySelectorAll('[data-id]').forEach(btn => {
    if (btn.tagName === 'BUTTON') {
      btn.addEventListener('click', () => dbRemove(`recurring/${uid}/${btn.dataset.id}`));
    }
  });
  el.querySelectorAll('.recurring-toggle').forEach(cb => {
    cb.addEventListener('change', () => dbSet(`recurring/${uid}/${cb.dataset.id}/enabled`, cb.checked));
  });
}

function openRecurringEditor(uid, prefill = {}) {
  const leafCats = CATEGORIES.filter(c => c.parent);
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>Recurring Transaction</h3>
      <input id="rc-name" placeholder="Name (e.g. Rent, Netflix)" value="${prefill.name ?? ''}" />
      <input id="rc-amount" type="number" step="0.01" placeholder="Amount (negative = income)" value="${prefill.amount ?? ''}" />
      <input id="rc-day" type="number" min="1" max="28" placeholder="Day of month (1–28)" value="${prefill.dayOfMonth ?? ''}" />
      <select id="rc-cat">${leafCats.map(c => `<option value="${c.id}"${prefill.category === c.id ? ' selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select>
      <label style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;font-size:0.9rem">
        <input type="checkbox" id="rc-enabled" ${prefill.enabled !== false ? 'checked' : ''}> Enabled
      </label>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-save" style="flex:1">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.modal-save').addEventListener('click', async () => {
    const name    = modal.querySelector('#rc-name').value.trim();
    const amount  = parseFloat(modal.querySelector('#rc-amount').value);
    const day     = parseInt(modal.querySelector('#rc-day').value, 10);
    const catId   = modal.querySelector('#rc-cat').value;
    const enabled = modal.querySelector('#rc-enabled').checked;
    if (!name || isNaN(amount) || isNaN(day)) return;
    const cat = getCategoryById(catId);
    await dbPush(`recurring/${uid}`, {
      name,
      amount,
      category:   catId,
      group:      cat.parent,
      isFixed:    cat.isFixed  ?? false,
      isAnnual:   cat.isAnnual ?? false,
      dayOfMonth: Math.min(28, Math.max(1, day)),
      enabled,
      createdAt:  Date.now(),
    });
    modal.remove();
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function generateForMonth(uid, yearMonth) {
  const btn    = document.getElementById('auto-generate-recurring');
  const status = document.getElementById('auto-generate-status');
  if (!btn || !status) return;
  btn.disabled = true;
  btn.textContent = 'Generating…';
  status.textContent = '';

  const items = await dbGet(`recurring/${uid}`);
  if (!items) {
    btn.disabled = false;
    btn.textContent = 'Generate';
    status.textContent = 'No recurring transactions defined.';
    setTimeout(() => { status.textContent = ''; }, 4000);
    return;
  }

  let count = 0;
  for (const [id, r] of Object.entries(items)) {
    if (!r.enabled) continue;
    const key      = `recurring_${id}_${yearMonth}`;
    const existing = await dbGet(`transactions/${uid}/${key}`);
    if (existing) continue;
    const [yyyy, mm] = yearMonth.split('-');
    const dd = String(r.dayOfMonth).padStart(2, '0');
    await dbSet(`transactions/${uid}/${key}`, {
      date:           `${yyyy}-${mm}-${dd}`,
      description:    r.name,
      merchantName:   r.name,
      amount:         r.amount,
      category:       r.category,
      group:          r.group,
      isFixed:        r.isFixed,
      isAnnual:       r.isAnnual,
      categorySource: 'recurring',
      source:         'recurring',
      needsReview:    false,
    });
    count++;
  }

  btn.disabled = false;
  btn.textContent = 'Generate';
  status.textContent = count > 0
    ? `Generated ${count} transaction${count === 1 ? '' : 's'}.`
    : 'All already generated.';
  setTimeout(() => { status.textContent = ''; }, 4000);
}
