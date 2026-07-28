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

Say the title as part of the note — *"Title, DML coverage. The second wave
looks…"* — and it lands like this:

```
July 27th, 2026                    <- today's daily note
└── [[DML Coverage]]               <- a block holding just the link
    └── The second wave looks…     <- your words, the instruction removed
        └── transcript: …          <- folded away, only if the body was cut
```

**A note is never bare text at the top level of a day.** It is always under a
title, so the day reads as a list of subjects and every note is reachable from
the linked references of the page it is about. Saving with no title is refused
rather than silently flattened.

- **Titling** — the model on the chsiegm box reads the transcript and returns the
  title, the cleaned body and any references. If you said what to call it, that
  is used; otherwise it writes a short one. An existing page is preferred over a
  near-duplicate, because a graph split across "DML Coverage" and "DML coverage
  notes" is worse than either. The title appears in an editable field *before*
  you save, so a wrong guess is fixed in place rather than found later as a stray
  page.
- **Cleaning** — the body is a **delete-only** edit: the spoken instruction
  ("title X", "brain dump") and filler come out, every other word stays exactly
  as spoken, in the same order and the same language. This is **verified, not
  trusted** — the result must be a subsequence of the transcript, or it is
  discarded and your words are kept as they were. A prompt can ask for
  delete-only; only the check enforces it, and a summary saved over your words is
  the kind of loss you notice far too late.
- **Editing** — a plain textarea. Tap the microphone on your Gboard keyboard, or
  press **Record** for Whisper on the box. Nothing is sent until you press Save.
- **Linking titles** — pulls every page title and uid from your graph
  (`[:find ?title ?uid :where [?e :node/title ?title] [?e :block/uid ?uid]]`),
  caches them, and offers any it spots in your text as tap-to-link chips.
  Longest title wins, so "DML Coverage" beats "DML", and text already inside
  `[[...]]` is masked out so re-scanning never nests brackets.
- **References** — only where you explicitly asked to link something ("reference
  X", "link to X" — *not* "a tag called X", which is naming). Each resolves
  against pages that already exist; what matches is appended as `[[…]]`, and what
  does not becomes a `couldn't link: "x"` line, since a link to a page that does
  not exist is a typo with brackets round it.
- **Choosing the destination** — defaults to today's daily note; the **Page**
  button searches your titles to file it somewhere specific instead. Choosing a
  page explicitly writes straight onto it — you have already said where it goes,
  so no title is asked for.
- **Offline** — a service worker caches the app shell, and notes captured with no
  signal are queued in `localStorage` and flushed when you reconnect. The title
  and references queue with the note, so replaying never needs the model again.

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

## 3. Deploy — live at https://voice.charlottesiegmann.com

Already deployed. To ship a change:

```bash
/Volumes/chsiegm/voice-to-roam/deploy.sh
```

A dedicated origin matters: `localStorage` is scoped per origin, so a subdomain
of its own keeps the token unreadable by anything else on the domain.

### Why a subdomain, and not charlottesiegmann.com/transcribe-whisper

That path was built, with a Worker proxying it to this project, and **it cannot
be made to work.** The origin of `charlottesiegmann.com` is Squarespace,
Squarespace is itself a Cloudflare customer, and when Cloudflare hands a request
down to another Cloudflare zone, everything configured on ours is skipped —
Worker routes included. The Worker is simply never invoked.

It fails *intermittently*, which is what makes it dangerous: a single passing
`curl` was taken as proof the arrangement worked, and it was not. The tell is the
response headers:

```bash
curl -sI https://www.charlottesiegmann.com/transcribe-whisper/ | grep -i 'cf-ray\|server'
# server: Squarespace   and NO cf-ray  ->  our zone never saw it
```

No `cf-ray` means no Cloudflare configuration of ours will ever apply, no matter
what is deployed. `/cdn-cgi/trace` going unanswered on the hostname says the same
thing. If the path-style URL is ever wanted for looks, add a **Squarespace URL
redirect** to the subdomain — a redirect is something Squarespace can do itself.

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

Then on the phone: open `https://voice.charlottesiegmann.com`, press **Unlock**,
enter your passphrase, and use Chrome's **⋮ → Add to Home screen**. The graph and
token arrive with the unlock — you never type them there.

Note that any unmatched path (`/anything`) serves `index.html` with a 200 — that
is Cloudflare Pages' single-page fallback, not a routing bug.

## 4. Whisper on the chsiegm box instead of Gboard

The box does the transcription, and that is a deliberate choice rather than a
compromise: it has the GPU and the `large-v3-turbo` weights, and it roughly
halves the error rate on the two cases Gboard handles worst — proper nouns and
mixed German/English.

Fill in **Whisper endpoint** in Settings (**Use chsiegm server** fills it in) and
a **Record** button appears. Audio is posted as raw `application/octet-stream` —
the contract that route speaks, since it streams the body straight to
faster-whisper — and page titles ride along in `X-Fyi-Hint`, which seeds
Whisper's `initial_prompt` so names are spelled rather than guessed.

The endpoint is `whisper`, **on this app's own origin**. A Worker in front of
`charlottesiegmann.com/transcribe-whisper` proxies it to the box, which is worth
more than it sounds:

- **No CORS at all.** Nothing is cross-origin any more, so there is no preflight
  to answer and no `Access-Control-Allow-Origin` allowlist to maintain on the
  box. An earlier design needed both.
- **No second hostname.** No `whisper.<domain>` DNS record, no extra tunnel
  ingress rule.
- **The shared key never reaches the phone.** It is a Worker secret. An earlier
  design kept it in `localStorage`, which meant whoever held the device held a
  transcriber credential.

The transcript lands in the textarea *still editable*, so a bad transcription is
never committed blindly. If the box or the tunnel is down the app says so and you
carry on with the keyboard — and saving to Roam does not touch the box at all, so
capture keeps working regardless.

## Files

- `web/index.html` — the whole app (no build step, no dependencies).
- `web/sw.js`, `web/manifest.webmanifest`, `web/icon.svg` — offline + installable.
- `post-to-roam.sh` — reference implementation and verification tool (Mac).
- `http-shortcuts-script.js` — alternative for the
  [HTTP Shortcuts](https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts)
  Android app: dictate and save with no hosting at all, but plain-text only —
  no title chips, no destination search.
