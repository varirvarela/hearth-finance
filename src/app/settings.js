import { dbGet, dbSet, dbPush, dbRemove, dbListen, dbUpdate, auth } from '../shared/firebase.js';
import { signOut } from 'firebase/auth';
import { CATEGORIES, getCategoryById, getCategoryBudgetFields } from '../shared/categories.js';
import { buildRule, evaluateRules } from '../shared/rules.js';
import { CHANGELOG } from '../shared/changelog.js';
import { fmtCurrency } from '../shared/format.js';
import { openImportModal } from './import.js';

export function renderSettings(container) {
  container.innerHTML = `
    <div class="page settings">
      <section class="section">
        <h3>Categorization Rules</h3>
        <div id="rules-list"></div>
        <button class="btn-ghost" id="apply-rules" style="margin-top:0.75rem">Apply rules to existing transactions</button>
        <button class="btn-secondary" id="add-rule" style="margin-top:0.5rem">+ Add Rule</button>
      </section>
      <section class="section">
        <h3>Partner Sharing</h3>
        <div id="partner-section"></div>
      </section>
      <section class="section">
        <h3>Recurring Transactions</h3>
        <div id="recurring-list"></div>
        <button class="btn-secondary" id="add-recurring" style="margin-top:0.75rem;width:auto;padding:0.5rem 1rem">+ Add Recurring</button>
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
          <select id="recurring-month" style="border:1.5px solid var(--border);border-radius:8px;padding:0.45rem 0.6rem;font-size:0.9rem;background:var(--surface)"></select>
          <button class="btn-primary" id="generate-recurring" style="width:auto;padding:0.5rem 1rem">Generate</button>
          <span id="generate-status" style="font-size:0.85rem;color:var(--muted)"></span>
        </div>
      </section>
      <section class="section">
        <h3>Import Data</h3>
        <p style="color:var(--muted);font-size:0.875rem;margin-bottom:0.75rem">Import a Tiller CSV export to load your transaction history.</p>
        <button class="btn-secondary" id="import-csv" style="width:auto;padding:0.5rem 1rem">Import CSV…</button>
      </section>
      <section class="section">
        <h3>Export</h3>
        <button class="btn-secondary" id="export-csv" style="width:auto;padding:0.5rem 1rem">Export CSV</button>
      </section>
      <section class="section">
        <h3>About</h3>
        <p style="color:var(--color-muted);font-size:0.85rem">Version ${CHANGELOG[0].version}</p>
      </section>
      <section class="section">
        <button class="btn-danger" id="sign-out">Sign Out</button>
      </section>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  let currentRules = {};
  dbListen(`rules/${uid}`, rules => {
    currentRules = rules ?? {};
    renderRules(currentRules, uid);
  });
  dbListen(`recurring/${uid}`, items => renderRecurring(items ?? {}, uid));
  renderPartnerSection(uid);
  populateMonthSelect();

  const pending = sessionStorage.getItem('pendingRule');
  if (pending) {
    sessionStorage.removeItem('pendingRule');
    try {
      const pre = JSON.parse(pending);
      openRuleEditor(uid, pre);
    } catch {}
  }

  document.getElementById('add-rule').addEventListener('click', () => openRuleEditor(uid));
  document.getElementById('add-recurring').addEventListener('click', () => openRecurringEditor(uid));
  document.getElementById('generate-recurring').addEventListener('click', () => {
    const yearMonth = document.getElementById('recurring-month').value;
    generateForMonth(uid, yearMonth);
  });
  document.getElementById('sign-out').addEventListener('click', () => signOut(auth));
  document.getElementById('import-csv').addEventListener('click', () => openImportModal());
  document.getElementById('export-csv').addEventListener('click', () => exportCsv(uid));

  document.getElementById('apply-rules').addEventListener('click', async () => {
    const btn = document.getElementById('apply-rules');
    btn.disabled = true;
    btn.textContent = 'Applying…';

    const txns = await dbGet(`transactions/${uid}`);
    if (!txns) {
      btn.disabled = false;
      btn.textContent = 'Apply rules to existing transactions';
      return;
    }

    const patch = {};
    let count = 0;

    for (const [txnId, t] of Object.entries(txns)) {
      if (t.categorySource === 'manual') continue;
      const newCat = evaluateRules(t, currentRules);
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
      ? `Updated ${count} transaction${count === 1 ? '' : 's'}`
      : 'No changes — all rules already applied';
    setTimeout(() => {
      const b = document.getElementById('apply-rules');
      if (b) b.textContent = 'Apply rules to existing transactions';
    }, 4000);
  });
}

function populateMonthSelect() {
  const sel = document.getElementById('recurring-month');
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

function renderRules(rules, uid) {
  const el = document.getElementById('rules-list');
  const entries = Object.entries(rules).sort((a, b) => a[1].priority - b[1].priority);
  if (!entries.length) { el.innerHTML = '<p class="empty" style="margin-bottom:0">No rules yet.</p>'; return; }
  el.innerHTML = entries.map(([id, r]) => {
    const cat = getCategoryById(r.actionValue);
    return `
      <div class="rule-row">
        <div class="rule-info">
          <span class="rule-name">${r.name}</span>
          <span class="rule-desc">${r.matchField} ${r.matchOp} "${r.matchValue}" → ${cat.icon} ${cat.name}</span>
        </div>
        <button class="rule-delete btn-ghost" data-id="${id}" style="width:auto;color:var(--color-danger)">✕</button>
      </div>`;
  }).join('');
  el.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', () => dbRemove(`rules/${uid}/${btn.dataset.id}`));
  });
}

function renderRecurring(items, uid) {
  const el = document.getElementById('recurring-list');
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
        <button class="rule-delete btn-ghost" data-id="${id}" style="width:auto;color:var(--color-danger)">✕</button>
      </div>`;
  }).join('');

  el.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', () => dbRemove(`recurring/${uid}/${btn.dataset.id}`));
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
  const btn    = document.getElementById('generate-recurring');
  const status = document.getElementById('generate-status');
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

function renderPartnerSection(uid) {
  const el = document.getElementById('partner-section');
  dbGet(`users/${uid}`).then(user => {
    if (user?.partnerUid) {
      dbGet(`users/${user.partnerUid}`).then(partner => {
        el.innerHTML = `<p>Sharing with <strong>${partner?.name ?? partner?.email ?? 'your partner'}</strong>.</p>`;
      });
    } else {
      el.innerHTML = `
        <p style="color:var(--color-muted);font-size:0.9rem;margin-bottom:0.75rem">
          Invite your partner to share budgets and see all accounts together.
        </p>
        <button class="btn-secondary" id="send-invite" style="width:auto;padding:0.5rem 1rem">Send Invite</button>
        <div style="margin-top:0.75rem">
          <input id="invite-code-input" placeholder="Enter invite code" style="border:1px solid var(--color-border);border-radius:8px;padding:0.5rem 0.75rem;width:100%;margin-bottom:0.5rem" />
          <button class="btn-primary" id="accept-invite">Join Partner</button>
        </div>
      `;
      el.querySelector('#send-invite').addEventListener('click', () => generateInvite(uid));
      el.querySelector('#accept-invite').addEventListener('click', () => acceptInvite(uid));
    }
  });
}

async function generateInvite(uid) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  await dbSet(`invites/${code}`, { fromUid: uid, email: auth.currentUser.email, createdAt: Date.now(), accepted: false });
  await dbSet(`users/${uid}/inviteCode`, code);
  alert(`Your invite code: ${code}\n\nShare this with your partner.`);
}

async function acceptInvite(uid) {
  const code = document.getElementById('invite-code-input').value.trim().toUpperCase();
  const invite = await dbGet(`invites/${code}`);
  if (!invite || invite.accepted) { alert('Invalid or already-used invite code.'); return; }
  await dbSet(`invites/${code}/accepted`, true);
  await dbSet(`invites/${code}/acceptedBy`, uid);
  await dbSet(`users/${uid}/partnerUid`, invite.fromUid);
  await dbSet(`users/${invite.fromUid}/partnerUid`, uid);
  renderPartnerSection(uid);
}

function openRuleEditor(uid, prefill = {}) {
  const cats = CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>New Rule</h3>
      <input id="r-name" placeholder="Rule name (e.g. Whole Foods → Groceries)" />
      <select id="r-field"><option value="description">Description</option><option value="merchant">Merchant</option></select>
      <select id="r-op"><option value="contains">contains</option><option value="startsWith">starts with</option><option value="equals">equals</option></select>
      <input id="r-value" placeholder="Match value" />
      <select id="r-cat">${cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}</select>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="btn-ghost modal-cancel" style="flex:1">Cancel</button>
        <button class="btn-primary modal-save" style="flex:1">Save Rule</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (prefill.name)       modal.querySelector('#r-name').value  = prefill.name;
  if (prefill.matchValue) modal.querySelector('#r-value').value = prefill.matchValue;

  modal.querySelector('.modal-save').addEventListener('click', async () => {
    const rule = buildRule({
      name:       modal.querySelector('#r-name').value.trim(),
      matchField: modal.querySelector('#r-field').value,
      matchOp:    modal.querySelector('#r-op').value,
      matchValue: modal.querySelector('#r-value').value.trim(),
      categoryId: modal.querySelector('#r-cat').value,
    });
    if (!rule.matchValue || !rule.name) return;
    await dbPush(`rules/${uid}`, rule);
    modal.remove();
  });

  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function exportCsv(uid) {
  const txns = await dbGet(`transactions/${uid}`);
  if (!txns) { alert('No transactions to export.'); return; }
  const rows = [['Date', 'Description', 'Merchant', 'Amount', 'Category', 'Account', 'Notes']];
  for (const t of Object.values(txns)) {
    const cat = getCategoryById(t.category);
    rows.push([t.date, t.description, t.merchantName ?? '', t.amount, cat.name, t.accountId, t.notes ?? '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `hearth-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
