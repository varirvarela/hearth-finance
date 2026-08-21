import { auth } from '../shared/firebase.js';

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

bindAuth();

onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app-shell').hidden   = false;
    const hash = location.hash.slice(1) || 'dashboard';
    mount(hash);
    const lastSeen = localStorage.getItem('hearth-seen-version');
    const current  = CHANGELOG[0].version;
    if (lastSeen && lastSeen !== current) setTimeout(() => showWhatsNew(lastSeen), 900);
    localStorage.setItem('hearth-seen-version', current);
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
