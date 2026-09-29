import { z } from 'zod';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { env } from '@/core/env';
import { Refused } from '@/core/errors';
import type { Prisma } from '@/generated/prisma/client';
import type { ReviewOutcome } from '@/generated/prisma/enums';
import { dueAt } from './dayof';
import { ensurePersonLink } from './links';
import { notify, notifyPlanners } from './messages';
import { firstName } from './staffing';

// After the event (PRD 6): the lead's review, the reliability record it feeds, and the tier planners
// staff by. The record is not a table: it is each past assignment read through `outcomeOf`, so it can
// never disagree with the check-in data or the review it came from.
// ponytail: tiers are computed on read over the org's past assignments; store them per person if a
// directory page ever gets slow (thousands of people with long histories).
export const OUTCOMES: ReviewOutcome[] = ['showed', 'late', 'no_show', 'left_early'];
export const OUTCOME_LABEL: Record<ReviewOutcome, string> = { showed: 'Showed', late: 'Late', no_show: 'No-show', left_early: 'Left early' };
export const LEFT_EARLY_MS = 15 * 60_000; // checked out this long before shift end
export const REVIEW_DUE_MS = 72 * 3_600_000; // leads are asked to finish within 72 hours of the close
export const REVIEW_ASK_MS = 7 * 86_400_000; // after this the planner is asked to finish or waive
export const WINDOW = 8; // events a tier looks back over
export const MIN_EVENTS = 3; // tier 1 has to be earned

type Tx = Prisma.TransactionClient;

/**
 * The assignments that count: the person said yes, or was released after a no-show alert (the release
 * frees the slot; it does not erase the absence). A decline never counts, whatever the reason.
 */
export const REVIEWABLE = { OR: [{ status: 'confirmed' }, { status: 'released', alerts: { some: { kind: 'no_show' } } }] } satisfies Prisma.AssignmentWhereInput;
/** Areas that had shifts: the ones that owe three answers. */
const STAFFED = { positions: { some: { shifts: { some: {} } } } } satisfies Prisma.AreaWhereInput;

type Timed = { checkedInAt: Date | null; checkedOutAt: Date | null; checkOutMethod: string; shift: { callAt: Date; endAt: Date; position: { graceMin: number | null } }; event: { graceMin: number } };

/** What the check-in data says happened. Late means after call time plus grace: the moment the no-show alert would have fired. */
export function derivedOutcome(a: Timed): ReviewOutcome {
  if (!a.checkedInAt) return 'no_show';
  if (a.checkedInAt > dueAt(a)) return 'late';
  if (a.checkedOutAt && a.checkOutMethod !== 'auto' && a.checkedOutAt.getTime() < a.shift.endAt.getTime() - LEFT_EARLY_MS) return 'left_early';
  return 'showed';
}
/** The lead's word wins over the clock. */
export const outcomeOf = (a: Timed & { review: { outcome: ReviewOutcome } | null }) => a.review?.outcome ?? derivedOutcome(a);

// ---- reliability

export type EventRecord = { outcomes: ReviewOutcome[]; rehire: boolean | null };
export type Tier = { tier: 1 | 2 | 3; why: string };

/**
 * Tier from the last eight events, most recent first. 3: two or more strikes (a no-show event, or a lead
 * who would not have them back). 1: at least three events, no strikes, at most one late or early exit.
 * 2: everyone else, including people with no history yet.
 */
export function tierOf(records: EventRecord[]): Tier {
  const r = records.slice(0, WINDOW);
  if (!r.length) return { tier: 2, why: 'no history yet' };
  const noShow = r.filter((e) => e.outcomes.includes('no_show')).length;
  const soft = r.filter((e) => !e.outcomes.includes('no_show') && e.outcomes.some((o) => o === 'late' || o === 'left_early')).length;
  const no = r.filter((e) => e.rehire === false).length;
  const tier = noShow + no >= 2 ? 3 : r.length >= MIN_EVENTS && noShow + no === 0 && soft <= 1 ? 1 : 2;
  const why = `last ${r.length} ${r.length === 1 ? 'event' : 'events'}: ${r.length - noShow - soft} clean, ${soft} late or left early, ${noShow} no-show${no ? `, ${no} would not rehire` : ''}`;
  return { tier, why };
}

/** Computed tier per person who has history. Two events on one day are two records and still one tier. */
export async function tiersFor(orgId: string, personIds?: string[]): Promise<Map<string, Tier>> {
  const rows = await db.assignment.findMany({
    where: { orgId, ...(personIds && { personId: { in: personIds } }), shift: { endAt: { lt: now() } }, ...REVIEWABLE },
    select: {
      personId: true, eventId: true, checkedInAt: true, checkedOutAt: true, checkOutMethod: true,
      review: { select: { outcome: true, rehire: true } },
      shift: { select: { callAt: true, endAt: true, position: { select: { graceMin: true } } } },
      event: { select: { graceMin: true } },
    },
    orderBy: { shift: { endAt: 'desc' } }, // so each person's events land most recent first
  });
  const byPerson = new Map<string, Map<string, EventRecord>>();
  for (const a of rows) {
    const events = byPerson.get(a.personId) ?? new Map<string, EventRecord>();
    byPerson.set(a.personId, events);
    const e = events.get(a.eventId) ?? { outcomes: [], rehire: null };
    events.set(a.eventId, e);
    e.outcomes.push(outcomeOf(a));
    if (a.review && a.review.rehire !== null) e.rehire = e.rehire !== false && a.review.rehire; // one "no" in the event stands
  }
  return new Map([...byPerson].map(([id, events]) => [id, tierOf([...events.values()])]));
}

/** The tier to show: the one set by hand if there is one, else the computed one. Planners and leads only, never the person. */
export function shownTier(p: { id: string; tierOverride: number | null; tierNote: string }, tiers: Map<string, Tier>): Tier & { byHand: boolean } {
  const computed = tiers.get(p.id) ?? tierOf([]);
  if (p.tierOverride !== 1 && p.tierOverride !== 2 && p.tierOverride !== 3) return { ...computed, byHand: false };
  return { tier: p.tierOverride, why: `set by hand: ${p.tierNote} (history says tier ${computed.tier}, ${computed.why})`, byHand: true };
}

// ---- the review

export type ReviewInput = { people: { assignmentId: string; outcome: ReviewOutcome; rehire: boolean | null; note: string }[]; understaffed: string; overstaffed: string; wentWrong: string };

/** Reads the review form: `o:<assignment>` outcome, `r:<assignment>` yes / no / blank, `n:<assignment>` note, and the three answers. */
export function parseReview(form: Record<string, unknown>): ReviewInput {
  const str = (k: string, max: number) => String(form[k] ?? '').trim().slice(0, max);
  const people = Object.keys(form).filter((k) => k.startsWith('o:')).map((k) => k.slice(2)).filter((id) => z.uuid().safeParse(id).success).map((id) => {
    const outcome = OUTCOMES.find((o) => o === str(`o:${id}`, 20));
    if (!outcome) throw new Refused('Pick what happened for everyone listed.');
    const r = str(`r:${id}`, 3);
    return { assignmentId: id, outcome, rehire: r === 'yes' ? true : r === 'no' ? false : null, note: str(`n:${id}`, 500) };
  });
  const [understaffed, overstaffed, wentWrong] = ['understaffed', 'overstaffed', 'wentWrong'].map((k) => str(k, 1000)) as [string, string, string];
  if (!understaffed || !overstaffed || !wentWrong) throw new Refused('Answer all three questions about the area. “Never” and “nothing” are fine answers.');
  return { people, understaffed, overstaffed, wentWrong };
}

/** One area's review: a row per person (optional) and the three answers (required). Saving again replaces. */
export async function saveReview(tx: Tx, area: { id: string; orgId: string; eventId: string }, actor: { userId: string | null; name: string }, input: ReviewInput) {
  const { orgId, eventId } = area;
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } });
  if (event.status !== 'closed') throw new Refused('The review opens when the event is closed.');
  const ids = input.people.map((p) => p.assignmentId);
  const onRoster = await tx.assignment.count({ where: { id: { in: ids }, orgId, eventId, shift: { position: { areaId: area.id } }, ...REVIEWABLE } });
  if (onRoster !== new Set(ids).size) throw new Refused('Someone on the list is no longer on this area’s roster. Reload and try again.');
  const stamp = { by: actor.name, at: now() };
  for (const { assignmentId, ...p } of input.people) {
    await tx.review.upsert({ where: { assignmentId }, create: { orgId, eventId, assignmentId, ...p, ...stamp }, update: { ...p, ...stamp } });
  }
  const answers = { understaffed: input.understaffed, overstaffed: input.overstaffed, wentWrong: input.wentWrong, waived: false, waiveNote: '', ...stamp };
  await tx.areaReview.upsert({ where: { areaId: area.id }, create: { orgId, eventId, areaId: area.id, ...answers }, update: answers });
  await audit({ orgId, userId: actor.userId }, 'review.saved', { targetType: 'area', targetId: area.id, data: { by: actor.name, people: ids.length } }, tx);
}

/** Everything a review page shows, for the whole event or for the AoRs one lead owns. */
export const reviewSheet = (scope: { orgId: string; eventId: string }, aorIds?: string[]) =>
  db.area.findMany({
    where: { ...scope, ...STAFFED, ...(aorIds && { aorId: { in: aorIds } }) },
    orderBy: { name: 'asc' },
    include: {
      aor: true,
      review: true,
      positions: { orderBy: { name: 'asc' }, include: { shifts: { orderBy: { startAt: 'asc' }, include: { assignments: { where: REVIEWABLE, include: { person: true, review: true }, orderBy: { person: { name: 'asc' } } } } } } },
    },
  });
export type SheetArea = Awaited<ReturnType<typeof reviewSheet>>[number];

type Scope = { orgId: string; eventId: string };
/** Who the first close texts a review link: each AoR's lead (the deputy where there is no lead), once however many they lead. */
export async function reviewLeads(tx: Tx, scope: Scope) {
  const aors = await tx.aor.findMany({ where: { ...scope, areas: { some: STAFFED } }, include: { lead: true, deputy: true } });
  return [...new Map(aors.flatMap((a) => a.lead ?? a.deputy ?? []).map((p) => [p.id, p])).values()];
}
/** Who the first close thanks: everyone who checked in. */
export const workedAt = (tx: Tx, scope: Scope) => tx.person.findMany({ where: { orgId: scope.orgId, assignments: { some: { ...scope, checkedInAt: { not: null } } } } });

/** First close: start the review clock and text each lead their review link. */
export async function openReviews(tx: Tx, event: { id: string; orgId: string; name: string }) {
  const t = now();
  const scope = { orgId: event.orgId, eventId: event.id };
  await tx.event.update({ where: { id: event.id }, data: { closedAt: t } });
  const leads = await reviewLeads(tx, scope);
  for (const p of leads) {
    const url = await ensurePersonLink(tx, { ...scope, personId: p.id }, new Date(t.getTime() + REVIEW_ASK_MS + 86_400_000));
    await notify(tx, event.orgId, p, 'cb_review', { name: firstName(p.name), event: event.name, url: `${url}/review` });
  }
  return leads.length;
}

export const THANKS = 'Thank you for your work at {event}, {name}. It went well because you were there.';
export const THANKS_LINK_MS = 30 * 86_400_000; // how long "count me in next time" stays open

/**
 * First close: thank everyone who checked in, once each, with the link where "count me in next time" waits.
 * ponytail: runs inside the close's transaction, a few queries per person. Move it to the cron in batches
 * if an event ever has more than about 500 people on the floor.
 */
export async function sendThanks(tx: Tx, event: { id: string; orgId: string; name: string; thanks: string }) {
  const scope = { orgId: event.orgId, eventId: event.id };
  const worked = await workedAt(tx, scope);
  const expires = new Date(now().getTime() + THANKS_LINK_MS);
  for (const p of worked) {
    const url = await ensurePersonLink(tx, { ...scope, personId: p.id }, expires);
    const text = (event.thanks.trim() || THANKS).replaceAll('{name}', firstName(p.name)).replaceAll('{event}', event.name);
    await notify(tx, event.orgId, p, 'cb_thanks', { event: event.name, text, url });
  }
  return worked.length;
}

/** The cron's part: a week after the close, ask the planners once to finish or waive whatever is still open. */
export async function runReviewAsks(): Promise<{ asked: number }> {
  const t = now();
  const open = { review: { is: null }, ...STAFFED } satisfies Prisma.AreaWhereInput;
  const events = await db.event.findMany({
    where: { closedAt: { lt: new Date(t.getTime() - REVIEW_ASK_MS) }, reviewAskedAt: null, areas: { some: open } },
    include: { org: { select: { slug: true } }, areas: { where: open, select: { name: true }, orderBy: { name: 'asc' } } },
  });
  for (const e of events) {
    await db.$transaction(async (tx) => {
      await tx.event.update({ where: { id: e.id }, data: { reviewAskedAt: t } });
      await notifyPlanners(tx, e.orgId, 'cb_review_due', { event: e.name, areas: e.areas.map((a) => a.name).join(', '), url: `${env.APP_URL}/o/${e.org.slug}/events/${e.id}/review` });
    });
  }
  return { asked: events.length };
}
