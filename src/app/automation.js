import { dbListen, dbSet, dbPush, dbRemove, dbUpdate, dbGet, auth, getHouseholdId } from '../shared/firebase.js';
import { CATEGORIES, getCategoryById, getCategoryBudgetFields } from '../shared/categories.js';
import { buildRule, evaluateRules, matchesRule } from '../shared/rules.js';
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

  container.querySelector('#auto-apply-rules').addEventListener('click', () => openApplySheet(hid, allRules));

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
    ? allEntries.filter(([, r]) => {
        if (r.name?.toLowerCase().includes(query)) return true;
        if (getCategoryById(r.actionValue)?.name?.toLowerCase().includes(query)) return true;
        if (Array.isArray(r.conditions)) {
          return r.conditions.some(c => String(c.value ?? '').toLowerCase().includes(query));
        }
        return r.matchValue?.toLowerCase().includes(query);
      })
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
                  ${ruleCondSummaryHtml(r)}
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
    const fieldLabels = { description: 'desc', merchant: 'merchant', accountName: 'account', amount: 'amount', category: 'category', source: 'source' };
    const fields = [...new Set(catRules.flatMap(([, r]) => ruleFields(r)))];
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

function ruleFields(rule) {
  if (Array.isArray(rule.conditions) && rule.conditions.length) {
    return [...new Set(rule.conditions.map(c => c.field))];
  }
  return [rule.matchField ?? 'description'];
}

const OP_LABELS = {
  contains:    'contains',
  notContains: 'not contains',
  startsWith:  'starts with',
  equals:      'equals',
  gt:          '> ',
  gte:         '≥ ',
  lt:          '< ',
  lte:         '≤ ',
  in:          'is one of',
};

function ruleCondSummaryHtml(rule) {
  if (Array.isArray(rule.conditions) && rule.conditions.length) {
    return rule.conditions.map((c, i) => {
      const valStr = Array.isArray(c.value) ? c.value.join(', ') : escHtml(String(c.value ?? ''));
      const opLabel = OP_LABELS[c.op] ?? c.op;
      return `${i > 0 ? '<span class="auto-rule-and">AND</span> ' : ''}<span class="auto-rule-op">${opLabel}</span><span class="auto-rule-pattern">"${valStr}"</span>`;
    }).join(' ');
  }
  return `<span class="auto-rule-op">${rule.matchOp ?? 'contains'}</span> <span class="auto-rule-pattern">"${escHtml(rule.matchValue ?? '')}"</span>`;
}

function renderRuleCard(id, rule, cat) {
  const enabled   = rule.enabled !== false;
  const matchCnt  = rule.matchCount ?? null;
  const countHtml = matchCnt != null ? `· ${matchCnt} match${matchCnt !== 1 ? 'es' : ''}` : '';
  const pri       = rule.priority ?? 50;

  return `
    <div class="auto-rule-card ${enabled ? '' : 'is-paused'}">
      <div class="auto-rule-when">
        ${ruleCondSummaryHtml(rule)}
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

const RULE_FIELD_DEFS = {
  description: { label: 'description',   type: 'text',   ops: ['contains','notContains','startsWith','equals'] },
  merchant:    { label: 'merchant name', type: 'text',   ops: ['contains','notContains','startsWith','equals'] },
  accountName: { label: 'account name',  type: 'text',   ops: ['contains','notContains','startsWith','equals'] },
  notes:       { label: 'notes',         type: 'text',   ops: ['contains','notContains','startsWith','equals'] },
  amount:      { label: 'amount ($)',    type: 'number', ops: ['gt','gte','lt','lte','equals'] },
  category:    { label: 'category',     type: 'select', ops: ['in','equals'] },
  source:      { label: 'source',       type: 'select', ops: ['in','equals'], options: ['plaid','manual','import','ai','rule'] },
};

const OP_EDITOR_LABELS = {
  contains:    'contains',
  notContains: 'not contains',
  startsWith:  'starts with',
  equals:      'equals',
  gt:          'greater than',
  gte:         'at least',
  lt:          'less than',
  lte:         'at most',
  in:          'is one of',
};

function openRuleEditor(uid, ruleId = null, prefill = null, prefillCatId = null) {
  const isEdit  = ruleId != null;
  const expCats = CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer' && c.parent);

  // Normalise existing rule to conditions array
  let conditions;
  if (prefill) {
    if (Array.isArray(prefill.conditions) && prefill.conditions.length) {
      conditions = prefill.conditions.map(c => ({ ...c }));
    } else {
      conditions = [{ field: prefill.matchField ?? 'description', op: prefill.matchOp ?? 'contains', value: prefill.matchValue ?? '' }];
    }
  } else {
    conditions = [{ field: 'description', op: 'contains', value: '' }];
  }

  const initCatId = prefill?.actionValue ?? prefillCatId ?? (expCats[0]?.id ?? '');
  const selPri    = prefill?.priority ?? 50;

  const catOptions = expCats.map(c =>
    `<option value="${c.id}" ${initCatId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit Rule' : 'New Rule'}</h3>

      <label class="modal-label">When ALL conditions match</label>
      <div id="re-conds"></div>
      <button class="btn-ghost re-add-cond" type="button" style="font-size:0.8rem;margin-bottom:1rem;padding:6px 12px">+ AND condition</button>

      <label class="modal-label" style="margin-top:0.25rem">Then categorize as</label>
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

      <button class="btn-secondary re-test-btn" type="button" style="width:100%;margin-top:0.5rem;font-size:0.82rem;padding:8px">
        Preview matching transactions
      </button>
      <div class="re-test-results" id="re-test-results" style="display:none"></div>

      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-save" style="flex:1">${isEdit ? 'Save Changes' : 'Save Rule'} →</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const condsEl     = modal.querySelector('#re-conds');
  const catEl       = modal.querySelector('#re-cat');
  const addCondBtn  = modal.querySelector('.re-add-cond');
  const priAutoEl   = modal.querySelector('#re-pri-auto');
  const priCustomEl = modal.querySelector('#re-pri-custom');
  const priValEl    = modal.querySelector('#re-pri-val');
  const previewEl   = modal.querySelector('#re-preview');

  function renderValueInput(idx, field, op, value) {
    const fd = RULE_FIELD_DEFS[field];
    if (!fd) return '';

    if (fd.type === 'number') {
      return `<input class="rule-editor-input re-cond-val" data-ci="${idx}" type="number" step="0.01" min="0" placeholder="Amount…" value="${value ?? ''}">`;
    }

    if (fd.type === 'select') {
      const opts = field === 'category'
        ? expCats.map(c => ({ id: c.id, label: `${c.icon} ${c.name}` }))
        : (fd.options ?? []).map(o => ({ id: o, label: o }));

      if (op === 'in') {
        const selected = Array.isArray(value) ? value : [];
        return `<div class="rule-multicheck re-cond-multicheck" data-ci="${idx}">
          ${opts.map(o => `
            <label class="rule-multicheck-item">
              <input type="checkbox" value="${o.id}" ${selected.includes(o.id) ? 'checked' : ''}>
              <span>${escHtml(o.label)}</span>
            </label>`).join('')}
        </div>`;
      } else {
        const sel = typeof value === 'string' ? value : (Array.isArray(value) ? value[0] : opts[0]?.id ?? '');
        return `<select class="rule-editor-sel re-cond-val" data-ci="${idx}" style="width:100%">
          ${opts.map(o => `<option value="${o.id}" ${sel === o.id ? 'selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>`;
      }
    }

    return `<input class="rule-editor-input re-cond-val" data-ci="${idx}" type="text" placeholder="Value…" value="${escHtml(String(value ?? ''))}">`;
  }

  function renderConditions() {
    condsEl.innerHTML = conditions.map((cond, idx) => {
      const fd   = RULE_FIELD_DEFS[cond.field] ?? RULE_FIELD_DEFS.description;
      const fieldOpts = Object.entries(RULE_FIELD_DEFS).map(([k, v]) =>
        `<option value="${k}" ${cond.field === k ? 'selected' : ''}>${v.label}</option>`).join('');
      const opOpts = fd.ops.map(op =>
        `<option value="${op}" ${cond.op === op ? 'selected' : ''}>${OP_EDITOR_LABELS[op] ?? op}</option>`).join('');

      return `
        <div class="re-cond-card" data-ci="${idx}">
          <div class="re-cond-selects">
            <select class="rule-editor-sel re-cond-field" data-ci="${idx}" style="flex:1;min-width:0">${fieldOpts}</select>
            <select class="rule-editor-sel re-cond-op" data-ci="${idx}" style="flex:1;min-width:0">${opOpts}</select>
            ${conditions.length > 1
              ? `<button class="re-cond-remove" data-ci="${idx}" type="button" title="Remove">×</button>`
              : ''}
          </div>
          <div class="re-cond-value-wrap">
            ${renderValueInput(idx, cond.field, cond.op, cond.value)}
          </div>
        </div>`;
    }).join('');

    wireCondEvents();
    updatePreview();
    // Reset test results whenever conditions are re-rendered (field/op changed)
    const testEl2 = modal.querySelector('#re-test-results');
    if (testEl2) { testEl2.style.display = 'none'; testEl2.innerHTML = ''; }
  }

  function syncFromDom() {
    conditions.forEach((cond, idx) => {
      const fieldEl2 = condsEl.querySelector(`.re-cond-field[data-ci="${idx}"]`);
      const opEl2    = condsEl.querySelector(`.re-cond-op[data-ci="${idx}"]`);
      if (fieldEl2) cond.field = fieldEl2.value;
      if (opEl2)    cond.op    = opEl2.value;
      const fd = RULE_FIELD_DEFS[cond.field];
      if (fd?.type === 'select' && cond.op === 'in') {
        const checks = condsEl.querySelectorAll(`.re-cond-multicheck[data-ci="${idx}"] input:checked`);
        cond.value = [...checks].map(c => c.value);
      } else {
        const valEl2 = condsEl.querySelector(`.re-cond-val[data-ci="${idx}"]`);
        if (valEl2) cond.value = valEl2.value;
      }
    });
  }

  function wireCondEvents() {
    condsEl.querySelectorAll('.re-cond-field').forEach(el => {
      el.addEventListener('change', () => {
        syncFromDom();
        const idx = +el.dataset.ci;
        const fd  = RULE_FIELD_DEFS[el.value] ?? RULE_FIELD_DEFS.description;
        conditions[idx] = { field: el.value, op: fd.ops[0], value: '' };
        renderConditions();
      });
    });

    condsEl.querySelectorAll('.re-cond-op').forEach(el => {
      el.addEventListener('change', () => {
        syncFromDom();
        const idx    = +el.dataset.ci;
        const newOp  = el.value;
        const fd     = RULE_FIELD_DEFS[conditions[idx].field];
        const wasIn  = conditions[idx].op === 'in';
        const isNowIn = newOp === 'in';
        conditions[idx].op = newOp;
        if (fd?.type === 'select' && wasIn !== isNowIn) {
          conditions[idx].value = isNowIn ? [] : '';
        }
        renderConditions();
      });
    });

    condsEl.querySelectorAll('.re-cond-val').forEach(el => {
      el.addEventListener('input',  () => { conditions[+el.dataset.ci].value = el.value; updatePreview(); });
      el.addEventListener('change', () => { conditions[+el.dataset.ci].value = el.value; updatePreview(); });
    });

    condsEl.querySelectorAll('.re-cond-multicheck').forEach(wrap => {
      wrap.addEventListener('change', () => {
        const idx = +wrap.dataset.ci;
        conditions[idx].value = [...wrap.querySelectorAll('input:checked')].map(c => c.value);
        updatePreview();
      });
    });

    condsEl.querySelectorAll('.re-cond-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        syncFromDom();
        conditions.splice(+btn.dataset.ci, 1);
        renderConditions();
      });
    });
  }

  function updatePreview() {
    const cat = getCategoryById(catEl.value);
    const parts = conditions.map(c => {
      const fd     = RULE_FIELD_DEFS[c.field];
      const valStr = Array.isArray(c.value)
        ? (c.value.length ? c.value.map(v => {
            if (c.field === 'category') return getCategoryById(v)?.name ?? v;
            return v;
          }).join(', ') : '…')
        : (String(c.value || '…'));
      return `<strong>${fd?.label ?? c.field}</strong> ${OP_EDITOR_LABELS[c.op] ?? c.op} <strong>"${escHtml(valStr)}"</strong>`;
    });
    previewEl.innerHTML = `
      <span class="rule-preview-label">Preview</span>
      ${parts.join('<br><span style="color:var(--muted);font-size:0.7rem">AND </span>')}
      <br>→ Set category to <strong>${cat.icon} ${cat.name}</strong>
    `;
  }

  addCondBtn.addEventListener('click', () => {
    syncFromDom();
    conditions.push({ field: 'description', op: 'contains', value: '' });
    renderConditions();
  });

  catEl.addEventListener('change', updatePreview);

  [priAutoEl, priCustomEl].forEach(radio => {
    radio.addEventListener('change', () => {
      modal.querySelector('#re-pri-auto-lbl').classList.toggle('is-selected', priAutoEl.checked);
      modal.querySelector('#re-pri-custom-lbl').classList.toggle('is-selected', priCustomEl.checked);
      priValEl.disabled = priAutoEl.checked;
    });
  });

  modal.querySelector('.modal-save').addEventListener('click', async () => {
    syncFromDom();
    const invalid = conditions.some(c =>
      Array.isArray(c.value) ? c.value.length === 0 : !String(c.value ?? '').trim()
    );
    if (invalid) {
      alert('Please fill in all condition values.');
      return;
    }

    const priority = priAutoEl.checked ? 30 : Math.max(1, Math.min(100, parseInt(priValEl.value, 10) || 30));
    const catId    = catEl.value;
    const cat      = getCategoryById(catId);
    const firstVal = Array.isArray(conditions[0].value) ? conditions[0].value.join('/') : conditions[0].value;
    const name     = conditions.length > 1
      ? `${firstVal} +${conditions.length - 1} → ${cat.name}`
      : `${firstVal} → ${cat.name}`;

    const rule = buildRule({ conditions, categoryId: catId, name, priority });

    if (isEdit) {
      await dbSet(`rules/${uid}/${ruleId}`, { ...rule, createdAt: prefill.createdAt ?? Date.now() });
    } else {
      await dbPush(`rules/${uid}`, rule);
    }
    modal.remove();
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Preview matching transactions
  modal.querySelector('.re-test-btn').addEventListener('click', async () => {
    syncFromDom();
    const btn    = modal.querySelector('.re-test-btn');
    const testEl = modal.querySelector('#re-test-results');
    btn.disabled    = true;
    btn.textContent = 'Loading…';
    testEl.style.display = 'block';
    testEl.innerHTML     = '<div class="re-test-empty">Loading…</div>';
    try {
      const txns    = await dbGet(`transactions/${uid}`);
      const all     = Object.entries(txns ?? {});
      const fakeRule = { conditions, enabled: true, actionValue: '' };
      const matches  = all
        .filter(([, t]) => matchesRule(t, fakeRule))
        .sort((a, b) => (b[1].date ?? '').localeCompare(a[1].date ?? ''));
      if (!matches.length) {
        testEl.innerHTML = '<div class="re-test-empty">No transactions match these conditions.</div>';
      } else {
        const shown = matches.slice(0, 8);
        testEl.innerHTML = `
          <div class="re-test-header">${matches.length} transaction${matches.length !== 1 ? 's' : ''} match</div>
          ${shown.map(([, t]) => `
            <div class="re-test-row">
              <span class="re-test-desc">${escHtml(t.merchantName ?? t.description ?? '—')}</span>
              <span class="re-test-meta">${t.date ?? ''} · $${Math.abs(t.amount ?? 0).toFixed(2)}</span>
            </div>`).join('')}
          ${matches.length > 8 ? `<div class="re-test-more">+ ${matches.length - 8} more</div>` : ''}
        `;
      }
    } catch { testEl.innerHTML = '<div class="re-test-empty">Could not load transactions.</div>'; }
    btn.disabled    = false;
    btn.textContent = 'Preview matching transactions';
  });

  renderConditions();
  condsEl.querySelector('.re-cond-val')?.focus();
}

function openApplySheet(uid, rules) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-overlay';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-hdr">
        <span class="sheet-title">Apply Rules</span>
        <button class="sheet-close" id="ars-x">✕</button>
      </div>
      <div class="ars-body">

        <div id="ars-step1">
          <div class="modal-label">Date range</div>
          <div class="ars-radio-group">
            <label class="ars-radio-opt"><input type="radio" name="ars-d" value="all" checked> All time</label>
            <label class="ars-radio-opt"><input type="radio" name="ars-d" value="30"> Last 30 days</label>
            <label class="ars-radio-opt"><input type="radio" name="ars-d" value="90"> Last 90 days</label>
            <label class="ars-radio-opt"><input type="radio" name="ars-d" value="custom"> Custom range</label>
          </div>
          <div id="ars-custom" class="ars-custom-range" style="display:none">
            <input type="date" id="ars-from" class="rule-editor-input" style="flex:1">
            <span style="align-self:center;color:var(--muted)">to</span>
            <input type="date" id="ars-to" class="rule-editor-input" style="flex:1">
          </div>

          <div class="modal-label" style="margin-top:1rem">Transactions to include</div>
          <div class="ars-radio-group">
            <label class="ars-radio-opt"><input type="radio" name="ars-s" value="nonManual" checked> All (skip manual)</label>
            <label class="ars-radio-opt"><input type="radio" name="ars-s" value="uncategorized"> Uncategorized only</label>
            <label class="ars-radio-opt"><input type="radio" name="ars-s" value="review"> Has AI suggestion (needs review)</label>
          </div>

          <div style="display:flex;gap:0.5rem;margin-top:1.5rem">
            <button class="btn-ghost" id="ars-cancel" style="flex:1">Cancel</button>
            <button class="btn-primary" id="ars-preview-btn" style="flex:1">Preview →</button>
          </div>
        </div>

        <div id="ars-step2" style="display:none">
          <div id="ars-pick-hdr" class="modal-label" style="margin-bottom:0.5rem"></div>
          <div id="ars-pick-list" class="ars-pick-list"></div>
          <label class="ars-select-all-row" id="ars-sel-all-row" style="display:none">
            <input type="checkbox" id="ars-sel-all" checked>
            <span>Select / deselect all</span>
          </label>
          <div style="display:flex;gap:0.5rem;margin-top:1rem">
            <button class="btn-ghost" id="ars-back" style="flex:1">← Back</button>
            <button class="btn-primary" id="ars-apply-btn" style="flex:1" disabled>Apply</button>
          </div>
          <div id="ars-done" style="display:none;text-align:center;padding:1rem;color:var(--brand);font-weight:600"></div>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));

  const close = () => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 260); };
  sheet.querySelector('#ars-x').addEventListener('click', close);
  sheet.querySelector('#ars-cancel').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });

  sheet.querySelectorAll('input[name="ars-d"]').forEach(r => {
    r.addEventListener('change', () => {
      sheet.querySelector('#ars-custom').style.display =
        sheet.querySelector('input[name="ars-d"]:checked')?.value === 'custom' ? 'flex' : 'none';
    });
  });

  sheet.querySelector('#ars-preview-btn').addEventListener('click', async () => {
    const dateVal  = sheet.querySelector('input[name="ars-d"]:checked')?.value ?? 'all';
    const scopeVal = sheet.querySelector('input[name="ars-s"]:checked')?.value ?? 'nonManual';

    let fromDate = null, toDate = null;
    if (dateVal === 'custom') {
      fromDate = sheet.querySelector('#ars-from').value  || null;
      toDate   = sheet.querySelector('#ars-to').value    || null;
    } else if (dateVal !== 'all') {
      const d = new Date();
      d.setDate(d.getDate() - Number(dateVal));
      fromDate = d.toISOString().slice(0, 10);
    }

    const previewBtn = sheet.querySelector('#ars-preview-btn');
    previewBtn.disabled    = true;
    previewBtn.textContent = 'Loading…';

    let txns;
    try { txns = await dbGet(`transactions/${uid}`); } catch { txns = null; }
    previewBtn.disabled    = false;
    previewBtn.textContent = 'Preview →';

    const candidates = Object.entries(txns ?? {}).filter(([, t]) => {
      if (fromDate && (t.date ?? '') < fromDate) return false;
      if (toDate   && (t.date ?? '') > toDate)   return false;
      if (scopeVal === 'nonManual'     && t.categorySource === 'manual')                  return false;
      if (scopeVal === 'uncategorized' && t.category && t.category !== 'uncategorized')   return false;
      if (scopeVal === 'review'        && !t.needsReview)                                 return false;
      return true;
    });

    const proposed = candidates
      .map(([id, t]) => ({ id, txn: t, newCat: evaluateRules(t, rules) }))
      .filter(p => p.newCat && p.newCat !== p.txn.category)
      .sort((a, b) => (b.txn.date ?? '').localeCompare(a.txn.date ?? ''));

    sheet.querySelector('#ars-step1').style.display = 'none';
    const step2 = sheet.querySelector('#ars-step2');
    step2.style.display = 'block';

    const hdrEl      = sheet.querySelector('#ars-pick-hdr');
    const listEl     = sheet.querySelector('#ars-pick-list');
    const selAllRow  = sheet.querySelector('#ars-sel-all-row');
    const applyBtn   = sheet.querySelector('#ars-apply-btn');

    if (!proposed.length) {
      hdrEl.textContent      = 'No changes needed';
      listEl.innerHTML       = `<div class="ars-empty">All matching transactions are already correctly categorized.</div>`;
      applyBtn.style.display = 'none';
      return;
    }

    hdrEl.textContent        = `${proposed.length} transaction${proposed.length !== 1 ? 's' : ''} would be updated`;
    selAllRow.style.display  = 'flex';

    listEl.innerHTML = proposed.map(({ id, txn, newCat }) => {
      const cat    = getCategoryById(newCat);
      const oldCat = getCategoryById(txn.category);
      const label  = txn.merchantName ?? txn.description ?? 'Transaction';
      return `
        <label class="ars-pick-row">
          <input type="checkbox" class="ars-pick-chk" data-id="${id}" checked>
          <div class="ars-pick-info">
            <div class="ars-pick-desc">${escHtml(label)}</div>
            <div class="ars-pick-meta">${txn.date ?? ''} · $${Math.abs(txn.amount ?? 0).toFixed(2)}</div>
          </div>
          <div class="ars-pick-arrow">${oldCat?.icon ?? '?'} → ${cat.icon} ${cat.name}</div>
        </label>`;
    }).join('');

    const updateApply = () => {
      const n = listEl.querySelectorAll('.ars-pick-chk:checked').length;
      applyBtn.textContent = `Apply to ${n} transaction${n !== 1 ? 's' : ''}`;
      applyBtn.disabled    = n === 0;
    };
    listEl.addEventListener('change', updateApply);

    sheet.querySelector('#ars-sel-all').addEventListener('change', e => {
      listEl.querySelectorAll('.ars-pick-chk').forEach(cb => { cb.checked = e.target.checked; });
      updateApply();
    });
    updateApply();

    applyBtn.addEventListener('click', async () => {
      const ids   = new Set([...listEl.querySelectorAll('.ars-pick-chk:checked')].map(cb => cb.dataset.id));
      applyBtn.disabled    = true;
      applyBtn.textContent = 'Applying…';
      const patch = {};
      for (const { id, newCat } of proposed.filter(p => ids.has(p.id))) {
        const bf = getCategoryBudgetFields(newCat);
        patch[`transactions/${uid}/${id}/category`]       = newCat;
        patch[`transactions/${uid}/${id}/group`]          = bf.group;
        patch[`transactions/${uid}/${id}/isFixed`]        = bf.isFixed;
        patch[`transactions/${uid}/${id}/isAnnual`]       = bf.isAnnual;
        patch[`transactions/${uid}/${id}/categorySource`] = 'rule';
        patch[`transactions/${uid}/${id}/needsReview`]    = false;
      }
      if (Object.keys(patch).length) await dbUpdate('', patch);
      const doneEl = sheet.querySelector('#ars-done');
      doneEl.textContent   = `✓ Updated ${ids.size} transaction${ids.size !== 1 ? 's' : ''}`;
      doneEl.style.display = 'block';
      applyBtn.style.display = 'none';
      sheet.querySelector('#ars-back').style.display = 'none';
      setTimeout(close, 2000);
    });

    sheet.querySelector('#ars-back').addEventListener('click', () => {
      step2.style.display = 'none';
      sheet.querySelector('#ars-step1').style.display = 'block';
      applyBtn.style.display = '';
    });
  });
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
