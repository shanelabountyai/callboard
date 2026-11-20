// public: the link's token is the credential (readPersonLink); same-origin POST
import { z } from 'zod';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp, isSameOrigin } from '@/core/http';
import { readPersonLink } from '@/lib/links';
import { declineLocked, findClash } from '@/lib/staffing';

// Confirm or decline from the person's page. A POST, not a GET on the SMS link: messaging apps
// prefetch links, and a prefetch must never confirm a shift.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(req.headers)) return new Response(null, { status: 403 });
  const { token } = await params;
  const link = await readPersonLink(token, clientIp(req.headers));
  if (link === 'limited') return new Response('Too many requests', { status: 429 });
  if (!link) return new Response(null, { status: 404 });
  const form = await req.formData();
  const id = z.uuid().safeParse(form.get('assignment'));
  const answer = form.get('answer');
  if (!id.success || (answer !== 'confirm' && answer !== 'decline')) return new Response(null, { status: 400 });
  const status = answer === 'confirm' ? 'confirmed' : 'declined';
  const mine = { id: id.data, orgId: link.orgId, eventId: link.eventId, personId: link.personId };
  const t = now();
  // A decline after check-in, after the shift, or after a no-show alert would take the shift out of the reliability record.
  if (answer === 'decline') {
    const a = await db.assignment.findFirst({ where: mine, select: { checkedInAt: true, shift: { select: { endAt: true } }, alerts: { where: { kind: 'no_show' }, select: { id: true }, take: 1 } } });
    if (a && (declineLocked(a, t) || a.alerts.length)) return Response.redirect(new URL(`/p/${token}?done=locked`, req.url), 303);
  }
  // A yes after a no takes the shift back, and they may have been given another one since.
  const shift = answer === 'confirm' ? (await db.assignment.findFirst({ where: mine, select: { shift: true } }))?.shift : null;
  if (shift && (await findClash(db, link.orgId, [link.personId], shift, id.data))) return Response.redirect(new URL(`/p/${token}?done=clash`, req.url), 303);
  const { count } = await db.assignment.updateMany({
    where: { ...mine, status: { in: ['invited', 'confirmed', 'declined'] } },
    data: { status, respondedAt: t },
  });
  if (count) await audit({ orgId: link.orgId, userId: null }, `assignment.${status}`, { targetType: 'assignment', targetId: id.data, data: { by: 'person', personId: link.personId } });
  return Response.redirect(new URL(`/p/${token}?done=${answer}`, req.url), 303);
}
