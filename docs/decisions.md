# Callboard decisions

Clone-owned decisions. The foundation's own log is `FOUNDATION_SPEC.md` §0 (its D-numbers are the template's);
Callboard's are numbered `D-001` onward, as the other clones number theirs. The running session log is `NEXT.md`.

| # | Decision | Why |
|---|---|---|
| D-001 | **The planner surface is an allow-list: owner, admin, member.** Every planner server action is built by `plannerAction` (`src/lib/planner.ts`), which is `orgAction(null, …)` plus a role check before the input is parsed; the run-of-show upload route calls `assertPlanner` after `requireOrg`. Any other role gets core's `AuthzError`, so a role a later foundation adds is refused by default. `leaveOrg` stays open to every member. The members page and its invite and role-change actions offer only `PLANNER_ROLES`, so `scorekeeper` cannot be assigned here (two template-owned edits, listed in `FOUNDATION_PATCHES.md`). Pages still render read-only for any member; only writes are gated. | 2026-10-20, approved by Shane. Foundation v1.3.0 added `scorekeeper` (core D-21: results entry and nothing else), but Callboard has no results, and `orgAction(null, …)` admits any member, so a scorekeeper could invite, text, broadcast and close events. A deny-list of `scorekeeper` would have let the next new role through the same hole. |
