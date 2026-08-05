// Firebase RTDB via REST — no Admin SDK needed in a Cloudflare Worker.
// Authenticates with FIREBASE_SECRET (database secret or service account token).

function url(env, path) {
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  return `${base}/${path}.json?auth=${env.FIREBASE_SECRET}`;
}

export async function fbGet(env, path) {
  const res = await fetch(url(env, path));
  if (!res.ok) throw new Error(`fbGet ${path}: ${res.status}`);
  return res.json();
}

export async function fbSet(env, path, data) {
  const res = await fetch(url(env, path), {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`fbSet ${path}: ${res.status}`);
  return res.json();
}

export async function fbPatch(env, path, data) {
  const res = await fetch(url(env, path), {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`fbPatch ${path}: ${res.status}`);
  return res.json();
}

export async function fbPush(env, path, data) {
  const res = await fetch(url(env, path), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`fbPush ${path}: ${res.status}`);
  return res.json();
}
