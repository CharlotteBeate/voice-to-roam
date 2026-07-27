# Routing Whisper through the chsiegm box

The app is already wired to post recordings to `https://whisper.charlottesiegmann.com/transcribe`
(**Settings → Use chsiegm server**). The box will not accept them yet. This is the
server-side change that makes it work, and it has to be applied **on the box** —
`sshd` on `bbking2` refuses connections on port 22, so it cannot be applied or
restarted from the Mac.

## That hostname does not exist yet

`whisper.charlottesiegmann.com` has no DNS record. Before any of the below can be
tested it needs to reach the box, which means two additions:

1. **A tunnel ingress rule** in `~/.cloudflared/config.yml` on the box, above the
   catch-all 404:

   ```yaml
     - hostname: whisper.charlottesiegmann.com
       service: http://localhost:8787
   ```

   Validate with `cloudflared tunnel ingress validate` before reloading, and
   reload by restarting the tmux session rather than with `pkill`.

2. **A DNS record** pointing that name at the tunnel:

   ```bash
   cloudflared tunnel route dns eb83f4a7-d648-4514-90a4-4d25c16a7ba1 whisper.charlottesiegmann.com
   ```

Note this puts a third project's hostname on the shared tunnel, which is the same
entanglement worth untangling elsewhere — the tunnel is a platform concern that
no single app should own.

## Why it fails today

Probed from the app's origin (using the old hostname, before the rename):

```
OPTIONS https://whisper.charlottesiegmann.com/transcribe   → 404  "not found: /transcribe"
POST    https://whisper.charlottesiegmann.com/transcribe   → 401  (no session cookie)
```

Three separate problems:

1. **No preflight.** `serve.mjs` routes `/transcribe` only for `POST`, so the
   browser's `OPTIONS` preflight 404s and the real request is never sent.
2. **No CORS headers.** Only `/publications` and `/feedback` answer CORS, and only
   for `https://substack.com`.
3. **Session required.** `if (!userFor(req)) return refuse(res)` demands the
   email sign-in cookie. A cross-site cookie from `pages.dev` would need
   `SameSite=None` and credentialed CORS — more moving parts than a shared key.

## The patch

In `~/fyi-app/tools/serve.mjs`, replace this (around line 1609):

```js
      if (url.pathname === '/transcribe' && req.method === 'POST') {
        if (!userFor(req)) return refuse(res);
        return await transcribe(req, res);
      }
```

with:

```js
      if (url.pathname === '/transcribe') {
        // The phone capture page (voice-to-roam, a Cloudflare Pages origin)
        // posts recordings here, so this route answers CORS for it. Without the
        // OPTIONS arm the preflight 404s and the POST is never sent at all.
        const origin = req.headers.origin;
        if (origin === 'https://voice-to-roam.pages.dev') {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Headers',
                        'Content-Type, Authorization, X-Fyi-Hint');
          res.setHeader('Access-Control-Max-Age', '86400');
        }
        if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');
        if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
        // Either a signed-in browser session, or a shared key for clients that
        // have no session here. Without the key branch the phone cannot ever
        // authenticate, since it never completes the email sign-in flow.
        const key = process.env.FYI_TRANSCRIBE_KEY;
        const keyed = key && req.headers.authorization === `Bearer ${key}`;
        if (!keyed && !userFor(req)) return refuse(res);
        return await transcribe(req, res);
      }
```

Then add the secret to the server's environment in `~/fyi-app/fyi-up.sh`, inside
the `start_serve()` export list:

```
FYI_TRANSCRIBE_KEY=<a long random string>
```

and restart it so the new env is picked up:

```
tmux kill-session -t fyi-serve      # fyi-up.sh restarts it within 5 minutes,
~/fyi-app/fyi-up.sh                 # or immediately if you run it yourself
```

Do **not** `pkill -f serve.mjs` over ssh — the ssh command line contains that
pattern and the match kills your own shell. This is the documented footgun that
dropped the hosted feed for ~45 seconds.

Finally, put the same string into the app: **Settings → Whisper key**.

## Verify

```bash
curl -i -X OPTIONS https://whisper.charlottesiegmann.com/transcribe \
  -H "Origin: https://voice-to-roam.pages.dev" \
  -H "Access-Control-Request-Method: POST"
# expect 204 with access-control-allow-origin: https://voice-to-roam.pages.dev
```

## What this costs

This is a deliberate coupling. The three projects are otherwise independent, and
turning this on means the phone's transcription depends on the MIT box, the
shared cloudflared tunnel, and `fyi-up.sh` — all of which the Roam capture path
was designed to avoid needing.

The blast radius is bounded: the app degrades rather than breaks. If the endpoint
is unreachable it says so and you carry on with the keyboard microphone, and
saving to Roam never touches the box at all. Leave the endpoint blank in Settings
to opt out entirely.

Note also that the shared key lives in the phone's `localStorage`, so anyone with
the device can use your transcriber. That is the same trust boundary as the Roam
token already stored there.
