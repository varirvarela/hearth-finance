import { dbGet, dbSet, dbPush, dbRemove, dbListen, auth } from '../shared/firebase.js';
import { signOut } from 'firebase/auth';
import { CATEGORIES, getCategoryById } from '../shared/categories.js';
import { buildRule } from '../shared/rules.js';
import { CHANGELOG } from '../shared/changelog.js';
import { openImportModal } from './import.js';

export function renderSettings(container) {
  container.innerHTML = `
    <div class="page settings">
      <section class="section">
        <h3>Categorization Rules</h3>
        <div id="rules-list"></div>
        <button class="btn-secondary" id="add-rule" style="margin-top:0.75rem">+ Add Rule</button>
      </section>
      <section class="section">
        <h3>Partner Sharing</h3>
        <div id="partner-section"></div>
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

  dbListen(`rules/${uid}`, rules => renderRules(rules ?? {}, uid));
  renderPartnerSection(uid);

  document.getElementById('add-rule').addEventListener('click', () => openRuleEditor(uid));
  document.getElementById('sign-out').addEventListener('click', () => signOut(auth));
  document.getElementById('import-csv').addEventListener('click', () => openImportModal());
  document.getElementById('export-csv').addEventListener('click', () => exportCsv(uid));
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

function openRuleEditor(uid) {
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
