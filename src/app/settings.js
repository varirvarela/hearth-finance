import { dbGet, dbSet, dbPush, auth } from '../shared/firebase.js';
import { getCategoryById } from '../shared/categories.js';
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

