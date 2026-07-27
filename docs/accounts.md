# Sign-in: one passphrase, and nothing else

You choose a passphrase. It unlocks your Roam graph name and token on any device,
so you type the token exactly once, ever — never on the phone.

There is no email, no code, no account, and deliberately **no session cookie**.

## How it is put together

| Piece | Where |
|---|---|
| Vault API | Cloudflare Pages Functions, `functions/api/vault*` |
| The stored blob | Workers KV, binding `V2R`, one key: `vault` |
| Key derivation and decryption | your browser, WebCrypto |

The passphrase never reaches the server. The browser derives two values from it
with PBKDF2-HMAC-SHA256, 250,000 iterations, using the same salt but different
purposes:

- **auth** — sent to the server, which stores only a SHA-256 of it. It gates
  reading the ciphertext and writing a new one.
- **enc** — never sent. The AES-GCM key that actually opens the Roam token.

So KV holds a hash and a ciphertext. Reading the entire namespace yields neither
the passphrase nor the token.

**Why bother, for one person?** Because that token can read and rewrite the whole
graph. The earlier design stored it in KV in plaintext and said so plainly: "the
server can read it… anyone with access to your Cloudflare account reaches it
too." This removes that sentence rather than restating it.

## No sessions

The auth value *is* the credential, and the browser keeps it in `localStorage`
after the first unlock. There is no cookie to steal, no TTL to renew, and no
per-request KV write to budget for. **Forget on this device** deletes the local
copy; the vault and every other device are untouched, because there is no session
anywhere to end.

Keeping derived key material in `localStorage` alongside the decrypted token adds
no exposure — the token is already there, and that is the boundary either way.

## First run

`POST /api/vault/init` sets the passphrase, and refuses twice over: once if a
vault already exists, and once unless a `bootstrap` key is present in KV. The
flag is placed deliberately and deleted by the first success, so the window in
which the "choose a passphrase" screen works is one you open on purpose — not one
that stands open for whoever finds the URL first.

To re-arm it after a deliberate reset:

```bash
npx wrangler kv key put --binding=V2R bootstrap open --remote
```

**Set the passphrase on the device that already holds the token.** That first
save seals what the browser has into the vault. Doing it on an empty device seals
an empty vault, and there is nothing for the phone to inherit.

## Getting it onto your phone

Open the app, press **Unlock**, type the passphrase. Graph and token arrive
decrypted. Then Chrome's **⋮ → Add to Home screen**.

`localStorage` is per-origin, so a copy installed from a different hostname does
not carry over — you would unlock once more there.

## Rate limiting

Failed unlocks are counted in KV against a fifteen-minute window; ten wrong
guesses and it refuses outright. Only failures write to KV — a correct passphrase
costs no write at all, which is what keeps this inside the free tier's 1,000
writes a day.

PBKDF2 at 250,000 iterations already makes each guess cost real work on the
caller's side. The counter is for the script that does not care.

## What is deliberately true

- **The vault is additive.** Every call fails soft. If KV is down, or the
  Functions are not deployed, the app falls back to the graph and token in
  Settings and you can still capture a note. It can cost you convenience, never
  a note.
- **The ciphertext is never handed out on a GET.** Only `/api/vault/unlock`
  returns it, and only for a correct auth value. Serving it to anyone who knows
  the URL would invite an offline attack on the passphrase at their leisure.
- **`api/` is never cached by the service worker**, and the guard is anchored to
  the worker's own scope rather than to `/api/` — a root-anchored test silently
  stops matching if the app is ever served under a path prefix, and a cached
  vault response is exactly the bug worth not having.

## The tradeoff you accepted

**If you forget the passphrase, the stored token cannot be recovered.** Not by
Cloudflare, not by me, not by you — that is what "the server cannot read it"
means in practice.

The recovery is cheap: mint a fresh token in Roam's settings, one click, and set
a new passphrase. But it is a real change from a scheme where a lost credential
could be mailed back to you, and it is the price of the server not holding
anything worth stealing.
