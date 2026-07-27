// Shared helpers for the Functions that back the passphrase vault.
//
// Design note: the passphrase never reaches this server. The browser derives
// two values from it with PBKDF2 and the same salt:
//
//   authValue = PBKDF2(pass, salt + "auth")   sent here, gates read and write
//   encKey    = PBKDF2(pass, salt + "enc")    never sent, decrypts the token
//
// So what KV holds is a hash of the auth value and an AES-GCM ciphertext. A read
// of the whole namespace yields neither the passphrase nor the Roam token. That
// is the point: the token can rewrite the entire graph, and this way the only
// thing that can open it is a passphrase that exists solely in your head and in
// the browsers you have unlocked.
//
// There are deliberately no sessions. The auth value IS the credential, and the
// browser keeps it after the first unlock — so there is no cookie to steal, no
// TTL to renew, and no per-request KV write to budget for.

/** The single vault. This is a one-person app; there is nothing to key by. */
export const VAULT_KEY = 'vault';
/** Set at deploy, consumed by the first successful init, so that the "choose a
 *  passphrase" screen cannot be claimed by whoever finds the URL first. */
export const BOOTSTRAP_KEY = 'bootstrap';

/** OWASP's floor for PBKDF2-HMAC-SHA256. Stored with the vault so it can be
 *  raised later without stranding an existing passphrase. */
export const ITERATIONS = 250_000;

/** Wrong guesses allowed per window before unlock refuses outright. */
export const MAX_ATTEMPTS = 10;
export const ATTEMPT_WINDOW = 900; // fifteen minutes

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

/** SHA-256, hex. Applied to the auth value before storing it, so a KV read does
 *  not hand anyone something they can replay straight back at us. */
export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare in time that does not depend on where the first difference is. The
 *  inputs are hashes of a high-entropy value, so this is belt and braces —
 *  but a comparison that leaks its prefix is never worth keeping. */
export function sameHash(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * Throttle unlock attempts. PBKDF2 already makes each guess expensive for the
 * caller, but nothing stops a script from trying anyway, so failures are counted
 * in KV against a fifteen-minute window.
 *
 * Only failures are written. A correct passphrase costs no KV write at all,
 * which matters on a free tier of 1,000 writes a day.
 */
export async function attemptsExceeded(env) {
  const rec = await env.V2R.get('attempts', 'json');
  return !!rec && rec.n >= MAX_ATTEMPTS;
}

export async function recordFailure(env) {
  const rec = (await env.V2R.get('attempts', 'json')) || { n: 0 };
  rec.n += 1;
  await env.V2R.put('attempts', JSON.stringify(rec), { expirationTtl: ATTEMPT_WINDOW });
}

export async function clearFailures(env) {
  await env.V2R.delete('attempts');
}

/** Guard the Functions that need storage, so a half-configured deploy says so
 *  plainly rather than throwing. */
export function needStore(env) {
  if (!env || !env.V2R) {
    return json({ error: 'storage is not configured on this deployment' }, 503);
  }
  return null;
}
