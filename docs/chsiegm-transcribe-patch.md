# Routing Whisper through the chsiegm box

**Status: done and working.** This records what was changed and why the shape
differs from what an earlier draft of this file proposed.

The box has the GPU and the `large-v3-turbo` weights, so it does the
transcription. Relying on it for this is a deliberate choice, not a compromise:
it roughly halves the error rate on the two cases keyboard dictation handles
worst — proper nouns and mixed German/English.

## The shape

```
phone  ──POST audio──>  <this app>/whisper        (same origin, no CORS)
                            │  functions/whisper.js, holding TRANSCRIBE_KEY
                            └──> feed.labellivestockpatents.org/transcribe
                                     │  serve.mjs on the box, via the tunnel
                                     └──> faster-whisper
```

The browser only ever talks to its own origin. Everything else is server-side.

## Why not a separate hostname

An earlier plan gave Whisper its own `whisper.charlottesiegmann.com`. That would
have needed a DNS record, a tunnel ingress rule, a CORS preflight arm on the
box, and an `Access-Control-Allow-Origin` allowlist to maintain. Proxying through
a Function of this app needs none of them — **there is no origin change, so there
is no preflight.** Four moving parts deleted by choosing a path over a hostname.

That hostname was never created, and should not be. A device configured against
it before the move fails with nothing but "Failed to fetch", because the name is
NXDOMAIN and the browser cannot distinguish that from the network being down. The
app now rewrites any such stale setting on load.

## Why the key is not on the phone

The earlier plan put the box's shared key in Settings, and admitted the cost:
"anyone with the device can use your transcriber."

It is now a **Pages secret** read by `functions/whisper.js`. The browser posts to
its own origin and never sees it. A stolen phone carries no transcriber
credential.

```bash
npx wrangler pages secret put TRANSCRIBE_KEY
```

## The box side

`~/fyi-app/tools/serve.mjs`, the `/transcribe` route — a bearer key is accepted
as an alternative to the session cookie, because the Function has no session
there and never will:

```js
const key = process.env.FYI_TRANSCRIBE_KEY;
const given = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
const keyed = !!key && given === key;
if (!keyed && !userFor(req)) return refuse(res);
return await transcribe(req, res);
```

**No CORS arm is needed**, which is the whole saving over the earlier draft.

`FYI_TRANSCRIBE_KEY` is exported in `~/fyi-app/fyi-up.sh`'s `start_serve()` and
must match the Pages secret.

## Restarting the box to pick up a change

`sshd` on `bbking2` refuses connections on port 22, so this cannot be done over
ssh — but `/Volumes/chsiegm` is that box's home over SMB, so the files are
editable directly. To restart:

```bash
touch /Volumes/chsiegm/fyi-app/logs/.restart-requested
```

`fyi-up.sh` runs on a five-minute cron, sees the file, restarts the tmux session
and deletes it.

Do **not** `pkill -f serve.mjs` — an ssh command line contains that pattern and
the match kills your own shell. That footgun once dropped the hosted feed for
about 45 seconds.

## Verifying

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://voice-to-roam.pages.dev/whisper \
  -H 'Content-Type: application/octet-stream' --data-binary 'xxxx'
```

**502 is the healthy answer here.** It means the Function reached the box, the
box accepted the key, and faster-whisper refused four bytes of junk as not being
audio. A **503** means `TRANSCRIBE_KEY` is unset on Pages; a body of
`transcriber unreachable` means the box or the tunnel is down.

Note what this does *not* prove: that transcription returns usable text. Only
recording actual speech does that.

## What it costs

Transcription depends on the MIT box, the shared cloudflared tunnel, and
`fyi-up.sh`. That is accepted.

The blast radius stays small by construction: **saving to Roam never touches the
box**, and if the transcriber is unreachable the app says so and you carry on
with the keyboard microphone. Capture keeps working whatever happens here.
