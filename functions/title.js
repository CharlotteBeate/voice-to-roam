// POST /title  {text, titles?} -> {title, clean_body, references}
//
// (The path is historical — it prepares the whole note, not just the title.)
//
// This is the prompt from the earlier voice-notes project, kept verbatim rather
// than reworded, because its precision is the point. Three things come back:
//
//   title       — the page the note is filed under, on today's daily note
//   clean_body  — the transcript with the meta-instruction and filler DELETED
//   references  — only where the speaker explicitly asked to link something
//
// clean_body is a DELETE-ONLY edit, and that is the load-bearing constraint. The
// note is your words; the model's job is to remove the scaffolding you spoke
// around them ("title X", "brain dump", "ich will das X nennen") and the ums,
// never to rewrite. An earlier version of that project summarised instead, which
// was not wanted — so the caller verifies the result is a subsequence of the
// transcript and discards it if not. A prompt cannot enforce that; only the
// check can.
//
// Same plumbing as functions/whisper.js: same-origin so there is no preflight,
// and the box's shared key stays server-side.

/** Where the model lives. Set BOX_ORIGIN in wrangler.toml (or the Pages
 *  dashboard) to point a fork at its own machine. It must answer
 *  `POST /complete` with `{system, user, schema}` -> `{result: <object>}`. */
const DEFAULT_BOX = 'https://feed.labellivestockpatents.org';

/** Strict, so the answer cannot arrive as prose wrapped around JSON. */
const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    clean_body: { type: 'string' },
    references: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phrase: { type: 'string' },
          variants: { type: 'array', items: { type: 'string' } },
        },
        required: ['phrase', 'variants'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'clean_body', 'references'],
  additionalProperties: false,
};

const SYSTEM = `You prepare a spoken voice note (a Whisper transcript) for filing into Roam Research. Output STRICT JSON, nothing else:
{
  "title": string,       // ALWAYS a title. See TITLE.
  "clean_body": string,  // the note, meta-instructions and filler DELETED. See CLEAN_BODY.
  "references": [ { "phrase": string, "variants": [string, ...] } ]
}

TITLE — always decide one:
- If they say what to call it ("a tag or a thing called X", "call this X", "filed under a page called X", "title it X", "put this under X", "ich will das X nennen", "unter X speichern"), use THAT name, cleaned, in Title Case.
- BUT if EXISTING PAGES contains a page that means the same thing, return THAT page's spelling EXACTLY — its capitalisation, its hyphens, its accents — instead of what you would otherwise write. Speech carries no hyphens or capitals, so "start-up", "start up" and "Startup" are the same word said aloud; if one of them is already a page, that is the one. Creating a near-duplicate splits the graph in two and is much worse than reusing an imperfect name.
- Otherwise write your own short 2-5 word Title-Case title that names the subject of the note.
- Use "braindump"/"Braindump" if they said "brain dump" and there is no other clear subject.

CLEAN_BODY — a light copyedit of the transcript into the note itself:
- DELETE the meta-instructions: the opening OR closing requests to add / file / name / save / title the note ("I want you to add ...", "call this X", "brain dump", "ich will das X nennen", "es sollte unter X gespeichert werden"), any "reference X" instruction, and the announcing preamble people speak before the actual thought ("so I want to note down that", "I need to remember that", "note that", "ich wollte festhalten dass"). What remains should start at the substance.
- DELETE filler: um, uh, like, you know, and filler uses of "halt"/"also".
- You MAY reorder and trim connective words so the result reads as a clear note rather than a spoken sentence. Prefer the shortest phrasing that keeps the whole meaning.
- Do NOT summarise, and do NOT drop any fact, name, number, date or qualifier. Every detail in the transcript must survive in some form. Use ONLY words that appear in the transcript — do not introduce vocabulary of your own, do not translate, and keep the original language.
- If the note is already clean, return it unchanged.

Example — transcript: "So I want to note down that I need to write in about the October event to figure out whether I want to participate or stay longer for a week and you should file this under start-up."
clean_body: "Write in about the October event: figure out whether to participate or stay longer for a week."

REFERENCES — strict:
- Only if the note contains an explicit instruction to reference / link / connect to something (a word like "reference", "link to", "connect to"; NOT "tag" — "a tag called X" is naming, not linking). The thing referenced is what follows.
- If there is no such explicit instruction, references MUST be []. Never turn ordinary content nouns into references.
- Do NOT include the note's own title. variants = casing/plural/synonym/abbreviation forms to help find an existing page.

Output ONLY the JSON object.`;

const fail = (status, error) =>
  new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  if (!env.TRANSCRIBE_KEY) return fail(503, 'the model is not configured');

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'expected JSON');
  }

  const text = String(body.text || '').trim();
  if (!text) return fail(400, 'no text');

  // The page's cached graph titles, already shortlisted there. They let the model
  // reuse an existing page rather than coin a near-duplicate.
  const titles = Array.isArray(body.titles) ? body.titles.slice(0, 200) : [];
  const user = [
    titles.length ? `EXISTING PAGES (prefer one of these if it means the same):\n${titles.join('\n')}\n` : '',
    'TRANSCRIPT:',
    text.slice(0, 6000),
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = await fetch(`${env.BOX_ORIGIN || DEFAULT_BOX}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.TRANSCRIBE_KEY}`,
      },
      body: JSON.stringify({ system: SYSTEM, user, schema: SCHEMA }),
    });
  } catch (e) {
    return fail(502, `model unreachable: ${e.message}`);
  }
  if (!res.ok) return fail(502, `model said ${res.status}`);

  let data;
  try {
    data = await res.json();
  } catch {
    return fail(502, 'the model returned something that was not JSON');
  }

  // serve.mjs leaves result null when the model's output would not parse. The
  // page treats a missing title as "ask me", so say so rather than invent one.
  const r = data && data.result;
  const title = String((r && r.title) || '').trim().replace(/^\[\[|\]\]$/g, '');
  if (!title) return fail(502, 'the model did not return a title');

  return new Response(JSON.stringify({
    title,
    clean_body: String((r && r.clean_body) || '').trim(),
    references: Array.isArray(r && r.references) ? r.references : [],
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
