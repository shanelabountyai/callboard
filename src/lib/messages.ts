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
  // Day of (PRD 5). `to` is the recipient's first name, or "planner" for the email at the top of the chain.
  cb_noshow: (d) => ({
    subject: `${s(d.event)}: ${s(d.count)} not checked in`,
    body: `${s(d.to)}: not checked in at ${s(d.event)}: ${s(d.list)}.${d.url ? ` Check in, release or get cover: ${s(d.url)}` : ' See the coverage board.'}`,
  }),
  cb_help: (d) => ({
    subject: `${s(d.event)}: ${s(d.name)} needs help (${s(d.category)})`,
    body: `${s(d.to)}: ${s(d.name)} (${s(d.where)}) needs help: ${s(d.category)}${d.note ? ` — ${s(d.note)}` : ''}.${d.url ? ` Your roster: ${s(d.url)}` : ''}`,
  }),
  cb_reply: (d) => ({
    subject: `${s(d.event)}: reply from ${s(d.name)}`,
    body: `${s(d.to)}: ${s(d.name)} (${s(d.where)}) texted: "${s(d.text)}"`,
  }),
  cb_deploy: (d) => ({
    subject: `${s(d.event)}: new position`,
    body: `${s(d.name)}, please move to ${s(d.position)} at ${s(d.area)}${d.location ? ` (${s(d.location)})` : ''} now. Lead: ${s(d.lead)}. Details: ${s(d.url)}`,
  }),
  // A planner's message (PRD 4). Over 320 characters it becomes a pointer to the page, where the full text waits.
  cb_broadcast: (d) => {
    const ack = d.requiresAck ? ` Got it? Reply GOT IT or tap ${s(d.url)}` : '';
    const full = `${s(d.event)}: ${s(d.body)}${ack}`;
    return { subject: `${s(d.event)}: message from the planner`, body: full.length <= 320 ? full : `${s(d.event)}: a message from the planner. Read it${d.requiresAck ? ' and tap Got it' : ''}: ${s(d.url)}` };
  },
} satisfies typeof templates);

export type Recipient = { mobile: string; email: string | null; smsOptOut: boolean };
type Tx = Pick<Prisma.TransactionClient, 'outbox' | 'membership'>;

/** SMS unless opted out, plus email when there is one. Rows commit with the caller's transaction. */
export async function notify(tx: Tx, orgId: string, to: Recipient, template: string, data: Record<string, string>) {
  if (!to.smsOptOut) await enqueue({ channel: 'sms', to: to.mobile, template, data, orgId }, tx);
  if (to.email) await enqueue({ channel: 'email', to: to.email, template, data, orgId }, tx);
}

/** The top of every escalation chain: an email to each owner and admin of the org. */
export async function notifyPlanners(tx: Tx, orgId: string, template: string, data: Record<string, string>) {
  const members = await tx.membership.findMany({ where: { orgId, role: { in: ['owner', 'admin'] } }, include: { user: { select: { email: true } } } });
  for (const m of members) await enqueue({ channel: 'email', to: m.user.email, template, data, orgId }, tx);
}
