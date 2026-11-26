// The demo gate itself lives in core since saas-foundation v1.6.5 (src/core/demo-gate.ts, read through @/core/env, K11).
// This file keeps only what is this clone's: the paths that carry their own credential.
export { gate, type Gate } from '@/core/demo-gate';

/** Paths that carry their own credential, so the password never stands between a text and the page it links to. */
export const ownCredential = (path: string) =>
  path.startsWith('/p/') || // the person's link token
  ['/api/sms/inbound', '/api/cron', '/api/webhooks/stripe'].includes(path); // Twilio's signature, CRON_SECRET, Stripe's signature
