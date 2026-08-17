import { auth } from '../shared/firebase.js';
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
