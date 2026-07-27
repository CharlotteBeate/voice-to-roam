// POST /api/vault/init  {salt, iterations, authValue, iv, ct}
//
// Sets the passphrase, once. Two locks, because this endpoint is the one that
// decides who owns the vault:
//
//   1. it refuses if a vault already exists, and
//   2. it refuses unless a bootstrap flag is present in KV.
//
// The flag is placed at deploy and deleted by the first success, so the window
// in which the "choose a passphrase" screen works at all is one you open on
// purpose. Without it, anyone who found the URL before you did could set the
// passphrase and own the vault.
//
// Re-arm it (after a deliberate reset) with:
//   npx wrangler kv key put --binding=V2R bootstrap open --remote

import { json, needStore, sha256, VAULT_KEY, BOOTSTRAP_KEY, ITERATIONS } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const bad = needStore(env);
  if (bad) return bad;

  const bootstrap = await env.V2R.get(BOOTSTRAP_KEY);
  if (!bootstrap) return json({ error: 'setup is closed' }, 403);

  const existing = await env.V2R.get(VAULT_KEY);
  if (existing) return json({ error: 'a passphrase is already set' }, 409);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  const salt = String(body.salt || '');
  const authValue = String(body.authValue || '');
  const iv = String(body.iv || '');
  const ct = String(body.ct || '');
  const iterations = Number(body.iterations) || ITERATIONS;
  if (!salt || !authValue || !iv || !ct) {
    return json({ error: 'salt, authValue, iv and ct are all required' }, 400);
  }

  await env.V2R.put(
    VAULT_KEY,
    JSON.stringify({ v: 1, salt, iterations, authHash: await sha256(authValue), iv, ct, at: Date.now() }),
  );
  // Consumed: the first-run screen closes behind you.
  await env.V2R.delete(BOOTSTRAP_KEY);
  return json({ created: true });
}
