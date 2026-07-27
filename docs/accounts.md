# Sign-in, so the key follows you between devices

Sign in with your email and a 6-digit code; your graph name and Roam token are
stored against the account and restored on any device you sign in on. You type
them once, ever.

## How it is put together

| Piece | Where |
|---|---|
| Sign-in + vault API | Cloudflare Pages Functions, `functions/` |
| Accounts, sessions, credentials | Workers KV, binding `V2R` |
| The PIN email | a separate Worker, `mailer/` |

The mailer is separate for one reason: **Pages Functions cannot hold a
`send_email` binding.** They support KV, D1, R2, Durable Objects, service
bindings and more — not email. So Pages calls the mailer over a service binding,
and the mailer does the sending. It has no public URL (`workers_dev = false`);
the only way in is that binding.

Cloudflare delivers free to **verified destination addresses** only. For most
apps that is crippling — they need arbitrary recipients. Here there is exactly
one recipient, so the free path fits exactly.

## Remaining setup (Cloudflare dashboard — nobody else can do this)

`charlottesiegmann.com` is already on Cloudflare (`josh`/`harlee.ns.cloudflare.com`),
so no domain move is needed.

1. **Email → Email Routing**, and enable it **on the subdomain
   `mail.charlottesiegmann.com`** — not on the root.
2. **Destination addresses → add `chsiegm@mit.edu`**. Cloudflare emails you a
   link; click it. Until this is done, sending fails and the app says so.

**Why the subdomain matters.** The root domain's MX records currently point at
Namecheap's `eforward*.registrar-servers.com`. Enabling Email Routing on the root
would replace them and silently break whatever forwarding you have on
`@charlottesiegmann.com`. Cloudflare supports Email Routing on a subdomain of the
same zone, which adds MX records only there and leaves the root untouched.

The sender is `noreply@mail.charlottesiegmann.com` (`mailer/src/index.js`), which
must belong to a domain or subdomain onboarded to Email Service.

Keep `mail.` separate from any subdomain you point at the app itself: a Pages
custom domain needs a CNAME, and a name cannot carry both a CNAME and MX records.

## Getting your existing key onto your phone

Sign in **on the computer that already has the key in Settings** first. On that
first sign-in the browser uploads what it holds to your account. Then sign in on
the phone and it inherits both graph and token.

Doing it the other way round signs you in on a phone with an empty vault, and
there is nothing to inherit.

## Staying signed in

Sessions last a year and renew on use, so a device you actually capture from
never asks again. The cookie is `HttpOnly; Secure; SameSite=Lax`, so page scripts
cannot read it. **Sign out** ends that device only; the vault and other devices
are untouched.

Renewal is throttled to once a day on purpose: the KV free tier allows 1,000
writes a day, and writing on every request would exhaust it.

## What is deliberately true

- **Sign-in is additive.** Every account call fails soft. If KV is down, the
  mailer is broken, or the Functions are not deployed, the app falls back to the
  graph and token in Settings and you can still capture. The account layer can
  only ever cost you convenience, never a note.
- **Requesting a code always answers `{"sent": true}`**, whatever address is
  given, so the endpoint cannot be used to discover which addresses exist. The
  allowlist (`ALLOWED_EMAILS`) is still enforced — quietly.
- **PINs are stored hashed and salted**, single use, expiring in 10 minutes,
  with 5 attempts before the code is burned and a 30-second floor between sends.
  A KV read does not hand anyone a working code.
- **`/api/` is never cached by the service worker.** A cached `/api/vault` would
  serve one device's credentials, or a stale "not signed in", after the session
  changed.

## The tradeoff you accepted

Your Roam token now lives in Cloudflare KV rather than only on your devices, and
the server can read it. That token can rewrite your whole graph, so anyone with
access to your Cloudflare account reaches it too. This is the ordinary bargain of
any hosted account system, and it is revocable in one click from Roam's settings
— but it is a real change from a page that kept the token on-device only.
