import { z } from 'zod';
import type { OrgRules, Prisma } from '@/generated/prisma/client';

// Standard rules (PRD 6): the org says how events are run, an event can say otherwise, and the
// difference is always visible. An event holds its own value of every rule. It starts as the org's
// standard, follows a change to the standard while it is still being planned (saveStandard moves every
// event whose value was the old standard), and is frozen once it is live or closed, like a card.
// So "deviates" is nothing more than "differs from the standard today".
export const RULES = [
  { key: 'graceMin', label: 'No-show grace', unit: 'minutes after call time; a position can set its own', min: 0, max: 240 },
  { key: 'callOffsetMin', label: 'Call time', unit: 'minutes before the shift starts, for new shifts', min: 0, max: 480 },
  { key: 'overbookPct', label: 'Overbook', unit: '% invited over the number needed, for new shifts', min: 0, max: 200 },
  { key: 'stepMin', label: 'No-show escalation', unit: 'minutes at each step: lead, deputy, planner (checked every 5)', min: 1, max: 120 },
  { key: 'helpStepMin', label: 'Help escalation', unit: 'minutes at each step (checked every 5)', min: 1, max: 120 },
  { key: 'nudgeDays', label: 'First reminder', unit: 'days before call time; the details always go the day before', min: 2, max: 30 },
  { key: 'breaks', label: 'Break rules', text: 'Shown to leads. Example: 15 minutes every 4 hours, never two from one position at once.' },
  { key: 'minors', label: 'Minors policy', text: 'Shown to leads. Example: under 18 never alone, no shifts past 9pm.' },
  { key: 'moves', label: 'Who can move whom', text: 'Shown to leads. Example: a lead moves people inside their own areas; across areas ask the planner.' },
  { key: 'thanks', label: 'Thank-you message', text: 'Sent when the event closes. {name} and {event} are filled in. Blank sends the built-in one.' },
] as const satisfies readonly ({ key: keyof OrgRules; label: string } & ({ unit: string; min: number; max: number } | { text: string }))[];

export type RuleKey = (typeof RULES)[number]['key'];
export type Rules = Pick<OrgRules, RuleKey>;

export const pickRules = (row: Rules) => Object.fromEntries(RULES.map((r) => [r.key, row[r.key]])) as Rules;
export const show = (r: (typeof RULES)[number], v: string | number) => ('text' in r ? String(v) || 'not set' : `${v}`);

/** The org's standard. The row is made with the column defaults the first time anyone looks. */
export const standardOf = (orgId: string, tx: Pick<Prisma.TransactionClient, 'orgRules'>) => tx.orgRules.upsert({ where: { orgId }, create: { orgId }, update: {} });

/** The rules where this event says otherwise. */
export const deviations = (event: Rules, standard: Rules) => RULES.filter((r) => event[r.key] !== standard[r.key]);

type Rule = (typeof RULES)[number];
const text = (r: Rule) => z.string().trim().max(1000, `${r.label}: 1,000 characters at most.`);
const int = (r: Extract<Rule, { min: number }>) =>
  z.coerce.number({ message: `${r.label} must be a number.` }).int(`${r.label} must be a whole number.`).min(r.min, `${r.label} cannot be under ${r.min}.`).max(r.max, `${r.label} cannot be over ${r.max}.`);
type Shape<Opt> = { [K in RuleKey]: z.ZodType<Opt extends true ? Rules[K] | undefined : Rules[K]> };
/** Every rule, required: the form always sends them all. */
export const ruleShape = () => Object.fromEntries(RULES.map((r) => [r.key, 'text' in r ? text(r).default('') : int(r)])) as unknown as Shape<false>;
/** Every rule, optional: what is left out stays as it is. */
export const ruleShapeOptional = () => Object.fromEntries(RULES.map((r) => [r.key, ('text' in r ? text(r) : int(r)).optional()])) as unknown as Shape<true>;
