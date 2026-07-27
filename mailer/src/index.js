// The sign-in mailer.
//
// This exists as a separate Worker for one reason: Pages Functions support KV,
// D1, R2, Durable Objects, service bindings and more, but NOT the send_email
// binding. So Pages calls this over a service binding and this does the sending.
//
// It is not on the public internet — a service binding is an internal call — so
// its only caller is the Pages project. It still refuses anything that is not a
// well-formed send, on the principle that an internal endpoint which trusts its
// input is one refactor away from being an open relay.
//
// Cloudflare only delivers to *verified destination addresses*, which for most
// apps is a crippling restriction and for this one is exactly right: there is a
// single recipient, and an unverified address simply cannot be mailed.

// Sent from a SUBDOMAIN, not the root domain, and that is deliberate.
// charlottesiegmann.com's MX records currently point at Namecheap's
// eforward*.registrar-servers.com — enabling Email Routing on the root would
// replace them and silently break existing mail forwarding. Cloudflare supports
// Email Routing on a subdomain of the same zone, which adds MX records only
// there and leaves the root untouched.
const FROM = 'noreply@mail.charlottesiegmann.com';
const FROM_NAME = 'Note to Roam';

function mime({ to, pin }) {
  // A minimal RFC 5322 message. The PIN appears in the subject as well as the
  // body so it is readable from a phone's notification without opening the mail.
  const lines = [
    `From: ${FROM_NAME} <${FROM}>`,
    `To: ${to}`,
    `Subject: ${pin} is your Note to Roam sign-in code`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Your sign-in code is ${pin}`,
    '',
    'It expires in 10 minutes and can be used once.',
    'If you did not ask to sign in, you can ignore this — the code is useless',
    'without your email, and nothing has changed on your account.',
    '',
  ];
  return lines.join('\r\n');
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('expected JSON', { status: 400 });
    }
    const to = String(body.to || '').trim();
    const pin = String(body.pin || '').trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(to) || !/^\d{6}$/.test(pin)) {
      return new Response('bad request', { status: 400 });
    }
    if (!env.SEND_MAIL) {
      return new Response('send_email binding is not configured', { status: 503 });
    }

    // EmailMessage comes from the runtime; it is available to Workers that
    // declare a send_email binding.
    const { EmailMessage } = await import('cloudflare:email');
    try {
      await env.SEND_MAIL.send(new EmailMessage(FROM, to, mime({ to, pin })));
    } catch (e) {
      // The overwhelmingly likely cause is that `to` has not been verified as a
      // destination address in the Cloudflare dashboard.
      return new Response(`send failed: ${e.message}`, { status: 502 });
    }
    return new Response(JSON.stringify({ sent: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
