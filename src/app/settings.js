import { dbGet, dbSet, dbPush, auth } from '../shared/firebase.js';
import { getCategoryById, CATEGORIES, getRootCategories, getChildCategories } from '../shared/categories.js';
import { signOut } from 'firebase/auth';
import { CHANGELOG } from '../shared/changelog.js';
import { openChangelogSheet } from './accounts.js';

export function renderSettings(container) {
  container.innerHTML = `
    <div class="page settings">
      <section class="section">
        <h3>Partner Sharing</h3>
        <div id="partner-section"></div>
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

  renderPartnerSection(uid);
  renderCategoryMgmt(uid);

  document.getElementById('sign-out').addEventListener('click', () => signOut(auth));
  container.querySelector('#show-changelog').addEventListener('click', () => openChangelogSheet());
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

function renderCategoryMgmt(uid) {
  const el = document.getElementById('cat-mgmt-list');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--muted);font-size:0.82rem">Loading…</p>';

  dbGet(`categoryDescriptions/${uid}`).then(descs => {
    descs = descs ?? {};
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
            ${leaves.map(leaf => `
              <div class="cat-leaf-row" data-id="${leaf.id}">
                <div class="cat-leaf-hdr">
                  <span class="cat-leaf-icon" style="background:${leaf.color ? leaf.color + '28' : 'var(--faint)'}">${leaf.icon}</span>
                  <div class="cat-leaf-meta">
                    <span class="cat-leaf-name">${leaf.name}</span>
                    ${leaf.hide ? '<span class="cat-leaf-badge hidden-badge">Hidden</span>' : ''}
                    ${leaf.isFixed ? '<span class="cat-leaf-badge fixed-badge">Fixed</span>' : ''}
                    ${leaf.isAnnual ? '<span class="cat-leaf-badge annual-badge">Annual</span>' : ''}
                  </div>
                </div>
                <textarea
                  class="cat-desc-input"
                  data-cat="${leaf.id}"
                  rows="2"
                  placeholder="Describe what goes here (e.g. 'Restaurants, cafes, fast food, dining out')"
                >${descs[leaf.id] ?? ''}</textarea>
              </div>
            `).join('')}
          </div>
        </details>`;
    }).join('');

    // Auto-save on blur
    el.querySelectorAll('.cat-desc-input').forEach(ta => {
      ta.addEventListener('blur', () => {
        const catId = ta.dataset.cat;
        const val   = ta.value.trim();
        if (val) {
          dbSet(`categoryDescriptions/${uid}/${catId}`, val);
        }
      });
    });
  });
}

