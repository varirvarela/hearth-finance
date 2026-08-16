import { dbListen, dbSet, dbPush, dbRemove, dbUpdate, dbGet, auth } from '../shared/firebase.js';
import { CATEGORIES, getCategoryById, getCategoryBudgetFields } from '../shared/categories.js';
import { buildRule, evaluateRules } from '../shared/rules.js';

export function renderAutomation(container) {
  const uid = auth.currentUser?.uid;

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
    </div>
  `;

  if (!uid) return;

  let allRules = {};
  let searchQuery = '';

  container.querySelector('#auto-settings-link').addEventListener('click', e => {
    e.preventDefault();
    location.hash = 'settings';
  });

  container.querySelector('#auto-add-rule').addEventListener('click', () => openRuleEditor(uid));

  container.querySelector('#auto-search').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderRulesList(uid, allRules, searchQuery);
  });

  container.querySelector('#auto-apply-rules').addEventListener('click', () => applyAllRules(uid, allRules));

  dbListen(`rules/${uid}`, rules => {
    allRules = rules ?? {};
    renderStats(container, allRules);
    renderRulesList(uid, allRules, searchQuery);
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

function renderRulesList(uid, rules, query) {
  const listEl = document.getElementById('auto-rules-list');
  if (!listEl) return;

  const entries = Object.entries(rules);
  if (!entries.length) {
    listEl.innerHTML = `
      <div class="auto-empty">
        <div class="auto-empty-icon">⚙</div>
        <div>No rules yet.</div>
        <div style="font-size:0.8rem;color:var(--muted);margin-top:4px">Rules automatically categorize transactions as they arrive.</div>
      </div>`;
    return;
  }

  // Filter by search
  const filtered = query
    ? entries.filter(([, r]) =>
        r.matchValue?.toLowerCase().includes(query) ||
        r.name?.toLowerCase().includes(query) ||
        getCategoryById(r.actionValue)?.name?.toLowerCase().includes(query)
      )
    : entries;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="auto-empty"><div>No rules match "${query}".</div></div>`;
    return;
  }

  // Group by target category
  const byCat = new Map();
  for (const [id, r] of filtered) {
    const catId = r.actionValue ?? 'uncategorized';
    if (!byCat.has(catId)) byCat.set(catId, []);
    byCat.get(catId).push([id, r]);
  }

  // Sort groups by rule count descending
  const sortedGroups = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);

  let html = '';
  for (const [catId, catRules] of sortedGroups) {
    const cat     = getCategoryById(catId);
    const total   = catRules.length;
    const paused  = catRules.filter(([, r]) => r.enabled === false).length;
    const pausedBadge = paused > 0
      ? `<span class="auto-paused-badge">${paused} paused</span>`
      : '';

    const rulesHtml = catRules
      .sort((a, b) => (a[1].priority ?? 50) - (b[1].priority ?? 50))
      .map(([id, r]) => renderRuleCard(id, r, cat)).join('');

    html += `
      <div class="auto-group" data-cat="${catId}">
        <div class="auto-group-hdr">
          <div class="auto-group-left">
            <span class="auto-group-icon">${cat.icon}</span>
            <span class="auto-group-name">${cat.name}</span>
            <span class="auto-group-count">${total}</span>
            ${pausedBadge}
          </div>
          <button class="auto-add-cat-btn" data-cat="${catId}">+ Add</button>
        </div>
        <div class="auto-group-body">
          ${rulesHtml}
          <button class="auto-add-inline-btn" data-cat="${catId}">+ Add rule to ${cat.name}</button>
        </div>
      </div>`;
  }

  listEl.innerHTML = html;

  // Wire toggle switches
  listEl.querySelectorAll('.auto-rule-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const { id } = toggle.dataset;
      const current = toggle.classList.contains('is-on');
      toggle.classList.toggle('is-on', !current);
      dbSet(`rules/${auth.currentUser?.uid}/${id}/enabled`, !current);
    });
  });

  // Wire edit buttons
  listEl.querySelectorAll('.auto-rule-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const rule = allRulesRef[btn.dataset.id];
      if (rule) openRuleEditor(uid, btn.dataset.id, rule);
    });
  });

  // Wire delete buttons
  listEl.querySelectorAll('.auto-rule-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this rule?')) dbRemove(`rules/${uid}/${btn.dataset.id}`);
    });
  });

  // Wire category-specific add buttons
  listEl.querySelectorAll('.auto-add-cat-btn, .auto-add-inline-btn').forEach(btn => {
    btn.addEventListener('click', () => openRuleEditor(uid, null, null, btn.dataset.cat));
  });

  // Store for edit lookup
  allRulesRef = rules;
}

let allRulesRef = {};

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
          <option value="description" ${selField === 'description' ? 'selected' : ''}>description</option>
          <option value="merchant"    ${selField === 'merchant'    ? 'selected' : ''}>merchant name</option>
        </select>
        <select id="re-op" class="rule-editor-sel">
          <option value="contains"   ${selOp === 'contains'   ? 'selected' : ''}>contains</option>
          <option value="startsWith" ${selOp === 'startsWith' ? 'selected' : ''}>starts with</option>
          <option value="equals"     ${selOp === 'equals'     ? 'selected' : ''}>equals</option>
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
