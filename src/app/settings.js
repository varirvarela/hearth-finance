import { dbGet, dbSet, dbPush, dbRemove, dbUpdate, auth, getHouseholdId, setHouseholdId } from '../shared/firebase.js';
import {
  getCategoryById, CATEGORIES, CATEGORY_MAP,
  getRootCategories, getChildCategories,
  hideCategory, addCustomCategory, removeCustomCategory,
} from '../shared/categories.js';
import { signOut } from 'firebase/auth';
import { CHANGELOG } from '../shared/changelog.js';
import { openChangelogSheet } from './accounts.js';

export function renderSettings(container) {
  container.innerHTML = `
    <div class="page settings">
      <section class="section">
        <h3>Household</h3>
        <div id="household-section"></div>
      </section>
      <section class="section">
        <h3>Categories</h3>
        <p style="color:var(--muted);font-size:0.82rem;margin-bottom:0.75rem">Add descriptions to help AI categorize ambiguous transactions. These are stored per-account and passed to the AI when no match is found.</p>
        <div id="cat-mgmt-list"></div>
      </section>
      <section class="section">
        <h3>About</h3>
        <p style="color:var(--muted);font-size:0.82rem;margin-bottom:0.6rem">Hearth Finance · v${CHANGELOG[0].version}</p>
        <button class="btn-secondary" id="show-changelog" style="width:auto;padding:0.4rem 1rem;font-size:0.82rem">What's new →</button>
      </section>
      <section class="section">
        <button class="btn-danger" id="sign-out">Sign Out</button>
      </section>
    </div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const hid = getHouseholdId();

  renderHouseholdSection(uid, hid);
  renderCategoryMgmt(hid);

  document.getElementById('sign-out').addEventListener('click', () => signOut(auth));
  container.querySelector('#show-changelog').addEventListener('click', () => openChangelogSheet());
}

function renderHouseholdSection(uid, hid) {
  const el = document.getElementById('household-section');
  if (!el) return;
  const isOwner = hid === uid;

  if (!isOwner) {
    dbGet(`users/${hid}`).then(owner => {
      el.innerHTML = `
        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.75rem">
          You're in <strong>${owner?.email ?? 'a shared household'}</strong>.
        </p>
        <button class="btn-danger" id="leave-household" style="width:auto;padding:0.5rem 1rem">Leave Household</button>
      `;
      el.querySelector('#leave-household').addEventListener('click', async () => {
        if (!confirm('Leave this household? You\'ll return to your own personal data.')) return;
        await dbUpdate(`users/${uid}`, { householdId: null });
        await dbRemove(`households/${hid}/members/${uid}`);
        setHouseholdId(uid);
        location.reload();
      });
    });
    return;
  }

  dbGet(`households/${uid}/members`).then(members => {
    const memberHtml = Object.entries(members ?? {}).map(([memberUid, data]) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:0.9rem">${data.email ?? memberUid}</span>
        <button class="btn-danger remove-member-btn" data-uid="${memberUid}" style="width:auto;padding:0.3rem 0.75rem;font-size:0.78rem">Remove</button>
      </div>`).join('') || '<p style="color:var(--muted);font-size:0.82rem;margin-bottom:0.75rem">No members yet.</p>';

    el.innerHTML = `
      ${memberHtml}
      <div style="margin-top:1rem">
        <p style="color:var(--muted);font-size:0.82rem;margin-bottom:0.5rem">Invite by email — they'll see this household when they sign in.</p>
        <input id="invite-email" type="email" placeholder="their@email.com"
          style="border:1px solid var(--border);border-radius:8px;padding:0.5rem 0.75rem;width:100%;margin-bottom:0.5rem" />
        <button class="btn-primary" id="send-invite" style="width:auto;padding:0.5rem 1rem">Send Invite</button>
        <p id="invite-status" style="font-size:0.82rem;margin-top:0.5rem;min-height:1rem"></p>
      </div>
    `;

    el.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const memberUid = btn.dataset.uid;
        if (!confirm('Remove this member from your household?')) return;
        await dbRemove(`households/${uid}/members/${memberUid}`);
        await dbUpdate(`users/${memberUid}`, { householdId: null });
        renderHouseholdSection(uid, hid);
      });
    });

    el.querySelector('#send-invite').addEventListener('click', async () => {
      const rawEmail = el.querySelector('#invite-email').value.trim().toLowerCase();
      const status   = el.querySelector('#invite-status');
      if (!rawEmail || !rawEmail.includes('@')) { alert('Please enter a valid email.'); return; }
      const emailKey = rawEmail.replace(/\./g, ',');
      await dbSet(`pendingInvites/${emailKey}`, {
        ownerUid:   uid,
        ownerEmail: auth.currentUser?.email ?? '',
        invitedAt:  Date.now(),
      });
      await dbSet(`households/${uid}/pendingInvites/${emailKey}`, { email: rawEmail, invitedAt: Date.now() });
      el.querySelector('#invite-email').value = '';
      status.textContent = `Invite saved for ${rawEmail}. Ask them to sign in to Hearth Finance.`;
      status.style.color = 'var(--brand, #4f46e5)';
    });
  });
}

function renderCategoryMgmt(uid) {
  const el = document.getElementById('cat-mgmt-list');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--muted);font-size:0.82rem">Loading…</p>';

  dbGet(`categoryDescriptions/${uid}`).then(descs => {
    descs = descs ?? {};
    rebuildCategoryList(el, uid, descs);
  });
}

function rebuildCategoryList(el, uid, descs) {
  const groups = getRootCategories().filter(g => g.id !== 'transfer');
  el.innerHTML = groups.map(group => {
    const leaves = getChildCategories(group.id).filter(l => !l.isIncome);
    if (!leaves.length) return '';
    return `
      <details class="cat-group-details">
        <summary class="cat-group-summary">
          <span>${group.icon} ${group.name}</span>
          <span class="cat-group-count">${leaves.length} categories</span>
        </summary>
        <div class="cat-group-leaves">
          ${leaves.map(leaf => renderLeafRow(leaf, descs)).join('')}
          <button class="cat-add-btn" data-group="${group.id}">+ New category in ${group.name}</button>
        </div>
      </details>`;
  }).join('');

  // Description auto-save on blur; delete from Firebase when cleared
  el.querySelectorAll('.cat-desc-input').forEach(ta => {
    ta.addEventListener('blur', () => {
      const catId = ta.dataset.cat;
      const val   = ta.value.trim();
      if (val) {
        descs[catId] = val;
        dbSet(`categoryDescriptions/${uid}/${catId}`, val);
      } else {
        delete descs[catId];
        dbRemove(`categoryDescriptions/${uid}/${catId}`);
      }
    });
  });

  // Hide / show toggle
  el.querySelectorAll('.cat-hide-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId  = btn.dataset.cat;
      const cat    = CATEGORY_MAP[catId];
      if (!cat) return;
      const nowHide = !cat.hide;
      hideCategory(catId, nowHide);
      if (cat.isCustom) {
        // Preserve the full catDef so it reloads correctly after hide/show
        const stored = (await dbGet(`customCategories/${uid}/${catId}`).catch(() => null)) ?? {};
        await dbSet(`customCategories/${uid}/${catId}`, { ...stored, hide: nowHide });
      } else {
        await dbSet(`customCategories/${uid}/${catId}`, { userHide: nowHide });
      }
      // Re-render the row in place
      const row = el.querySelector(`.cat-leaf-row[data-id="${catId}"]`);
      if (row) row.outerHTML = renderLeafRow(CATEGORY_MAP[catId], descs);
      rebindLeafRow(el, uid, descs, catId);
    });
  });

  // Edit custom category
  el.querySelectorAll('.cat-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditCategoryModal(uid, btn.dataset.cat, el, descs));
  });

  // Delete custom category
  el.querySelectorAll('.cat-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.cat;
      if (!CATEGORY_MAP[catId]?.isCustom) return;
      if (!confirm(`Delete "${CATEGORY_MAP[catId].name}"? Existing transactions tagged to it will show as uncategorized.`)) return;
      await dbRemove(`customCategories/${uid}/${catId}`);
      removeCustomCategory(catId);
      rebuildCategoryList(el, uid, descs);
    });
  });

  // Add new category button
  el.querySelectorAll('.cat-add-btn').forEach(btn => {
    btn.addEventListener('click', () => openAddCategoryModal(uid, btn.dataset.group, el, descs));
  });
}

function renderLeafRow(leaf, descs) {
  const builtinDesc = leaf.description ?? '';
  const customDesc  = descs[leaf.id] ?? '';
  const isHidden    = leaf.hide;
  return `
    <div class="cat-leaf-row${isHidden ? ' cat-hidden' : ''}" data-id="${leaf.id}">
      <div class="cat-leaf-hdr">
        <span class="cat-leaf-icon" style="background:${leaf.color ? leaf.color + '28' : 'var(--faint)'}">${leaf.icon ?? '📌'}</span>
        <div class="cat-leaf-meta">
          <span class="cat-leaf-name">${leaf.name}</span>
          ${isHidden           ? '<span class="cat-leaf-badge hidden-badge">Hidden</span>' : ''}
          ${leaf.isFixed       ? '<span class="cat-leaf-badge fixed-badge">Fixed</span>'  : ''}
          ${leaf.isAnnual      ? '<span class="cat-leaf-badge annual-badge">Annual</span>': ''}
          ${leaf.isCustom      ? '<span class="cat-leaf-badge custom-badge">Custom</span>': ''}
        </div>
        <div class="cat-leaf-actions">
          ${leaf.isCustom ? `<button class="cat-edit-btn" data-cat="${leaf.id}" title="Edit category">✎</button>` : ''}
          <button class="cat-hide-btn" data-cat="${leaf.id}" title="${isHidden ? 'Show in pickers' : 'Hide from pickers'}">
            ${isHidden ? '👁 Show' : '🙈 Hide'}
          </button>
          ${leaf.isCustom ? `<button class="cat-delete-btn" data-cat="${leaf.id}" title="Delete custom category">🗑</button>` : ''}
        </div>
      </div>
      <textarea
        class="cat-desc-input"
        data-cat="${leaf.id}"
        rows="2"
        placeholder="${builtinDesc ? builtinDesc.replace(/"/g, '&quot;') : 'Describe what belongs in this category…'}"
      >${customDesc}</textarea>
      ${builtinDesc && !customDesc ? `<p class="cat-desc-hint">AI uses the default description above. Type to override.</p>` : ''}
    </div>`;
}

function rebindLeafRow(el, uid, descs, catId) {
  const row = el.querySelector(`.cat-leaf-row[data-id="${catId}"]`);
  if (!row) return;
  const ta = row.querySelector('.cat-desc-input');
  if (ta) {
    ta.addEventListener('blur', () => {
      const val = ta.value.trim();
      if (val) { descs[catId] = val; dbSet(`categoryDescriptions/${uid}/${catId}`, val); }
      else { delete descs[catId]; dbRemove(`categoryDescriptions/${uid}/${catId}`); }
    });
  }
  const hideBtn = row.querySelector('.cat-hide-btn');
  if (hideBtn) {
    hideBtn.addEventListener('click', () => {
      const cat = CATEGORY_MAP[catId];
      if (!cat) return;
      const nowHide = !cat.hide;
      hideCategory(catId, nowHide);
      if (!cat.isCustom) dbSet(`customCategories/${uid}/${catId}`, { userHide: nowHide });
      const newRow = el.querySelector(`.cat-leaf-row[data-id="${catId}"]`);
      if (newRow) newRow.outerHTML = renderLeafRow(CATEGORY_MAP[catId], descs);
      rebindLeafRow(el, uid, descs, catId);
    });
  }
}

function openAddCategoryModal(uid, groupId, listEl, descs) {
  const group = CATEGORY_MAP[groupId];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-hdr">
        <span>New category in ${group?.icon ?? ''} ${group?.name ?? groupId}</span>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <label class="modal-label">Name <input id="nc-name" class="modal-input" placeholder="e.g. Pet Care" maxlength="40" /></label>
        <label class="modal-label">Icon <input id="nc-icon" class="modal-input" placeholder="emoji or leave blank" maxlength="4" value="📌" /></label>
        <label class="modal-label">
          <input type="checkbox" id="nc-annual" /> Annual budget (not monthly)
        </label>
        <label class="modal-label">
          <input type="checkbox" id="nc-fixed" /> Fixed amount each period
        </label>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel">Cancel</button>
        <button class="modal-save btn-primary">Add Category</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 220); };
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('.modal-cancel').addEventListener('click', close);

  overlay.querySelector('.modal-save').addEventListener('click', async () => {
    const name     = overlay.querySelector('#nc-name').value.trim();
    if (!name) return alert('Name is required.');
    const icon     = overlay.querySelector('#nc-icon').value.trim() || '📌';
    const isAnnual = overlay.querySelector('#nc-annual').checked;
    const isFixed  = overlay.querySelector('#nc-fixed').checked;

    // Generate a stable ID from the name (lowercase, only a-z0-9 and _)
    const base  = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    let catId   = `${groupId}_custom_${base}`;
    // Ensure uniqueness
    let suffix  = 0;
    while (CATEGORY_MAP[catId]) catId = `${groupId}_custom_${base}_${++suffix}`;

    const catDef = {
      id: catId, name, icon, color: group?.color ?? '#6b7280',
      parent: groupId, isAnnual, isFixed, isCustom: true, hide: false,
    };
    await dbSet(`customCategories/${uid}/${catId}`, catDef);
    addCustomCategory(catDef);
    close();
    rebuildCategoryList(listEl, uid, descs);
  });
}

function openEditCategoryModal(uid, catId, listEl, descs) {
  const cat = CATEGORY_MAP[catId];
  if (!cat?.isCustom) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-hdr">
        <span>Edit ${cat.icon ?? '📌'} ${cat.name}</span>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <label class="modal-label">Name
          <input id="ec-name" class="modal-input" value="${cat.name}" maxlength="40" />
        </label>
        <label class="modal-label">Icon
          <input id="ec-icon" class="modal-input" value="${cat.icon ?? '📌'}" maxlength="2" style="width:4rem" />
        </label>
        <label class="modal-label" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" id="ec-annual" ${cat.isAnnual ? 'checked' : ''}> Annual expense (e.g. vacations, insurance)
        </label>
        <label class="modal-label" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" id="ec-fixed" ${cat.isFixed ? 'checked' : ''}> Fixed expense (same amount monthly)
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn-primary modal-save-edit">Save changes</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-save-edit').addEventListener('click', async () => {
    const name = overlay.querySelector('#ec-name').value.trim();
    if (!name) return alert('Name is required.');
    const icon     = overlay.querySelector('#ec-icon').value.trim() || '📌';
    const isAnnual = overlay.querySelector('#ec-annual').checked;
    const isFixed  = overlay.querySelector('#ec-fixed').checked;
    const stored   = (await dbGet(`customCategories/${uid}/${catId}`).catch(() => null)) ?? {};
    await dbSet(`customCategories/${uid}/${catId}`, { ...stored, name, icon, isAnnual, isFixed });
    Object.assign(CATEGORY_MAP[catId], { name, icon, isAnnual, isFixed });
    close();
    rebuildCategoryList(listEl, uid, descs);
  });
}

