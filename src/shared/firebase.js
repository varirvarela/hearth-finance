import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, push, update, remove, onValue, connectDatabaseEmulator } from 'firebase/database';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Prefix all RTDB paths in dev so dev data never touches production.
export const DEV_ROOT = import.meta.env.DEV ? '_dev/' : '';

const app  = initializeApp(firebaseConfig);
export const db   = getDatabase(app);
export const auth = getAuth(app);

if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
}

export function dbRef(path) {
  return ref(db, DEV_ROOT + path);
}

export const dbSet    = (path, val) => set(dbRef(path), val);
export const dbGet    = (path)      => get(dbRef(path)).then(s => s.val());
export const dbPush   = (path, val) => push(dbRef(path), val);
export const dbUpdate = (path, val) => update(dbRef(path), val);
export const dbRemove = (path)      => remove(dbRef(path));
export const dbListen = (path, cb)  => onValue(dbRef(path), s => cb(s.val()));

export async function getPartnerUid(uid) {
  const user = await dbGet(`users/${uid}`);
  return user?.partnerUid ?? null;
}

let _hid = null;
export function setHouseholdId(id) { _hid = id; }
export function getHouseholdId()   { return _hid ?? auth.currentUser?.uid ?? null; }
