// Shared helpers for the Pages Functions that back sign-in.
//
// Design note: authentication is deliberately ADDITIVE. The page still works
// exactly as before with a token typed into Settings, so an outage of KV or the
// mailer can never stop you capturing a note — it only stops the convenience of
// the token following you between devices.

export const SESSION_COOKIE = 'v2r_session';
// A year, renewed on use (see touch()), so a device you actually capture from
// never asks again. Signing out, or revoking from another device, still ends it.
export const SESSION_TTL = 60 * 60 * 24 * 365;
export const RENEW_AFTER = 60 * 60 * 24;        // slide the window at most daily
export const PIN_TTL = 600;                     // 10 minutes
export const MAX_ATTEMPTS = 5;

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

/** Who may sign in. Single-user by default; Cloudflare will only deliver to a
 *  verified destination address anyway, but the allowlist is enforced here too
 *  so an unverified address fails fast and loudly rather than silently. */
export function allowed(env) {
  return (env.ALLOWED_EMAILS || 'chsiegm@mit.edu')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export const normEmail = (e) => String(e || '').trim().toLowerCase();

/** PINs are stored hashed. A KV read should not hand someone a working code. */
export async function hash(value, salt) {
  const data = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomPin() {
  // 6 digits from rejection-free arithmetic on 4 random bytes.
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}

export function randomId() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function cookieValue(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setCookie(id) {
  // HttpOnly so page scripts cannot read it; Secure because pages.dev is HTTPS;
  // Lax rather than Strict so following a link back into the app stays signed in.
  return `${SESSION_COOKIE}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`;
}

export const clearCookie = () =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/** Resolve the caller's session, or null. Renews on use so an active device
 *  stays signed in indefinitely — but at most once a day, because the KV free
 *  tier allows 1,000 writes a day and a write on every request would burn it. */
export async function session(request, env) {
  const id = cookieValue(request, SESSION_COOKIE);
  if (!id) return null;
  const raw = await env.V2R.get(`sess:${id}`);
  if (!raw) return null;
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - (s.touched || 0) > RENEW_AFTER) {
    s.touched = now;
    await env.V2R.put(`sess:${id}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
  }
  return { id, ...s };
}

/** Guard every Function that touches the vault. */
export async function requireSession(request, env) {
  if (!env || !env.V2R) {
    return { error: json({ error: 'storage is not configured on this deployment' }, 503) };
  }
  const s = await session(request, env);
  if (!s) return { error: json({ error: 'not signed in' }, 401) };
  return { s };
}
