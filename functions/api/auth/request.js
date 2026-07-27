// POST /api/auth/request  {email} -> emails a 6-digit PIN.
//
// Pages Functions cannot send email — the send_email binding is Workers-only —
// so this hands off to the mailer Worker over a service binding (MAILER).

import { json, allowed, normEmail, hash, randomPin, randomId, PIN_TTL } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.V2R) return json({ error: 'storage is not configured on this deployment' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  const email = normEmail(body.email);
  // Always answer the same way, so this cannot be used to discover which
  // addresses exist. The allowlist check still happens, it just stays quiet.
  const ok = json({ sent: true });
  if (!allowed(env).includes(email)) return ok;

  // One live PIN at a time, and a floor between sends, so a held-down button
  // cannot flood the inbox or the mailer's quota.
  const existing = await env.V2R.get(`pin:${email}`, 'json');
  if (existing && Date.now() - existing.at < 30_000) return ok;

  const pin = randomPin();
  const salt = randomId().slice(0, 16);
  await env.V2R.put(
    `pin:${email}`,
    JSON.stringify({ h: await hash(pin, salt), salt, at: Date.now(), tries: 0 }),
    { expirationTtl: PIN_TTL },
  );

  if (!env.MAILER) {
    return json({ error: 'the mailer is not wired up on this deployment yet' }, 503);
  }
  const sent = await env.MAILER.fetch('https://mailer/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: email, pin }),
  });
  if (!sent.ok) {
    return json({ error: `could not send the code (${sent.status})` }, 502);
  }
  return ok;
}
