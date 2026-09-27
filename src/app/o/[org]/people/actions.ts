'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, notFoundOnP2025, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { parseCsv, pickColumn, toRecords } from '@/lib/csv';
import { toE164 } from '@/lib/phone';
import { onUnique } from '@/lib/refuse';

const page = (ctx: OrgCtx) => `/o/${ctx.slug}/people`;
const kindOf = (s: string) => (/^(emp|staff)/i.test(s) ? 'employee' : 'volunteer') as 'employee' | 'volunteer';

export const addPerson = orgAction(
  null,
  z.object({
    name: z.string().trim().min(1, 'Name is required.').max(120),
    mobile: z.string().trim().min(1, 'Mobile is required.').max(30),
    email: z.string().trim().max(200).default(''),
    kind: z.enum(['employee', 'volunteer']),
    department: z.string().trim().max(80).default(''),
  }),
  async (ctx, i) => {
    const mobile = toE164(i.mobile);
    if (!mobile) throw new Refused('Mobile must be a phone number with area code.');
    const p = await db.person
      .create({ data: { ...inOrg(ctx), name: i.name, mobile, email: i.email.toLowerCase() || null, kind: i.kind, department: i.department } })
      .catch(onUnique('That mobile number is already in the directory.'));
    await audit(ctx, 'person.created', { targetType: 'person', targetId: p.id });
    redirect(page(ctx));
  },
);

/** Paste a CSV with a header row: name, mobile (or phone), email, kind (employee/volunteer), department. Existing mobiles are updated. */
export const importPeople = orgAction(null, z.object({ csv: z.string().min(1, 'Paste CSV rows with a header line.') }), async (ctx, { csv }) => {
  const rows = toRecords(parseCsv(csv));
  const first = rows[0];
  if (!first) throw new Refused('No rows found under the header line.');
  const nameCol = pickColumn(first, ['name', 'full name']);
  const mobileCol = pickColumn(first, ['mobile', 'phone', 'cell', 'mobile number', 'phone number']);
  if (!nameCol || !mobileCol) throw new Refused('The header needs a "name" column and a "mobile" (or "phone") column.');
  const emailCol = pickColumn(first, ['email', 'e-mail']);
  const kindCol = pickColumn(first, ['kind', 'type', 'pool']);
  const deptCol = pickColumn(first, ['department', 'dept', 'team']);
  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  await db.$transaction(async (tx) => {
    for (const [n, r] of rows.entries()) {
      const name = r[nameCol]!;
      const mobile = toE164(r[mobileCol]!);
      if (!name || !mobile) {
        skipped.push(`row ${n + 2}${name ? ` (${name})` : ''}`);
        continue;
      }
      const data = { name, email: (emailCol && r[emailCol]?.toLowerCase()) || null, kind: kindOf(kindCol ? r[kindCol]! : ''), department: deptCol ? r[deptCol]! : '' };
      const existing = await tx.person.findFirst({ where: { ...inOrg(ctx), mobile }, select: { id: true } });
      if (existing) {
        await tx.person.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await tx.person.create({ data: { ...inOrg(ctx), mobile, ...data } });
        created++;
      }
    }
    await audit(ctx, 'person.imported', { data: { created, updated, skipped: skipped.length } }, tx);
  });
  revalidatePath(page(ctx));
  return { notice: `Imported ${created} new, updated ${updated}.${skipped.length ? ` Skipped (no name or bad mobile): ${skipped.join(', ')}.` : ''}` };
});

export const deletePerson = orgAction(null, z.object({ id: ref('person') }), async (ctx, { id }) => {
  await db.person.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  await audit(ctx, 'person.deleted', { targetType: 'person', targetId: id });
  redirect(page(ctx));
});

/** A planner's override of the computed tier (PRD 3), with the reason kept beside it. Blank returns to history. */
export const setTier = orgAction(null, z.object({ id: ref('person'), tier: z.enum(['', '1', '2', '3']), note: z.string().trim().max(200).default('') }), async (ctx, i) => {
  if (i.tier && !i.note) throw new Refused('Say why, so the next planner knows the tier was set by hand.');
  await db.person.update({ where: { id: i.id, ...inOrg(ctx) }, data: { tierOverride: i.tier ? Number(i.tier) : null, tierNote: i.tier ? i.note : '' } }).catch(notFoundOnP2025);
  await audit(ctx, 'person.tier_set', { targetType: 'person', targetId: i.id, data: { tier: i.tier || null } });
  redirect(page(ctx));
});
