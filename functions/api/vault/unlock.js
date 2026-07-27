// POST /api/vault/unlock  {authValue} -> {iv, ct}
//
// The only way to get the ciphertext. It costs a correct auth value — which
// costs the passphrase and a quarter of a million PBKDF2 rounds to derive — and
// wrong guesses are counted against a fifteen-minute window.
//
// The server still cannot read the token it is handing back: the key that
// decrypts it was derived in the browser from a different salt and never sent.

import {
  json, needStore, sha256, sameHash, VAULT_KEY,
  attemptsExceeded, recordFailure, clearFailures,
} from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const bad = needStore(env);
  if (bad) return bad;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  if (await attemptsExceeded(env)) {
    return json({ error: 'too many attempts — wait fifteen minutes and try again' }, 429);
  }

  const vault = await env.V2R.get(VAULT_KEY, 'json');
  if (!vault) return json({ error: 'no passphrase has been set' }, 409);

  const authValue = String(body.authValue || '');
  if (!sameHash(await sha256(authValue), vault.authHash)) {
    await recordFailure(env);
    return json({ error: 'wrong passphrase' }, 401);
  }

  // Only a success clears the counter, and only a failure writes to KV — so the
  // ordinary path costs no write at all.
  await clearFailures(env);
  return json({ iv: vault.iv, ct: vault.ct });
}
