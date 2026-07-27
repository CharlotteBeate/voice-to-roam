# edge/ — abandoned. Do not deploy this.

This Worker served the app at `charlottesiegmann.com/transcribe-whisper`, and it
**cannot work on that hostname.** It is kept only as a record of why, so the same
path is not attempted again.

## What is wrong with it

The origin of `charlottesiegmann.com` is Squarespace. Squarespace is itself a
Cloudflare customer, and when Cloudflare hands a request down to another
Cloudflare zone, everything configured on *ours* is skipped — Worker routes
included. The Worker is never invoked. No change on our side fixes this, because
our side is not in the path at all.

It fails **intermittently**, which is the trap: the arrangement was tested once,
returned 200 with the right page, and was reported as working. A later check on
the same URL:

```
HTTP/2 404
server: Squarespace        <- not cloudflare
(no cf-ray header)         <- our zone never saw the request
/cdn-cgi/trace -> 404      <- likewise
```

Other symptoms: *every* Worker on the zone is bypassed rather than one, and
Worker metrics show zero errors because nothing ran. The app itself stays healthy
throughout, so an app-level health check never catches it.

## What replaced it

The app moved to **`voice.charlottesiegmann.com`**, a Pages custom domain — one
CNAME, no Squarespace in the path, nothing to be handed off. The Worker's only
real job, proxying recordings to the chsiegm box with a shared key, moved to
`functions/whisper.js`, which does it same-origin as a Pages Function and holds
the key as a Pages secret.

## Cleaning up

The Worker is still deployed and still holds an orphaned `TRANSCRIBE_KEY` secret
that nothing reads. Remove it:

```bash
npx wrangler delete --name transcribe-whisper-edge
```

If the path-style URL is ever wanted for looks, add a **Squarespace URL
redirect** from `/transcribe-whisper` to the subdomain. A redirect is something
Squarespace can do on its own, with no Worker involved.
