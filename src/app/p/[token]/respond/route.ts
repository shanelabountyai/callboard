import { z } from 'zod';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp, isSameOrigin } from '@/core/http';
import { readPersonLink } from '@/lib/links';

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
  const { count } = await db.assignment.updateMany({
    where: { id: id.data, orgId: link.orgId, eventId: link.eventId, personId: link.personId, status: { in: ['invited', 'confirmed', 'declined'] } },
    data: { status, respondedAt: now() },
  });
  if (count) await audit({ orgId: link.orgId, userId: null }, `assignment.${status}`, { targetType: 'assignment', targetId: id.data, data: { by: 'person', personId: link.personId } });
  return Response.redirect(new URL(`/p/${token}?done=${answer}`, req.url), 303);
}
