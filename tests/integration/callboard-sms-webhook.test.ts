import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { twilioSignature } from '@/lib/inbound';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

// The Twilio webhook end to end: it fails closed without the auth token, refuses a bad signature before it
// reads a single keyword, and signs over APP_URL (the address Twilio was given), not the request's own host.
beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
const TOKEN = 'test-only-twilio-token-0123456789'; // not a real credential
const before = process.env.TWILIO_AUTH_TOKEN;
afterEach(() => {
  if (before === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = before;
});

async function route(token: string | undefined) {
  vi.resetModules(); // env.ts parses process.env at import
  if (token) process.env.TWILIO_AUTH_TOKEN = token;
  else delete process.env.TWILIO_AUTH_TOKEN;
  const { env } = await import('@/core/env');
  const { POST } = await import('@/app/api/sms/inbound/route');
  return { POST, appUrl: env.APP_URL };
}
const post = (POST: (r: Request) => Promise<Response>, params: Record<string, string>, signature: string | null, host = 'http://internal.vercel.app') =>
  POST(new Request(`${host}/api/sms/inbound`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(signature && { 'x-twilio-signature': signature }) }, body: new URLSearchParams(params) }));

describe('SMS webhook', () => {
  it('answers 503 without TWILIO_AUTH_TOKEN, whatever is sent', async () => {
    const { POST } = await route(undefined);
    expect((await post(POST, { From: '+15550100006', Body: 'STOP' }, 'anything')).status).toBe(503);
  });

  it('refuses a missing, wrong or wrong-URL signature and changes nothing', async () => {
    const org = await makeOrg();
    const tom = await db.person.create({ data: { orgId: org.id, name: 'Tom Alvarez', mobile: '+15550100006', kind: 'volunteer' } });
    const { POST, appUrl } = await route(TOKEN);
    const params = { From: tom.mobile, Body: 'STOP' };
    expect((await post(POST, params, null)).status).toBe(403);
    expect((await post(POST, params, twilioSignature(`${appUrl}/api/sms/inbound`, params, 'some-other-token'))).status).toBe(403);
    expect((await post(POST, params, twilioSignature('http://internal.vercel.app/api/sms/inbound', params, TOKEN))).status).toBe(403); // signed over the request host, not APP_URL
    expect((await post(POST, { ...params, Body: 'START' }, twilioSignature(`${appUrl}/api/sms/inbound`, params, TOKEN))).status).toBe(403); // a body edited after signing
    expect((await db.person.findUniqueOrThrow({ where: { id: tom.id } })).smsOptOut).toBe(false);
  });

  it('a signed STOP opts the number out silently; a signed START opts back in with a reply', async () => {
    const org = await makeOrg();
    const tom = await db.person.create({ data: { orgId: org.id, name: 'Tom Alvarez', mobile: '+15550100006', kind: 'volunteer' } });
    const { POST, appUrl } = await route(TOKEN);
    const url = `${appUrl}/api/sms/inbound`;
    const stop = { From: tom.mobile, Body: 'stop', MessageSid: 'SM1' };
    const r1 = await post(POST, stop, twilioSignature(url, stop, TOKEN));
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toBe('text/xml');
    expect(await r1.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect((await db.person.findUniqueOrThrow({ where: { id: tom.id } })).smsOptOut).toBe(true);

    const start = { From: tom.mobile, Body: 'START', MessageSid: 'SM2' };
    const r2 = await post(POST, start, twilioSignature(url, start, TOKEN));
    expect(await r2.text()).toContain('<Message>You will get event texts again.</Message>');
    expect((await db.person.findUniqueOrThrow({ where: { id: tom.id } })).smsOptOut).toBe(false);
  });
});
