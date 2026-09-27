import { z } from 'zod';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { clientIp, isSameOrigin } from '@/core/http';
import { readPersonLink } from '@/lib/links';
import { parseReview, saveReview } from '@/lib/review';

// A lead saves one area's review from their link (PRD 6). Same guards as /p/[token]/act: a same-origin
// POST, a live link, and an area inside an AoR this person leads or deputies.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(req.headers)) return new Response(null, { status: 403 });
  const { token } = await params;
  const link = await readPersonLink(token, clientIp(req.headers));
  if (link === 'limited') return new Response('Too many requests', { status: 429 });
  if (!link) return new Response(null, { status: 404 });
  const { person, event, orgId } = link;
  const form = Object.fromEntries(await req.formData());
  const areaId = z.uuid().safeParse(form.areaId);
  const area = areaId.success
    ? await db.area.findFirst({ where: { id: areaId.data, orgId, eventId: event.id, aor: { OR: [{ leadId: person.id }, { deputyId: person.id }] } }, select: { id: true, orgId: true, eventId: true } })
    : null;
  if (!area) return new Response(null, { status: 404 });
  const back = (q: string) => Response.redirect(new URL(`/p/${token}/review?${q}`, req.url), 303);
  try {
    const input = parseReview(form);
    await db.$transaction((tx) => saveReview(tx, area, { userId: null, name: person.name }, input));
  } catch (e) {
    if (e instanceof Refused) return back('error=1');
    throw e;
  }
  return back('done=1');
}
