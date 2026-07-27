// charlottesiegmann.com/transcribe-whisper -> voice.charlottesiegmann.com
//
// The app used to be *served* through this Worker, with the path prefix stripped
// on the way to Pages. That worked, but it made the URL depend on six things
// staying aligned: the zone's apex-to-www redirect, Worker routes on both hosts,
// prefix stripping here, baseURI-relative resolution in the page, the service
// worker's scope, and a trailing-slash redirect. The apex-to-www redirect runs
// *before* Worker routes, and it silently handed the request to Squarespace —
// which is the kind of failure a six-part arrangement produces.
//
// A subdomain depends on one CNAME instead, so the app moved there and this
// shrank to a redirect. It is kept only so the older URL is not a dead link.

const PREFIX = '/transcribe-whisper';
const HOME = 'https://voice.charlottesiegmann.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return new Response('not found', { status: 404 });
    // Carry any sub-path across, so a deep link keeps working.
    const rest = url.pathname.slice(PREFIX.length).replace(/^\/+/, '');
    return Response.redirect(`${HOME}/${rest}${url.search}`, 301);
  },
};
