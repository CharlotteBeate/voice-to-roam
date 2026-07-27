// GET  /api/vault -> {email, graph, token}   the credentials for this account
// PUT  /api/vault {graph, token}             store them (first login uploads
//                                            whatever the browser already had)
// DELETE /api/vault                          forget them
//
// The token is returned to the signed-in browser because the page talks to Roam
// directly — that is the whole architecture, and it means the token is only ever
// as exposed as the device holding the session.

import { json, requireSession } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const { s, error } = await requireSession(request, env);
  if (error) return error;
  const vault = (await env.V2R.get(`vault:${s.email}`, 'json')) || {};
  return json({ email: s.email, graph: vault.graph || null, token: vault.token || null });
}

export async function onRequestPut({ request, env }) {
  const { s, error } = await requireSession(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }
  const graph = String(body.graph || '').trim();
  const token = String(body.token || '').trim();
  if (!graph || !token) return json({ error: 'graph and token are both required' }, 400);

  await env.V2R.put(`vault:${s.email}`, JSON.stringify({ graph, token, at: Date.now() }));
  return json({ saved: true, graph });
}

export async function onRequestDelete({ request, env }) {
  const { s, error } = await requireSession(request, env);
  if (error) return error;
  await env.V2R.delete(`vault:${s.email}`);
  return json({ cleared: true });
}
