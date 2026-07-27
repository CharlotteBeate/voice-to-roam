# voice-to-roam — capture from the phone, straight into Roam

Speak a thought on your Samsung, edit it, link it to existing pages, and save it
into Roam. Your Mac is not in the path — it can be asleep, shut, or on another
continent.

## Why the old way could not work

The Voice→Roam web page wrote through **Roam's local API on the Mac**, which the
desktop app binds to `127.0.0.1:3333`. `127.0.0.1` is loopback: reachable *only
from the Mac itself*. No phone, no other laptop, nothing on the same Wi-Fi can
open that socket. So the page loaded fine over the internet and then failed at
the hand-off — "can't find computer". That is a design limit of that page, not a
setting to repair.

The fix is not a different transport to your Mac. It is to stop involving your
Mac: **Roam's hosted backend API** is on the public internet and always up.

## Two facts that make a serverless page possible

Both verified directly against the API, not assumed:

**1. Roam's API allows browser calls from any origin.** A preflight to
`/api/graph/<graph>/q` returns:

```
Access-Control-Allow-Origin: <your origin, reflected>
Access-Control-Allow-Headers: Authorization, Content-Type
```

on the entry host *and* on the peer host behind it. So a static page can talk to
Roam directly — no backend, no proxy, nothing to keep running.

**2. The write endpoint redirects across origins.** It answers **308**:

```
HTTP/1.1 308 Permanent Redirect
Location: https://peer-74.api.roamresearch.com:3002/api/graph/<graph>/write
```

Browsers **strip the `Authorization` header** when a redirect changes origin, and
`curl -L` does too, so following it with credentials yields a **401 that looks
exactly like a bad token**. The peer also varies per graph, so it cannot be
hard-coded.

`index.html` therefore resolves the peer once with an unauthenticated probe
(reading the final `response.url`), caches it, and addresses the peer directly
ever after — no redirect, header intact. `post-to-roam.sh` uses
`--location-trusted` instead of `-L` for the same reason.

## What the app does

- **Editing** — a plain textarea. Tap the microphone on your Gboard keyboard,
  speak, then fix the transcript. Nothing is sent until you press Save.
- **Linking titles** — pulls every page title and uid from your graph
  (`[:find ?title ?uid :where [?e :node/title ?title] [?e :block/uid ?uid]]`),
  caches them, and offers any it spots in your text as tap-to-link chips.
  Longest title wins, so "DML Coverage" beats "DML", and text already inside
  `[[...]]` is masked out so re-scanning never nests brackets.
- **Choosing the destination** — defaults to today's daily note; the **Page**
  button searches your titles to file it somewhere specific instead.
- **Offline** — a service worker caches the app shell, and notes captured with
  no signal are queued in `localStorage` and flushed when you reconnect.

## 1. Get a graph token

Roam → **Settings → Graph → API tokens → New API token**, with **write** access.
Note your graph name (the `<graph>` in your Roam URL).

The token can read and rewrite your whole graph. Keep it out of git and chat.

## 2. Prove the API works, from the Mac

Do this first, so a later failure is a phone problem and not an API problem.

```bash
export ROAM_GRAPH=your-graph-name
export ROAM_API_TOKEN=roam-graph-token-...
/Volumes/chsiegm/voice-to-roam/post-to-roam.sh "hello from the api"
```

`--dry-run` prints the exact JSON and sends nothing.

## 3. Deploy — live at https://voice-to-roam.pages.dev

Already deployed. To ship a change:

```bash
/Volumes/chsiegm/voice-to-roam/deploy.sh
```

A dedicated `*.pages.dev` origin matters: `localStorage` is scoped per origin, so
a project of its own keeps the token unreadable by anything else you host.

**Why `deploy.sh` rather than a bare wrangler command.** Cloudflare serves the
stable `voice-to-roam.pages.dev` only from a *production* deployment, and a
deployment is production only when its branch matches the project's configured
production branch — here, `voice-to-roam`. Wrangler otherwise infers the branch
from whatever git repo the shell is standing in. The first deploy was tagged
`master`, inherited from the unrelated `following-your-instruction` checkout, and
the bare domain 404'd while only `master.voice-to-roam.pages.dev` existed — which
in turn failed TLS, because Cloudflare's second-level wildcard certificate for
branch subdomains is not reliably provisioned. `deploy.sh` passes
`--branch=voice-to-roam` so this cannot recur, and this repo's own branch is
named `voice-to-roam` for the same reason.

Then on the phone: open `https://voice-to-roam.pages.dev`, press **Settings**,
enter the graph name and token, and use Chrome's **⋮ → Add to Home screen**.

Note that any unmatched path (`/anything`) serves `index.html` with a 200 — that
is Cloudflare Pages' single-page fallback, not a routing bug.

## 4. Optional: Whisper on the chsiegm box instead of Gboard

Off unless you fill in **Whisper endpoint** in Settings; **Use chsiegm server**
fills in `https://instructfeed.com/transcribe`, the route the box already
exposes. A **Record** button then appears. Audio is posted as raw
`application/octet-stream` — the contract that route speaks, since it streams the
body straight to faster-whisper — and page titles ride along in `X-Fyi-Hint`,
which seeds Whisper's `initial_prompt` so proper nouns are spelled rather than
guessed. That is precisely where Gboard is weakest on names and mixed
German/English.

The transcript lands in the textarea *still editable*, so a bad transcription is
never committed blindly, and if the endpoint is unreachable the app says so and
you carry on with the keyboard.

**The box does not accept these requests yet.** `/transcribe` has no CORS
preflight and requires the email sign-in cookie, so the browser is blocked before
the POST is even sent. The server-side change, and why it cannot be applied from
the Mac, is in [`docs/chsiegm-transcribe-patch.md`](docs/chsiegm-transcribe-patch.md).

Be clear-eyed about what enabling this costs: it puts the MIT box, the shared
cloudflared tunnel, and `fyi-up.sh` back in the path — exactly the fragility this
project was built to avoid. Saving to Roam never touches the box, and the app
degrades to the keyboard rather than breaking, which is the only reason it is
safe to offer at all.

## Files

- `web/index.html` — the whole app (no build step, no dependencies).
- `web/sw.js`, `web/manifest.webmanifest`, `web/icon.svg` — offline + installable.
- `post-to-roam.sh` — reference implementation and verification tool (Mac).
- `http-shortcuts-script.js` — alternative for the
  [HTTP Shortcuts](https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts)
  Android app: dictate and save with no hosting at all, but plain-text only —
  no title chips, no destination search.
