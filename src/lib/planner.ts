import type { z } from 'zod';
import { orgAction } from '@/core/authz/action';
import { AuthzError, requireOrg, type OrgCtx } from '@/core/authz/guards';
import type { Permission } from '@/core/authz/permissions';
import type { Role } from '@/generated/prisma/enums';

// D-001: the planner surface is an allow-list, so a role core adds later (v1.3.0's scorekeeper, which only
// holds results.write and Callboard has no results) is refused by default. The members page assigns only these.
export const PLANNER_ROLES = ['owner', 'admin', 'member'] as const satisfies readonly Role[];

/** Throws core's missing-permission error unless the caller plans events. Use after `requireOrg`. */
export function assertPlanner(ctx: OrgCtx): OrgCtx {
  if (!(PLANNER_ROLES as readonly Role[]).includes(ctx.role)) throw new AuthzError('planner' as Permission);
  return ctx;
}

/** `orgAction(null, …)` for a planner: the role is checked before the input is parsed, as core checks a permission. */
export function plannerAction<S extends z.ZodType, R>(schema: S, fn: (ctx: OrgCtx, input: z.infer<S>) => Promise<R>) {
  const inner = orgAction(null, schema, fn);
  // ponytail: two membership reads per call (here and inside orgAction); fold into one if core grows a role hook.
  const action = async (orgSlug: string, input: unknown) => (assertPlanner(await requireOrg(orgSlug)), inner(orgSlug, input));
  return Object.assign(action, { spec: inner.spec });
}
