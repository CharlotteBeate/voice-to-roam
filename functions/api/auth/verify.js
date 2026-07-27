// POST /api/auth/verify  {email, pin} -> sets the session cookie.

import {
  json, allowed, normEmail, hash, randomId, setCookie, SESSION_TTL, MAX_ATTEMPTS,
} from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.V2R) return json({ error: 'storage is not configured on this deployment' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  const email = normEmail(body.email);
  const pin = String(body.pin || '').trim();
  if (!allowed(env).includes(email)) return json({ error: 'that code is not valid' }, 401);

  const rec = await env.V2R.get(`pin:${email}`, 'json');
  if (!rec) return json({ error: 'that code has expired — request a new one' }, 401);

  // Burn the record once the attempts are spent, so a wrong guess cannot be
  // retried indefinitely against a live code.
  if ((rec.tries || 0) >= MAX_ATTEMPTS) {
    await env.V2R.delete(`pin:${email}`);
    return json({ error: 'too many attempts — request a new code' }, 429);
  }

  if (await hash(pin, rec.salt) !== rec.h) {
    rec.tries = (rec.tries || 0) + 1;
    await env.V2R.put(`pin:${email}`, JSON.stringify(rec), { expirationTtl: 600 });
    return json({ error: 'that code is not valid' }, 401);
  }

  await env.V2R.delete(`pin:${email}`);           // single use
  const id = randomId();
  await env.V2R.put(
    `sess:${id}`,
    JSON.stringify({ email, created: Math.floor(Date.now() / 1000), touched: Math.floor(Date.now() / 1000) }),
    { expirationTtl: SESSION_TTL },
  );

  const vault = await env.V2R.get(`vault:${email}`, 'json');
  return json(
    { email, graph: (vault && vault.graph) || null, hasToken: !!(vault && vault.token) },
    200,
    { 'Set-Cookie': setCookie(id) },
  );
}
