// POST /whisper -> the chsiegm box's /transcribe
//
// This exists so the browser only ever talks to its own origin. Posting straight
// to the box from the page would be cross-origin, which costs a CORS preflight
// the box has to answer and an allowlist it has to maintain. Proxying here costs
// neither: there is no origin change, so there is no preflight.
//
// It also keeps the box's shared key server-side. An earlier design kept it in
// the phone's localStorage, which meant whoever held the device held a working
// transcriber credential. Here it is a Pages secret the browser never sees:
//
//   npx wrangler pages secret put TRANSCRIBE_KEY
//
// and it must match FYI_TRANSCRIBE_KEY in the box's fyi-up.sh.

/** Where the transcriber lives. Set BOX_ORIGIN in wrangler.toml (or the Pages
 *  dashboard) to point a fork at its own machine. Anything that answers
 *  `POST /transcribe` with `{"text": "..."}` will do. */
const DEFAULT_BOX = 'https://feed.labellivestockpatents.org';

const fail = (status, error) =>
  new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  if (!env.TRANSCRIBE_KEY) return fail(503, 'the transcriber is not configured');

  const headers = new Headers();
  // Raw bytes: the contract that route speaks, since it streams the body
  // straight to faster-whisper. Anything multipart would hand Whisper the MIME
  // envelope as if it were audio.
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Authorization', `Bearer ${env.TRANSCRIBE_KEY}`);
  // Page titles, which seed Whisper's initial_prompt so proper nouns are spelled
  // rather than guessed — the whole reason this beats keyboard dictation.
  const hint = request.headers.get('X-Fyi-Hint');
  if (hint) headers.set('X-Fyi-Hint', hint);

  let res;
  try {
    res = await fetch(`${env.BOX_ORIGIN || DEFAULT_BOX}/transcribe`, {
      method: 'POST', headers, body: request.body,
    });
  } catch (e) {
    // The box, the tunnel, or the network. The app treats any failure here as
    // "carry on with the keyboard", so name it and let the page degrade.
    return fail(502, `transcriber unreachable: ${e.message}`);
  }

  if (!res.ok) return fail(502, `transcriber said ${res.status}`);
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
