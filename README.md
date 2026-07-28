# Note to Roam — speak a thought on your phone, file it in Roam

Speak a note, edit it, and save it into [Roam Research](https://roamresearch.com)
under a page title — from a phone, with no desktop involved and nothing running
at home. The whole app is one static HTML file plus four small serverless
functions.

**Live at <https://voice.charlottesiegmann.com>.** It is a personal deployment
with one passphrase; the sections below are for running your own.

```
July 27th, 2026                    <- today's daily note
└── [[DML Coverage]]               <- a block holding just the link
    └── The second wave looks…     <- your words, the spoken instruction removed
        └── transcript: …          <- folded away, only if the body was cut
```

Say *"Title, DML coverage. The second wave looks…"* and that is what you get.

---

## Why it works this way

**Your desktop cannot be in the path.** Roam's local API binds to
`127.0.0.1:3333`, and loopback is reachable only from that machine — no phone, no
laptop on the same Wi-Fi, ever. A page that writes through it loads fine over the
internet and then fails at the hand-off. That is a design limit, not a setting to
repair. This app talks to Roam's **hosted** API instead, which is on the public
internet and always up.

**A note is never bare text at the top of a day.** Loose in a daily note, it is
findable only by scrolling that day. Under a `[[Title]]` block it is reachable
from the linked references of the page it is *about*, and the day reads as a list
of subjects. Saving with no title is refused rather than silently flattened.

**The body is a delete-only edit, and that is checked.** The model removes the
instruction you spoke ("title X", "brain dump") and the filler, and must leave
every other word exactly as spoken. The result is verified to be a *subsequence*
of the transcript — any substitution or addition fails and your raw words are
kept. A prompt can ask for delete-only; only the check enforces it, and a summary
written over your words is a loss you notice far too late.

**The server cannot read your Roam token.** It is AES-GCM ciphertext in KV,
opened by a key derived from your passphrase in the browser. That token can
rewrite your entire graph, so the storage holding it should not be able to.

---

## What it does

- **Titling** — the model returns the title, the cleaned body and any references.
  If you said what to call it, that is used; otherwise it writes a short one. An
  existing page is preferred over a near-duplicate, because a graph split across
  "DML Coverage" and "DML coverage notes" is worse than either. The title appears
  in an editable field *before* you save.
- **Transcription** — press **Record** for Whisper on your own machine, or use
  your keyboard's microphone. Whisper is markedly better on proper nouns and
  mixed-language speech; the transcript lands still editable, so a bad one is
  never committed blindly.
- **Linking** — pulls every page title from your graph and offers any it spots in
  your text as tap-to-link chips. Longest title wins, so "DML Coverage" beats
  "DML", and text already inside `[[…]]` is masked so re-scanning never nests
  brackets. Matching ignores case, accents and plurals, so dictating "munchen"
  still finds `[[München]]`.
- **References** — only where you explicitly asked to link something ("reference
  X", "link to X" — *not* "a tag called X", which is naming). Each resolves
  against pages that already exist; matches are appended as `[[…]]`, misses
  become a `couldn't link: "x"` line. A link to a page that does not exist is a
  typo with brackets round it.
- **Offline** — a service worker caches the app shell, and notes captured with no
  signal are queued in `localStorage` and flushed on reconnect. Titles and
  references queue with them, so replaying never needs the model again.
- **One passphrase** — type your graph and token once, on one device. Every other
  device unlocks with the passphrase and inherits them.

---

## Run your own

You need a Cloudflare account (free tier is enough) and a Roam graph. **A GPU
machine is optional** — without one you type titles yourself and use your
keyboard's microphone, and everything else works unchanged.

### 1. Fork and get a Roam token

Roam → **Settings → Graph → API tokens → New API token**, with **write** access.
Note your graph name — the `<graph>` in your Roam URL.

> The token can read and rewrite your whole graph. Keep it out of git and chat.

### 2. Create the KV namespace

```bash
npx wrangler kv namespace create V2R
```

Put the printed id into `wrangler.toml` under `[[kv_namespaces]]`, and change
`name` to your own project name.

### 3. Deploy

```bash
npx wrangler pages project create <your-project> --production-branch=main
npx wrangler pages deploy web --project-name=<your-project> --branch=main
```

The branch must match the project's production branch or Cloudflare serves the
deployment at a preview URL instead of the stable one. `deploy.sh` in this repo
pins `--branch` for exactly that reason.

### 4. Open the one-time setup window

```bash
npx wrangler kv key put --binding=V2R bootstrap open --remote
```

Then open the site, choose a passphrase, and add your graph and token in
**Settings**. The first successful setup deletes the flag, so the "choose a
passphrase" screen cannot be claimed by whoever finds the URL next. Re-run the
command if you ever need to reset deliberately.

**Set the passphrase on the device that holds the token.** That first save seals
what the browser has into the vault. Doing it on an empty device seals an empty
vault, and the phone has nothing to inherit.

### 5. Optional: your own Whisper and model

Point `BOX_ORIGIN` in `wrangler.toml` at a machine of yours, and set the shared
key both ends:

```bash
npx wrangler pages secret put TRANSCRIBE_KEY
```

That machine must answer two routes, both authenticated with
`Authorization: Bearer <TRANSCRIBE_KEY>`:

| Route | In | Out |
|---|---|---|
| `POST /transcribe` | raw audio bytes, `application/octet-stream` | `{"text": "..."}` |
| `POST /complete` | `{system, user, schema}` | `{"result": <object matching schema>}` |

`/complete` must honour a strict JSON schema — any OpenAI-compatible server with
`response_format: json_schema` does, including Ollama and llama.cpp. This repo
talks to [`fyi-app`](https://instructfeed.com)'s `serve.mjs`, which fronts
`faster-whisper` and Ollama; anything with the same two shapes is a drop-in.

Leave `TRANSCRIBE_KEY` unset and both features simply switch off, cleanly.

---

## How it is put together

| Piece | Where |
|---|---|
| The whole UI | `web/index.html` — no build step, no dependencies |
| Offline shell | `web/sw.js`, `manifest.webmanifest` |
| Passphrase vault | `functions/api/vault*` + Workers KV |
| Transcription proxy | `functions/whisper.js` |
| Title + cleanup | `functions/title.js` |

Both proxies exist so the browser only ever talks to its own origin: no CORS
preflight to answer, no allowlist to maintain, and the shared key stays
server-side instead of sitting in a phone's `localStorage`.

Deeper notes: [`docs/accounts.md`](docs/accounts.md) for the crypto and its
tradeoffs, [`docs/chsiegm-transcribe-patch.md`](docs/chsiegm-transcribe-patch.md)
for the machine-side integration.

### Two traps worth knowing before you copy this

- **`edge/` is deployed to nothing, on purpose.** It served the app from a path
  under a Squarespace-hosted domain, which cannot work — that hostname is not
  delegated to Cloudflare, so the Worker route is never invoked. It failed
  *intermittently*, and one passing probe was mistaken for a working setup. Give
  the app a subdomain of its own. [`edge/README.md`](edge/README.md) has the
  diagnosis and the symptoms to recognise.
- **`localStorage` is per-origin.** Move the app to a different hostname and
  devices unlock again — nothing is lost, but it is not free.

---

## The tradeoff you accept

**Forget the passphrase and the stored token cannot be recovered** — not by
Cloudflare, not by anyone. That is what "the server cannot read it" means in
practice. Recovery is minting a fresh token in Roam, which is one click, but it
is a real change from a scheme where a lost credential could be mailed back.

## Files

- `web/index.html` — the entire app.
- `functions/` — the vault, the transcription proxy, the titler.
- `post-to-roam.sh` — reference implementation and a way to prove your token
  works before blaming the phone. `--dry-run` prints the JSON and sends nothing.
- `http-shortcuts-script.js` — a no-hosting alternative for the
  [HTTP Shortcuts](https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts)
  Android app: dictate and save, plain text only, no titles or chips.
