import { enqueue } from '@/modules/notifications/outbox';
import { templates } from '@/modules/notifications/templates';
import type { Prisma } from '@/generated/prisma/client';

// Callboard's message templates, registered into the notifications module's table so the outbox
// can render them at drain time. Import this file before enqueueing and before draining
// (cron-jobs.ts does). Bodies stay under 320 characters where they can (PRD 4).
const s = (v: unknown) => String(v ?? '');
Object.assign(templates, {
  cb_invite: (d) => ({
    subject: `${s(d.event)}: can you staff ${s(d.when)}?`,
    body: `${s(d.name)}, you're needed at ${s(d.event)}: ${s(d.position)} (${s(d.area)}), ${s(d.when)}. Call time ${s(d.call)}. Lead: ${s(d.lead)}. Confirm or decline: ${s(d.url)}`,
  }),
  cb_nudge: (d) => ({
    subject: `${s(d.event)}: please confirm`,
    body: `${s(d.name)}, ${s(d.event)} is ${s(d.daysOut)}. Please confirm or decline your ${s(d.position)} shift on ${s(d.when)}: ${s(d.url)}`,
  }),
  cb_pack: (d) => ({
    subject: `${s(d.event)} tomorrow: your details`,
    body:
      `${s(d.name)}: ${s(d.event)} tomorrow. ${s(d.position)} at ${s(d.area)}${d.location ? ` (${s(d.location)})` : ''}. ` +
      `Call time ${s(d.call)}, until ${s(d.end)}. Lead: ${s(d.lead)}${d.leadMobile ? ` ${s(d.leadMobile)}` : ''}.` +
      `${d.uniform ? ` Wear: ${s(d.uniform)}.` : ''} Your card: ${s(d.url)}`,
  }),
  cb_released: (d) => ({
    subject: `${s(d.event)}: shift change`,
    body: `${s(d.name)}, your ${s(d.position)} shift on ${s(d.when)} at ${s(d.event)} has been released. You are not needed for it. Details: ${s(d.url)}`,
  }),
  cb_lead: (d) => ({
    subject: `${s(d.event)}: you lead ${s(d.aor)}`,
    body: `${s(d.name)}, you are the lead for ${s(d.aor)} at ${s(d.event)}. Your roster, who has confirmed, and your crew's details: ${s(d.url)}`,
  }),
} satisfies typeof templates);

export type Recipient = { mobile: string; email: string | null; smsOptOut: boolean };
type Tx = Pick<Prisma.TransactionClient, 'outbox'>;

/** SMS unless opted out, plus email when there is one. Rows commit with the caller's transaction. */
export async function notify(tx: Tx, orgId: string, to: Recipient, template: string, data: Record<string, string>) {
  if (!to.smsOptOut) await enqueue({ channel: 'sms', to: to.mobile, template, data, orgId }, tx);
  if (to.email) await enqueue({ channel: 'email', to: to.email, template, data, orgId }, tx);
}
