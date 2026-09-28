# NEXT

> **Pick up here: backlog 7, the foundation upgrade to `v1.1.0` (FR-06..11).** The tag was published by midday 2026-09-28
> (`d422d1a`). Branch from `phase-3-slice-2`. The `template` remote is SSH and fails host key verification in an unattended
> session, so fetch with `git fetch https://github.com/shanelabountyai/saas-foundation.git 'refs/tags/v1.1.0:refs/tags/v1.1.0'`.
> Foundation today: `v1.0.3`, not on main yet (see "Ship phase 3").

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
4. ~~Foundation upgrade to v1.0.2~~ merged 2026-09-28 on branch `foundation-v1.0.2`, stacked on `phase-3` (below). **Not on main: see "Ship phase 3".**
5. ~~Foundation upgrade to v1.0.3~~ merged 2026-09-28 on branch `foundation-v1.0.3`, stacked on `foundation-v1.0.2` (below). **Not on main: see "Ship phase 3".**
6. ~~Phase 3, second slice~~ built 2026-09-28 on branch `phase-3-slice-2`, stacked on `foundation-v1.0.3` (below): standard rules, area playbooks, event templates, post-event report, thank-you and come-back. **Not on main: see "Ship phase 3".**
7. Foundation upgrade to v1.1.0 (FR-06..11). Published 2026-09-28.
8. PRD 3 swaps: a person proposes a swap with a named colleague, both accept, the lead approves, the two assignments change hands in one transaction. Opus-class item: it adds writes to the no-login person page.
9. PRD 6 P1, when asked: proposed edits from the report, checklist ticks on the day, the incident log, update-the-template-it-came-from with the diff shown.

## Ship phase 3 (Shane, in this order)
The production database must get both migrations before main gets the code: main auto-deploys, and the new code selects columns
(`Position.cardId`, `Event.closedAt`, `Person.tierOverride`, `BillingAccount.stripeSubscriptionId`) the old database does not have.
Both migrations only add, so the code running in production today keeps working after step 1.
1. `npm run db:migrate:prod` (applies `20260927000000_billing_subscription_id`, `20260927164228_phase3_consistency` and
   `20260928120000_phase3_library`). All three only add.
2. `git checkout main && git merge --ff-only phase-3-slice-2 && git push` ships both phase 3 slices, the outbox fix and the v1.0.3
   security fixes together. To ship less, merge `phase-3`, `foundation-v1.0.2` or `foundation-v1.0.3` instead; each is a
   fast-forward and the rest follows later.
3. `npm run seed:prod` adds the five demo cards, links them to Spring Expo's positions, adds three closed past events so tiers
   show in the demo, and adds the Registration playbook, the house rules and the "Expo template". It is idempotent.

## Phase 3, second slice 2026-09-28 (backlog 6)
- **Standard rules** (`/o/[org]/rules`, nav "Rules"): ten rules in `src/lib/rules.ts`. Six are numbers that drive behaviour (no-show
  grace, call offset, overbook %, minutes per escalation step for no-shows and for help, days out for the first reminder) and four
  are text (breaks, minors, who can move whom, the thank-you). One `OrgRules` row per org, made on first read. An event holds its
  own value of every rule: it starts on the standard, follows a change to the standard while it is being planned, and is frozen
  once live or closed, the same rule as cards. "Deviates from standard" is "differs from the standard today", shown on the event
  page, the events list and the rules page. Setting a value back to the standard makes the event follow again.
- **Playbooks** (`/o/[org]/playbooks`): versioned exactly like cards. Linked per area on the event page, shown to the lead on their
  roster with the three house rules above it.
- **Templates** (`/o/[org]/templates`): a template is an `Event` row with `isTemplate`, so its editor is the event editor and
  starting an event from it is the old duplicate path (`copyEvent` in `src/lib/templates.ts`). Save-as-template is on every event
  page. Leads become slots, assignments never copy, cards and playbooks land on their latest version, the rule set rides along,
  and `Event.templateId` records the source. A template cannot be given a status or be staffed.
- **Report** (`/o/[org]/events/[id]/report`): built on read in `src/lib/report.ts`, nothing stored. Coverage per hour per area
  against minimum and plan, no-show rate by pool and tier, help by category and by position, alerts by time to resolve, review
  completion. It says "provisional" until every area is reviewed or waived.
- **Thank-you**: the first close texts everyone who checked in, in the org's words, with their link. The person page shows
  "Count me in next time" on a closed event; the tap stamps `Person.wantsBackAt`, and the Staff list puts those people first
  within their tier.
- **Defaults taken, all reversible, Shane to confirm**: any planner can change the standard rules (the audit log names who), the
  same default as the card library; attendance bands are four fixed labels; a change to the standard moves planned events
  silently, with the count in the audit log.
- **Deviation from the PRD's data sketch**: the PRD lists a template as "structure JSON" and rules as key and value rows. Both are
  typed columns instead, because that made the template editor and the rule checks free.
- Skipped (add when asked): unreturned equipment (nothing checks equipment out, and the report says so), structured headcount by
  hour in a playbook (it is lines of text), reordering the escalation chain (only its timing is a rule), a configurable day for
  the pack (it is always the day before, as its text says), deleting a template or playbook, a SMS keyword for "count me in".
- Behaviour change to know: `setEventDefaults` now takes any subset of the rules, and the first close sends thank-yous as well
  as review links, in one transaction with a 60 s limit. Move the thank-yous to the cron if an event passes about 500 people.
- Known ceiling in the report: each hour is read at its middle, so a gap shorter than an hour can hide.
- Gate: lint and typecheck clean; vitest 161 of 161 (7 new in `tests/integration/callboard-library.test.ts`); e2e `callboard` +
  `headers` 9 of 9 against a production build, run four times over to prove the spec resets its own data. The invariant harness
  covers the five new actions; the fixture gained one playbook row for it.
- Found on the way: a Playwright `getByLabel` with a loose match can hit the page being left. The event page's rules mention
  "call time", so the run-of-show spec's `getByLabel('Time')` matched three inputs before the navigation landed. It is exact now,
  and the new spec waits for the target page's heading before it fills anything.
- Found on the way: anything the seed imports is loaded by Playwright too, which cannot resolve `next/navigation`. So
  `src/lib/templates.ts` imports nothing from `next/*` and the actions do the "is it yours" check before calling it.
- Found on the way: a read with several includes inside an interactive transaction makes Prisma run queries side by side on one
  connection, which `pg` warns will stop working in version 9. `copyEvent` reads its source outside the transaction.
- Environment: the first attempt at the gate sat behind other projects' sweeps for over an hour (load average 50 to 90, 16%
  memory available, `rental_test` holding 39 connections). Every failure in that window was a timeout. After a reboot the full
  vitest run took 63 s.

## Foundation v1.0.3 2026-09-28 (backlog 5)
- Merged tag `v1.0.3` (FR-02..05) with no conflicts and no callboard change. Callboard has no custom `PaymentProvider`, and the
  new clone-owned `src/app/org-hooks.ts` is taken as shipped.
- What changes for users: a sign-in waiting on its TOTP code dies after 10 minutes and 20 wrong codes a day ends it; member invites
  are capped at 50 a day per sender, 100 per org and 5 per address; checkout is refused while the org has a live subscription;
  deleting an org cancels its subscription first and is refused if the cancel fails. Staff invites by SMS do not go through
  `createInvite`, so the caps do not touch them.
- Migration order: `20260927000000_billing_subscription_id` sorts before phase 3's migration, which the local databases already
  had. `prisma migrate deploy` applies it out of order without complaint, and both local databases were migrated that way.
  **`npm run db:migrate` (`prisma migrate dev`) may ask to reset a database that has phase 3 but not this one: use
  `npx dotenv -e .env.local -- prisma migrate deploy` instead.** Production has neither yet, so it gets both in order.
- Gate: lint and typecheck clean; vitest 154 of 154 (8 new from the foundation); e2e `billing`, `login`, `callboard` and `headers`
  11 of 11 against a production build.
- Environment: the first vitest run failed 3 tests in `inv-09-rate-limits` while another project's vitest ran (load average 35,
  the run took 461 s). The new invite cap test sends 100 invites and passed its 20 s timeout; the two failures after it were a
  deadlock with the timed-out test still writing. Alone the test takes 6 s, and the rerun at load 19 passed in 165 s.

## Foundation v1.0.2 2026-09-28 (backlog 4)
- Merged tag `v1.0.2` (FR-01). The outbox claims a row in a short transaction, counts the attempt and leases it for 2 minutes, then
  sends outside any transaction. Both transports time out after 15 s. No migration. Callboard never wrapped `drainOutbox`, so the only
  conflict was this file.
- One callboard change it forced: `attempts` is now counted at the claim, before the send, so the Messages page read a row that was
  mid-send as "retrying (error)". It now says "sending" when there is an attempt and no error.
- Found on the way: the day-of e2e spec moves both of day one's Greeter shifts to the same start time, then took the board's first
  Greeter row. Row order between the two is arbitrary, so the spec failed whenever the board and the spec's own query disagreed, and
  the restart after that failure reseeded the expo and failed the phase 3 spec behind it. The spec now takes the row Tom is on.
  The board itself still orders by start time alone; add a second sort key if rows are ever seen swapping on refresh.
- Gate: lint and typecheck clean; vitest 146 of 146 (3 new outbox tests from the foundation); e2e `callboard` + `headers` 8 of 8
  against a production build.

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
