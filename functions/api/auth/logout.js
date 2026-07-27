// POST /api/auth/logout — ends this device's session. The stored credentials
// stay in the vault; other devices are unaffected.

import { json, session, clearCookie } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  if (env && env.V2R) {
    const s = await session(request, env);
    if (s) await env.V2R.delete(`sess:${s.id}`);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
