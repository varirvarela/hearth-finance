const EMULATOR_URL = 'http://localhost:9000';
const PROJECT_ID   = 'hearth-finance';

function emulatorUrl(path) {
  return `${EMULATOR_URL}/${PROJECT_ID}/${path}.json`;
}

export async function adminWrite(path, data) {
  await fetch(emulatorUrl(path), {
    method:  'PUT',
    body:    JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function adminRead(path) {
  const res = await fetch(emulatorUrl(path));
  return res.json();
}

export async function clearData() {
  await adminWrite('_dev', null);
}

export async function seedData(uid, overrides = {}) {
  const user = { name: 'Test User', email: 'test@example.com', currency: 'USD', createdAt: Date.now(), ...overrides };
  await adminWrite(`_dev/users/${uid}`, user);
}

export async function seedTransaction(uid, txn) {
  const id  = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const base = {
    date: new Date().toISOString().slice(0, 10),
    amount: 10,
    description: 'Test transaction',
    merchantName: null,
    category: 'uncategorized',
    categorySource: 'manual',
    accountId: 'test-account',
    pending: false,
    notes: '',
    tags: [],
    ignored: false,
  };
  await adminWrite(`_dev/transactions/${uid}/${id}`, { ...base, ...txn });
  return id;
}

export async function freshStart(uid, userOverrides = {}) {
  await clearData();
  await seedData(uid, userOverrides);
}
