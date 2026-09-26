import { env } from '@/core/env';
import { handleInbound, twiml, verifyTwilio } from '@/lib/inbound';
import '@/lib/messages';
import { drainOutbox } from '@/modules/notifications/outbox';

export const dynamic = 'force-dynamic';

// Twilio's inbound webhook. Fails closed without the auth token (like the Stripe webhook), verifies the
// signature over the public URL Twilio was configured with, and answers in TwiML so the reply is free.
export async function POST(req: Request) {
  if (!env.TWILIO_AUTH_TOKEN) return new Response(null, { status: 503 });
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const u = new URL(req.url);
  const url = `${env.APP_URL}${u.pathname}${u.search}`;
  if (!verifyTwilio(url, params, req.headers.get('x-twilio-signature'), env.TWILIO_AUTH_TOKEN)) return new Response(null, { status: 403 });
  const reply = await handleInbound(params.From ?? '', params.Body ?? '');
  await drainOutbox(10); // a HELP or a forwarded reply reaches the lead now, not at the next cron tick
  return new Response(twiml(reply), { headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } });
}
