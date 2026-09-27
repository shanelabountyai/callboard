# NEXT

> **Foundation upgrade waiting (2026-09-27): `v1.0.2`** — FR-01 outbox fix (send no longer inside the claim tx; a slow provider
> was delivered but never recorded, then re-sent every cron run). `git fetch template --tags && git merge v1.0.2`, no migration;
> re-run your outbox tests (a clone that wraps `drainOutbox` or its transports may conflict).
> **Then `v1.0.3` (security, take within 7 days)** — FR-02..05: pending-MFA 10-min TTL + daily wrong-code cap, invite send caps,
> org bound to one Stripe subscription (checkout refused while live), org deletion cancels the subscription first.
> `git merge v1.0.3`, then **`npm run db:migrate`** (adds `BillingAccount.stripeSubscriptionId`; deployed clones: migrate prod too).
> New clone-owned `src/app/org-hooks.ts`; a custom `PaymentProvider` needs `cancel()`. v1.1.0 (FR-06..11) follows.

## Callboard (onsite staffing) — phase 2 built 2026-09-26, phase 3 first slice built 2026-09-27
PRDs (Claude Doc, edit inline): https://claude.ai/code/artifact/7eb03633-a1df-456e-bea8-c28565893944
Design brief for Claude Design (2026-09-26): https://claude.ai/code/artifact/7213f59c-5108-4cad-957d-d3615818380d
Repo: https://github.com/shanelabountyai/callboard (private). Port 4600. Clone of saas-foundation v1.0.1.

Phase 1 = plan, AoRs and leads, directory, one-tap confirm, T-7/T-1 reminders, run of show.
Phase 2 (day-of, PRD 5 P0 + PRD 4 sends) = check-in and check-out (lead taps queued offline via
`taps.tsx` + `public/sw.js`, self from the person page, SMS HERE/DONE, planner from the board; earliest
timestamp wins, too-early refused unless planner), no-show alerts at callAt + grace (position override)
on the lead → deputy → planner chain (10 min per step; help 5 min; planner step = email + board badge),
HELP with categories (medical/security shows the emergency contact first), YES/NO/LINK/GOT IT/STOP
keywords on a signature-checked Twilio webhook (`/api/sms/inbound`, 503 without TWILIO_AUTH_TOKEN),
coverage board with 10 s refresh and float deploy, printable roster with QR, broadcasts with Got it and
re-send to non-ackers. Cron now every 5 minutes. Gate: lint, typecheck, vitest (135) green; e2e callboard
+ headers specs green.

Skipped from PRD 5 P0 (add when a real event asks): readiness flags (credentialed/radioed/briefed),
QR-poster self check-in, lead override of the 3-hour early rule, per-person message thread and lead inbox
(unrecognised replies are forwarded to the lead by SMS instead), change-notice drafting on shift edits.

## Backlog (in order)
1. ~~Deploy phase 1+2~~ done 2026-09-26 (below). Still open: a Resend key so planners can sign in by email; 10DLC registration for volume.
2. ~~Apply the design~~ done 2026-09-26, built straight from the design brief (below).
3. ~~Phase 3, first slice~~ built 2026-09-27 on branch `phase-3` (below): card library, lead review, reliability tiers. **Not merged: see "Ship phase 3".**
4. Foundation upgrade to v1.0.2 (the note at the top of this file). Callboard calls `drainOutbox` from actions and the cron, so re-run the outbox and day-of tests after the merge.
5. Phase 3, second slice (the rest of PRD 6 P0): post-event report, event templates with save-as-template, area playbooks, standard rules with per-event override, thank-you and come-back message. Then PRD 3 swaps.

## Ship phase 3 (Shane, in this order)
The production database must get the migration before main gets the code: main auto-deploys, and the new code selects columns
(`Position.cardId`, `Event.closedAt`, `Person.tierOverride`) the old database does not have. The migration only adds, so the code
running in production today keeps working after step 1.
1. `npm run db:migrate:prod` (applies `20260927164228_phase3_consistency`)
2. `git checkout main && git merge --ff-only phase-3 && git push`
3. `npm run seed:prod` adds the five demo cards, links them to Spring Expo's positions, and adds three closed past events so tiers
   show in the demo. It is idempotent.

## Phase 3, first slice 2026-09-27 (backlog 3)
- **Cards** (`/o/[org]/cards`, nav "Cards"): title, purpose, what you do and what to do if (five lines each at most), never, skills and
  demands, minimum age. One row per version in `PositionCard`, unique on (org, key, version), `changedBy` is the user. Saving carries
  the version the editor opened; if it is no longer the latest the save is refused with "Version N was saved while you were editing".
  A save repoints positions in events that are not live or closed; live and closed events keep the version they ran with.
- **Slots**: uniform stays on the position, location on the area, lead and call time on the AoR and shift. The person's page renders
  slots, then the card, then `Position.brief`, which is now "notes for this event only".
- **Review**: the first time an event's status becomes closed, `closedAt` is stamped and each AoR's lead (deputy if none) is texted
  `/p/<token>/review`. One form per area: what happened per person pre-filled from check-in, have them back yes / no / no opinion,
  a note, and three required answers. The planner's `/o/[org]/events/[id]/review` shows completion per AoR and can finish or waive
  (note required) any area. A week after the close the cron emails planners once about areas still open (`Event.reviewAskedAt`).
- **Reliability**: no table. `src/lib/review.ts` reads each past assignment as showed / late / no-show / left early (the review wins
  over the clock) and `tierOf` looks at the last 8 events. Tier 3 = two or more strikes (a no-show event, or a "would not rehire").
  Tier 1 = at least 3 events, no strikes, at most one late or early exit. Tier 2 = everyone else, including no history.
  Shown on People (with the reason and a set-by-hand override that needs a note), in the Staff invite list (sorted best first),
  and on a lead's roster. Never on a person's own page.
- Decisions: late means checked in after call time plus grace, the same line the no-show alert uses; left early means checked out
  more than 15 minutes before the end, and an automatic close never counts; a decline never counts whatever the reason; a release
  after a no-show alert still counts as the no-show; reviews open only on a closed event.
- **Defaults taken on two open PRD decisions, both reversible, Shane to confirm**: any planner can edit the library (every version
  names who saved it); tiers are computed for employees as well as volunteers (the HR question in the PRD checklist).
- Skipped (add when asked): map pin slot (areas have a text location only), retiring or deleting a card, card translations,
  a tier filter on the Staff page (the list is sorted by tier instead), showing tiers to a lead for people outside their AoR.
- Gate: lint and typecheck clean; vitest 143 of 143 (8 new in `tests/integration/callboard-review.test.ts`); e2e `callboard` + `headers`
  specs 8 of 8 against a production build. The invariant harness covers the six new actions with no registration.
- Found on the way: a server action that redirects to its own path plus a `#anchor` leaves the page showing stale data in a
  production build (the router scrolls instead of refreshing). Card saves redirect to the bare path.
- Environment: the first gate run failed with a 180 s timeout in the invariant harness while three other projects ran sweeps
  (load average 68). Alone it takes 12 s. Check `uptime` before reading that failure as a code problem.

## Design pass 2026-09-26 (backlog 2)
Built from the brief itself, not from a Claude Design export: the brief already fixes the tokens, the eight AoR
hues, type, density and the component set, and an export would land as the same CSS custom properties. If an
export arrives later, swap values in `src/app/globals.css`; nothing else needs to move.
- `src/app/globals.css` holds every token (light + dark via `prefers-color-scheme`) and the component classes:
  `.stripe` (reads `--aor`), `.pill[data-status]`, `.cov` + `[data-tone]`, `.badge`, `.alert[data-severity]`, `.row`,
  `.banner` (offline queue), `.chips`, `.swatches`, `.sheet` (print), `main.floor` (48px targets). Element defaults
  style tables, forms and buttons, so foundation screens (login, members, billing) picked it up with no markup change.
- No inline styles remain in `src/`. ActionForm contract unchanged.
- Decisions: amber and green are darkened for text (`#b45309`, `#15803d`) because the brief's `#d97706` and `#16a34a`
  fail 4.5:1 on white; AoR green is `#059669` so it never equals status green; AoR colour is now a swatch radio
  validated against `AOR_HEX` in `src/lib/colors.ts` (existing rows keep whatever hex they hold); help categories are
  chips in the brief's order with Supplies pre-picked (the old select defaulted to Medical).
- Also fixed on the way: the reminders test only passed after 12:15 UTC (its clock advance is now relative to the
  shift); `seed-demo` now renames an existing org, because a test run can leave `acme` named by its slug and the
  e2e sign-in looks for "Acme Studio".
- Not done from the brief (add when asked): PWA manifest and installed icon, a manual dark/light toggle, the
  clickable prototypes and copy deck that only Claude Design would produce, coverage board as a time-block grid
  (it is still one row per shift).
- DesignSync needs `/design-login` run once from an interactive session before any session can read Claude Design.

## Deployed 2026-09-26: https://callboard-ten.vercel.app
Vercel project `callboard` (team shanelabountyai-8212s-projects), Root Directory ".", git-connected to main.
Neon project `callboard` (shiny-tree-44811929, org-morning-smoke-06224724); migrated with `npm run db:migrate:prod`,
which reads the gitignored `.env.production.local` (DATABASE_URL pooled, DIRECT_URL direct, Twilio, Resend).
Production env: AUTH_SECRET, CRON_SECRET (generated), APP_URL, DEMO_MODE=1, EMAIL_ENABLED=0 (no Resend key yet:
planners sign in only via /demo until RESEND_API_KEY + EMAIL_FROM are set and EMAIL_ENABLED removed).
Twilio: set 2026-09-26 via `scripts/deploy-twilio.sh` (TWILIO_* in Vercel, the number's SMS webhook on
APP_URL/api/sms/inbound, unsigned posts get 403). Auth token was rotated the same day after it leaked into a
session trace. Production seeded with `npm run seed:prod` (demo org + Spring Expo; the +1555 demo numbers are
unroutable, so real texts only reach people added to the directory).
Any change to env alone needs a code push to redeploy: the ignoreCommand skips a no-diff redeploy.

Note: /p pages must keep the default Referrer-Policy (`no-referrer` breaks the same-origin form POST).
Alerts stamp openedAt/steppedAt from `now()` in `@/core/clock`, never the DB default, or clock-advanced
tests drift. Open decisions still unanswered: see the checklist at the end of the PRD doc.
