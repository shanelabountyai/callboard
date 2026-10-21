'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ref } from '@/core/authz/action';
import { db } from '@/core/db';
import { resendToNonAckers, sendBroadcast } from '@/lib/broadcast';
import { drainOutbox } from '@/modules/notifications/outbox';
import { plannerAction } from '@/lib/planner';

// Targeted sends (PRD 4). The audience string is validated inside resolveAudience against this org's rows.
export const send = plannerAction(
  z.object({ eventId: ref('event'), audience: z.string().trim().min(1, 'Pick who this goes to.').max(60), body: z.string().trim().min(1, 'Write the message.').max(2000), requiresAck: z.string().optional() }),
  async (ctx, i) => {
    const n = await sendBroadcast(ctx, i.eventId, i.audience, i.body, i.requiresAck === 'on');
    await drainOutbox(25);
    redirect(`/o/${ctx.slug}/events/${i.eventId}/messages?sent=${n}`); // a redirect, not a notice, so the list below re-renders with the new message
  },
);

export const resend = plannerAction(z.object({ id: ref('broadcast') }), async (ctx, i) => {
  const n = await resendToNonAckers(ctx, i.id);
  await drainOutbox(25);
  const b = await db.broadcast.findFirstOrThrow({ where: { id: i.id, orgId: ctx.orgId }, select: { eventId: true } });
  redirect(`/o/${ctx.slug}/events/${b.eventId}/messages?resent=${n}`);
});
