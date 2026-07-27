// GET /api/vault  -> {exists, salt, iterations, bootstrap}
//     The salt and iteration count are public by design: the browser needs them
//     to derive anything at all, and they are useless without the passphrase.
//
// PUT /api/vault  {authValue, iv, ct} -> replaces the stored ciphertext.
//     Used when you change the graph or token on an already-unlocked device.
//
// What is never here: a GET that returns the ciphertext. Handing the encrypted
// token to anyone who knows the URL would invite an offline attack on the
// passphrase at their leisure, so the ciphertext comes only from /unlock, which
// costs a correct auth value and is rate limited.

import { json, needStore, sha256, sameHash, VAULT_KEY, BOOTSTRAP_KEY, ITERATIONS } from '../_lib.js';

export async function onRequestGet({ env }) {
  const bad = needStore(env);
  if (bad) return bad;

  const vault = await env.V2R.get(VAULT_KEY, 'json');
  if (!vault) {
    // No passphrase set yet. Whether the first-run screen is offered at all
    // depends on the bootstrap flag, so someone who finds the URL before you do
    // cannot claim the vault.
    const bootstrap = await env.V2R.get(BOOTSTRAP_KEY);
    return json({ exists: false, bootstrap: !!bootstrap });
  }
  return json({ exists: true, salt: vault.salt, iterations: vault.iterations ?? ITERATIONS });
}

export async function onRequestPut({ request, env }) {
  const bad = needStore(env);
  if (bad) return bad;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  const vault = await env.V2R.get(VAULT_KEY, 'json');
  if (!vault) return json({ error: 'no passphrase has been set' }, 409);

  const authValue = String(body.authValue || '');
  if (!sameHash(await sha256(authValue), vault.authHash)) {
    return json({ error: 'wrong passphrase' }, 401);
  }

  const iv = String(body.iv || '');
  const ct = String(body.ct || '');
  if (!iv || !ct) return json({ error: 'iv and ct are both required' }, 400);

  await env.V2R.put(
    VAULT_KEY,
    JSON.stringify({ ...vault, iv, ct, at: Date.now() }),
  );
  return json({ saved: true });
}
