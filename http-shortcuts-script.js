// Paste into HTTP Shortcuts (Android) as the shortcut's "Run before execution"
// script. Set the shortcut's own method/URL to anything — this script does the
// requests itself.
//
// Speak a note, it appends to today's Roam daily note. No computer involved.
// Verify the API works first with post-to-roam.sh on the Mac.

const GRAPH = 'YOUR-GRAPH-NAME';
const TOKEN = 'roam-graph-token-REPLACE-ME';

const BASE = `https://api.roamresearch.com/api/graph/${GRAPH}/write`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

// The write endpoint answers 308 and redirects to a per-tenant
// peer-N.api.roamresearch.com host. Many HTTP clients (OkHttp, curl -L) drop the
// Authorization header on a cross-host redirect, so the request arrives
// unauthenticated and returns a 401 that looks exactly like a bad token.
// Following it by hand keeps the header attached and removes the ambiguity.
function roamWrite(body) {
  const first = sendHttpRequest(BASE, {
    method: 'POST',
    headers: headers,
    body: body,
    followRedirects: false,
  });

  const code = first.response ? first.response.statusCode : 0;
  if (code === 307 || code === 308) {
    const h = first.response.headers || {};
    const loc = h.Location || h.location;
    const target = Array.isArray(loc) ? loc[0] : loc;
    if (target) {
      return sendHttpRequest(target, {
        method: 'POST',
        headers: headers,
        body: body,
      });
    }
  }
  return first;
}

const note = prompt('Note to Roam', '', { multiline: true });

if (note) {
  // Roam keys a daily note by a uid of MM-DD-YYYY and titles it "July 27th, 2026".
  // Both must agree or Roam will not treat the page as that day's note.
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const day = d.getDate();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];
  const uid = `${pad(d.getMonth() + 1)}-${pad(day)}-${d.getFullYear()}`;
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? 'th'
      : { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th';
  const title = `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;

  // Create today's page if you are capturing before having opened Roam today.
  // If it already exists this fails harmlessly and is ignored.
  roamWrite(JSON.stringify({ action: 'create-page', page: { title: title, uid: uid } }));

  // JSON.stringify escapes quotes, backslashes and newlines in the dictated text,
  // so speech can never break the payload.
  const res = roamWrite(
    JSON.stringify({
      action: 'create-block',
      location: { 'parent-uid': uid, order: 'last' },
      block: { string: note },
    }),
  );

  if (res.status === 'success') {
    showToast('Saved to ' + title);
  } else if (res.response) {
    alert('Roam rejected it — HTTP ' + res.response.statusCode + '\n' + res.response.body);
  } else {
    alert('Network error: ' + res.networkError);
  }
}
