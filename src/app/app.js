import { auth, dbGet, dbUpdate, dbRemove, setHouseholdId } from '../shared/firebase.js';
import { hideCategory, addCustomCategory } from '../shared/categories.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { renderDashboard }    from './dashboard.js';
import { renderTransactions } from './transactions.js';
import { renderBudgets }      from './budgets.js';
import { renderAccounts }     from './accounts.js';
import { renderSettings }     from './settings.js';
import { renderAutomation }   from './automation.js';
import { renderInsights }     from './insights.js';
import { CHANGELOG } from '../shared/changelog.js';

function showWhatsNew(sinceVersion) {
  const gt = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i]??0) > (pb[i]??0)) return true;
      if ((pa[i]??0) < (pb[i]??0)) return false;
    }
    return false;
  };
  const entries = CHANGELOG.filter(e => gt(e.version, sinceVersion));
  if (!entries.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-hdr">
        <span class="sheet-title">✨ What's new in v${CHANGELOG[0].version}</span>
        <button class="sheet-close" id="wn-close">✕</button>
      </div>
      <div class="changelog-list">
        ${entries.map(e => `
          <div class="changelog-entry">
            <div class="changelog-version-row">
              <span class="changelog-version">v${e.version}</span>
              <span class="changelog-date">${e.date}</span>
            </div>
            <ul class="changelog-changes">${e.changes.map(c => `<li>${c}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 260); };
  overlay.querySelector('#wn-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

const TABS = ['dashboard', 'transactions', 'budgets', 'accounts', 'insights', 'automation', 'settings'];
const renderers = {
  dashboard:    renderDashboard,
  transactions: renderTransactions,
  budgets:      renderBudgets,
  accounts:     renderAccounts,
  insights:     renderInsights,
  automation:   renderAutomation,
  settings:     renderSettings,
};

function mount(tab) {
  if (!TABS.includes(tab)) tab = 'dashboard';
  document.querySelectorAll('.nav-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab)
  );
  const main = document.getElementById('main');
  main.innerHTML = '';
  renderers[tab](main);
}

function bindAuth() {
  document.getElementById('sign-in-google').addEventListener('click', () => {
    signInWithPopup(auth, new GoogleAuthProvider()).catch(err => alert(err.message));
  });

  const doEmailSignIn = () => {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    signInWithEmailAndPassword(auth, email, password).catch(err => alert(err.message));
  };

  document.getElementById('auth-form').addEventListener('submit', e => {
    e.preventDefault();
    doEmailSignIn();
  });

  document.getElementById('sign-in-email').addEventListener('click', doEmailSignIn);

  document.getElementById('sign-up-email').addEventListener('click', () => {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    createUserWithEmailAndPassword(auth, email, password).catch(err => alert(err.message));
  });
}

async function handlePendingInvite(user, invite, emailKey) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.innerHTML = `
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-hdr">
          <span class="sheet-title">Household Invite</span>
        </div>
        <div style="padding:1.2rem 1.2rem 0">
          <p style="margin-bottom:1rem"><strong>${invite.ownerEmail ?? 'Someone'}</strong> has invited you to their household.</p>
          <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1.5rem">Join to share transactions, accounts, and budgets with all household members.</p>
        </div>
        <div style="display:flex;gap:0.75rem;padding:0 1.2rem 1.5rem">
          <button class="btn-secondary" id="invite-decline" style="flex:1">Decline</button>
          <button class="btn-primary"   id="invite-accept"  style="flex:1">Join Household</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 260); resolve(); };
    overlay.querySelector('#invite-decline').addEventListener('click', close);
    overlay.querySelector('#invite-accept').addEventListener('click', async () => {
      try {
        await dbUpdate(`users/${user.uid}`, { householdId: invite.ownerUid });
        await dbUpdate(`households/${invite.ownerUid}/members/${user.uid}`, { email: user.email, addedAt: Date.now() });
        await dbRemove(`pendingInvites/${emailKey}`);
        setHouseholdId(invite.ownerUid);
      } catch (e) { console.error('Failed to join household:', e); }
      close();
    });
  });
}

bindAuth();

onAuthStateChanged(auth, async user => {
  if (user) {
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app-shell').hidden   = false;

    // Write user presence so the cron sync can find this user.
    dbUpdate(`users/${user.uid}`, { email: user.email, lastLoginAt: Date.now() }).catch(() => {});

    // Resolve household — members share the owner's data namespace.
    const profile     = (await dbGet(`users/${user.uid}`).catch(() => null)) ?? {};
    const householdId = profile.householdId ?? user.uid;
    setHouseholdId(householdId);

    // If not yet in a household, check for a pending invite.
    if (!profile.householdId && user.email) {
      const emailKey = user.email.replace(/\./g, ',');
      const invite   = await dbGet(`pendingInvites/${emailKey}`).catch(() => null);
      if (invite) await handlePendingInvite(user, invite, emailKey);
    }

    // Apply household-wide category overrides before first render.
    try {
      const customCats = await dbGet(`customCategories/${householdId}`);
      for (const [id, data] of Object.entries(customCats ?? {})) {
        if (data?.isCustom) addCustomCategory({ id, ...data });
        else if ('userHide' in data) hideCategory(id, data.userHide);
      }
    } catch { /* non-fatal — built-in categories still work */ }

    const hash = location.hash.slice(1) || 'dashboard';
    mount(hash);
    const lastSeen = localStorage.getItem('hearth-seen-version-2');
    const current  = CHANGELOG[0].version;
    if (!lastSeen || lastSeen !== current) {
      const since = lastSeen ?? (CHANGELOG[1]?.version ?? '0.0.0');
      setTimeout(() => showWhatsNew(since), 900);
    }
    localStorage.setItem('hearth-seen-version-2', current);
  } else {
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('app-shell').hidden   = true;
  }
});

document.querySelectorAll('.nav-tab').forEach(el => {
  el.addEventListener('click', () => {
    location.hash = el.dataset.tab;
    mount(el.dataset.tab);
  });
});

window.addEventListener('hashchange', () => mount(location.hash.slice(1)));
