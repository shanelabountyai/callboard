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
    body: `${s(d.to)}: not checked in at ${s(d.event)}: ${s(d.list)}.${d.url ? ` Check them in, or pass it to the planner: ${s(d.url)}` : ' See the coverage board.'}`,
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
  // After the event (PRD 6).
  cb_review: (d) => ({
    subject: `${s(d.event)}: your three-minute review`,
    body: `${s(d.name)}, thank you for leading at ${s(d.event)}. One last thing, about three minutes: who showed, and what to fix next time. ${s(d.url)}`,
  }),
  cb_review_due: (d) => ({
    subject: `${s(d.event)}: reviews still open after a week`,
    body: `Planner: ${s(d.event)} closed a week ago and these areas have no review: ${s(d.areas)}. Finish them from the check-in data or waive them with a note: ${s(d.url)}`,
  }),
  // `text` is the org's thank-you with the names already filled in (PRD 6); the link is where "count me in" lives.
  cb_thanks: (d) => ({
    subject: `${s(d.event)}: thank you`,
    body: `${s(d.text)} Want to work the next one? Tap to be counted in: ${s(d.url)}`,
  }),
  // Swaps (PRD 3). The person's own shift is `position` and `when`; the other side is `other*`.
  cb_swap_ask: (d) => ({
    subject: `${s(d.event)}: ${s(d.other)} asks to swap shifts`,
    body: `${s(d.name)}, ${s(d.other)} asks to swap shifts at ${s(d.event)}: you would take ${s(d.otherPosition)}, ${s(d.otherWhen)}; they take your ${s(d.position)}, ${s(d.when)}. Accept or decline: ${s(d.url)}`,
  }),
  cb_swap_accepted: (d) => ({
    subject: `${s(d.event)}: ${s(d.other)} accepted your swap`,
    body: `${s(d.name)}, ${s(d.other)} accepted your swap at ${s(d.event)}. It now waits on your lead. Your ${s(d.position)} shift on ${s(d.when)} is still yours until they approve: ${s(d.url)}`,
  }),
  cb_swap_approve: (d) => ({
    subject: `${s(d.event)}: a swap to approve`,
    body: `${s(d.to)}: ${s(d.a)} and ${s(d.b)} want to swap at ${s(d.event)}. ${s(d.a)} would take ${s(d.aTakes)}; ${s(d.b)} would take ${s(d.bTakes)}.${d.url ? ` Approve or refuse: ${s(d.url)}` : ' Approve or refuse on the Staff page.'}`,
  }),
  cb_swap_done: (d) => ({
    subject: `${s(d.event)}: your swap is approved`,
    body: `${s(d.name)}, your swap with ${s(d.other)} at ${s(d.event)} is approved. You now have ${s(d.position)} (${s(d.area)}), ${s(d.when)}. Call time ${s(d.call)}. Lead: ${s(d.lead)}. Details: ${s(d.url)}`,
  }),
  cb_swap_off: (d) => ({
    subject: `${s(d.event)}: the swap is off`,
    body: `${s(d.name)}, the swap with ${s(d.other)} at ${s(d.event)} is off (${s(d.why)}). Your ${s(d.position)} shift on ${s(d.when)} stays as it was: ${s(d.url)}`,
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
