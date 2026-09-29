# NEXT

> **Pick up here: nothing is left to build in the simplification. All five items wait for Shane to look and say merge.**
> When he does, merge in this order: S1 (PR #4), S3 (PR #6, into S1), S2 (PR #5), S4 (PR #7), S5 (PR #8, into S4), then
> `usability` into main. After that the queue is backlog 11, the live sheet, rebased into the new event page.
> **S1 to S5 are built and wait for Shane**: branches `s1-event-page` (PR #4), `s2-top-bar` (PR #5) and `s4-phone-pages`
> (PR #7), each a pull request into `usability`; `s3-stage-buttons` (PR #6), a pull request into `s1-event-page`; and
> `s5-after-event` (PR #8), a pull request into `s4-phone-pages`. Each shows its own change alone. All five change
> `e2e/callboard.spec.ts`. This file on `s5-after-event` is S4's copy plus S5, so it is the one to keep when they meet.
> **Where S5 will conflict**: S1 rewrote the event page (S5 only deletes the "Save as a template" fold there), S2 rewrote
> the top bar (S5 only deletes the Templates link), S3 changed the report's "not closed yet" line and the spec's close
> steps (S5 rewrote the report page; keep S5's page and S3's close steps).
> Shane used the product on 2026-09-29 and found it too complicated to use. The review agreed for the planner side.
> He chose all five changes, in ranked order, one per session. **Simplify before adding anything**: PRD 6 P1 and the
> closure deliverables wait behind S1 to S5.
> **Held, not abandoned**: the live sheet, PR #3 (draft), branch `sheet-link`. Its notes are in that branch's NEXT.md.
> **CI runs again** (2026-09-29): run 36586741222 on S1's pull request passed in 5 minutes. The two failures before it, on
> `sheet-link`, were the billing refusal (3 seconds each); re-run them when the live sheet is picked up.
> Callboard is live at https://callboard.labintelligence.co behind the shared password (moved 2026-09-28).
> Availability and the Preview switch-off shipped to main and production on 2026-09-28 (PR #1, below). Phase 3, the foundation upgrades through `v1.2.0` and swaps shipped to main and production on 2026-09-28.
> Backlog 9 waits until it is asked for. A new path that creates, moves or reopens an assignment calls `findClash` first. Every new page, layout and route handler must
> await `requireOrg`/`requireUser` first or carry a `// public: <reason>` line, and every id-like action field needs
> `ref()` or `notRef()` (FR-06, FR-08), or the invariant test fails. Foundation today: `v1.2.0`, on main.
> **Every item:** run `gh run list --limit 3` before starting and after pushing. CI runs on main and on pull requests only.

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
3. ~~Phase 3, first slice~~ built 2026-09-27 on branch `phase-3` (below): card library, lead review, reliability tiers. On main 2026-09-28.
4. ~~Foundation upgrade to v1.0.2~~ merged 2026-09-28 on branch `foundation-v1.0.2`, stacked on `phase-3` (below). On main 2026-09-28.
5. ~~Foundation upgrade to v1.0.3~~ merged 2026-09-28 on branch `foundation-v1.0.3`, stacked on `foundation-v1.0.2` (below). On main 2026-09-28.
6. ~~Phase 3, second slice~~ built 2026-09-28 on branch `phase-3-slice-2`, stacked on `foundation-v1.0.3` (below): standard rules, area playbooks, event templates, post-event report, thank-you and come-back. On main 2026-09-28.
7. ~~Foundation upgrade to v1.1.0, v1.1.1 and v1.2.0~~ merged 2026-09-28 on branch `foundation-v1.2.0`, stacked on `phase-3-slice-2` (below). On main 2026-09-28.
8. ~~PRD 3 swaps~~ built 2026-09-28 on branch `prd3-swaps`, stacked on `foundation-v1.2.0` (below). On main 2026-09-28.
9. ~~Availability and Preview builds~~ built 2026-09-28 on branch `availability` (below). On main 2026-09-28, PR #1.
10. **Simplification S1 to S5** (below), chosen by Shane 2026-09-29. One item per session, in order.
11. The live sheet, PR #3: held until S1 has reshaped the event pages, then rebased into the new layout.
12. PRD 6 P1, when asked: proposed edits from the report, checklist ticks on the day, the incident log, update-the-template-it-came-from with the diff shown.

## Simplification 2026-09-29 (backlog 10)
- **Decided by Shane 2026-09-29**: build all five of the review's changes in ranked order (over the quick wins first,
  the event page alone, or reading the report first), and hold the live sheet (over shipping it as built). Neither is
  to be asked again.
- **The review**: `docs/USABILITY_REVIEW.md`, 54 screenshots in `docs/usability/`. Done against the running app. Read
  section 2 for the item in hand, section 4 for what is cut, hidden, merged or kept, section 6 for the new words.
- **The cause**: every feature from all three phases shows at once, on every event, from the first minute. The staff
  phone pages are already simple.

| Item | Change | Cost | Status |
|---|---|---|---|
| S1 | A plain event page: one "Add shift" form, everything else in a "More options" fold per item, deletes in an edit mode with a confirmation | 2 to 3 days | built 2026-09-29 on `s1-event-page`, waits for Shane |
| S2 | Top bar from 12 items to 4: Events, People, Library, Settings | under a day | built 2026-09-29 on `s2-top-bar`, waits for Shane |
| S3 | Stage buttons in place of the status dropdown; "Close event" warns who will be texted; "live" becomes automatic | about 1 day | built 2026-09-29 on `s3-stage-buttons`, waits for Shane |
| S4 | Phone pages with the action first: Confirm above the fold, the lead's list shows today once, "Release them" becomes "Can't reach them" with undo | 2 days | built 2026-09-29 on `s4-phone-pages`, waits for Shane |
| S5 | After-event and reliability features hidden until needed: lead review from 18 questions to about 2, report opens with four numbers, templates cut, tiers hidden from leads | 2 to 3 days | built 2026-09-29 on `s5-after-event`, waits for Shane |

- **Each item**: its own branch off `usability`, a pull request, and nothing merges to main until Shane says so for that
  item. Show him the page before and after.
- **Bug fixed in S5** (was confirmed in code): `src/lib/report.ts` counts confirmed shifts that have not happened yet as
  no-shows, because its assignment query has no `shift: { endAt: { lt: now() } }` (`tiersFor` in `src/lib/review.ts`
  has one). Spring Expo, 18 days out, reads "7 no-shows (100%)".
- **Safety findings to carry into S1 and S4**: 25 Delete buttons on the event page with no confirmation; "Release them"
  on the lead page removes the person and texts them in one tap; closing an event texts every lead and everyone who
  checked in with no warning.
- **Not reviewed**: keyboard focus order and colour contrast.
- **State of this branch**: the review, plus the two test fixes picked from `sheet-link` (`ecdf7a4`: the swaps test that
  failed before midday UTC, and `DEMO_ACCESS_PASSWORD` blanked for the e2e server).
- **Local databases are one migration ahead of this branch**: both have `20260929000000_ros_link` from `sheet-link`. The
  two extra columns are harmless. Use `prisma migrate deploy`, never `migrate dev`, which would ask to reset.
- **Untracked in the repo root**: `AGENTS.md` and `CLAUDE.md`, written by `next dev` (Next's own agent rules,
  `node_modules/next/dist/server/lib/generate-agent-files.js`). Shane decides: ignore, commit or delete.

## S1, the plain event page 2026-09-29 (branch `s1-event-page`, not merged)
- **Spring Expo, before and after** (`docs/usability/p-event.png`, `s1-event-after.png`, `s1-event-after-edit.png`): 38 buttons
  to 2, 25 deletes to 0 (28 in edit mode, each behind a confirmation), 15 visible fields to 8, 11 folds to 10, 838 words to
  643, 4,295 px to 3,218 px. **The page is still long**: 20 shift lines at 56 px each are most of it.
- **One form**: "Add a shift" takes location, role, day, times, how many and a lead. A new location or role is made on the
  way, matched by name in any case. A new role takes the job description with the same title. Arrive-early minutes and
  extra invites come from the event's defaults. "Add another Greeter shift" on a role fills the form in.
- **Lead per location, the team kept for the planner** (`setLead` in the event's `actions.ts`): the location joins the team
  that person already leads; or its own team takes them, when that team has no lead or no other location; or a new team is
  named after the location, in the next colour. No lead means the planner. A team left with no location is deleted. Only a
  newly named lead or deputy is texted. Deputy and radio channel belong to the team, so they are shared by its locations.
- **One Save per item**: `saveLocation`, `saveRole`, `saveShift`. A field left out of the form stays as it is. A role and a
  shift could not be edited at all before; now they can.
- **Edit mode** is `?edit=1`, with no client code. It shows Change and Delete on every shift and Delete on every role and
  location. A delete is a fold with "Yes, delete" inside, and it says why when it cannot be done yet (people on the shift,
  shifts on the role, roles on the location). A delete lands back in edit mode.
- **Defaults taken, all reversible, Shane to confirm**: a shift's own options (how many, arrive early, extra invites) sit in
  edit mode, because 20 "More options" folds were the new noise; a new role's minimum is 1; a team keeps the name of its
  first location, and there is no field to rename it; the confirmation is a second click on the page, and the action does
  not check for it.
- **Left for their own items**: the status dropdown (S3), the eight links above the title and the top bar (S2 and the tabs
  in section 5 of the review, which no item owns yet), "Save as a template" (S5), the words on every other page. Until
  those land the event page says Location, Role and Lead notes while the board, Staff and phone pages say the old words.
- Removed actions: `addAor`, `addArea`, `addPosition`, `setAorLead`, `setAreaAor`, `deleteAor`, `setPositionCard`,
  `setAreaPlaybook`. No migration.
- Gate: lint and typecheck clean; vitest 200 of 200 (3 new in `tests/integration/callboard-plan.test.ts`); e2e `callboard`
  + `headers` 11 of 11 against a production build (one new spec); `foundation:drift` clean against v1.2.0. CI did not run
  (GitHub billing).
- Not checked: the page on a phone, keyboard order through the folds, a template's page (it is the same page).

## S2, the top bar 2026-09-29 (branch `s2-top-bar`, not merged)
- **Before and after** (`docs/usability/p-events.png`, `s2-events-after.png`, `s2-library-after.png`, `s2-settings-after.png`,
  `s2-settings-after-phone.png`): 12 items to 4, with the org's name (it opens "Your orgs") and Account at the right. The
  place you are in is bold.
- **Library and Settings open a second row**, not a page of their own: Library is Job descriptions and Lead notes and opens
  on the first; Settings is Event defaults, Members, Billing and Delete org (last) and opens on Event defaults.
- **Why the second row is built in the layout**: the foundation's remove-a-module check only reads `{/* billing */}` markers in
  `src/app/o/[org]/layout.tsx` (`MARKED_FILES`, a template-owned list). A Settings page of its own would have kept a dead
  Billing link in a clone without billing. So the layout builds both rows and hands them to `nav.tsx`, the one client
  component, which knows the address and shows the row that applies.
- **Cut from the bar, pages kept**: Home (it only ever redirected to Events) and Templates (reached from "start from a
  template" on the events page until S5 cuts it).
- **Three headings renamed to match their links**: Position cards to Job descriptions, Area playbooks to Lead notes,
  Standard rules to Event defaults. The words inside those pages are unchanged ("Save the standard", "card", "playbook").
- **Defaults taken, all reversible, Shane to confirm**: a second row over dropdown menus (a menu needs client code to close
  itself); Settings opens on Event defaults, the review's order, not on Members; the org name is the link to "Your orgs",
  with no arrow or menu.
- Skipped (add when asked): bold on the current link inside the second row, the Plan, Staff, Day of and After tabs on an
  event (section 5 of the review, still owned by no item), the wording inside the library and settings pages.
- No migration. No template-owned file changed.
- Gate: lint and typecheck clean; vitest 197 of 197 (this branch has none of S1's three); e2e `callboard` + `headers` 10 of 10
  against a production build; `foundation:drift` clean against v1.2.0; `foundation:check-modules` passes with billing removed. CI on PR #4 (S1) passed. On PR #5 the first
  run passed and the second, same code, failed three specs (next line); the fix went up after it, so read its run with
  `gh run list --limit 3` before starting S3.
- **Found on the way, a race in the messages spec**: `taps.tsx` sets the button's text to "…" on the tap, before the POST
  answers, so "no Got it button" was true at once and the planner's page reloaded before the ack was saved. It showed
  "0 of N got it" and nothing reloaded again. The spec now waits for the POST to `/act`. The two failures behind it were
  the known cascade: a failed test restarts the worker, which reseeds the expo. The other four phone taps in the file
  wait for words the server renders, so they do not have it. **S1's branch does not have this fix until it takes
  `usability` with S2 in it.**
- Not checked: keyboard order through the two rows, a member who is not an owner (Billing and Delete org are hidden by the
  same two permission checks as before).

## S3, stage buttons 2026-09-29 (branch `s3-stage-buttons`, off `s1-event-page`, not merged)
- **Four stages, two buttons**: Planning, Staffing, Running, Closed (`src/lib/stages.ts`). The event page shows the stage and
  the one next step: "Open for staffing", then "Close event…". A closed event shows "Reopen event". The events list shows
  the same words. No migration: the five stored values stay, and a row that holds `confirmed` reads as Staffing.
- **Close asks first**: the fold says what it will send, from the same two queries the close uses (`reviewLeads`, `workedAt`
  in `src/lib/review.ts`): "This texts 2 leads a review link and 12 people who checked in a thank-you." A second close
  says nobody is texted again. The button inside is "Yes, close the event".
- **Running is automatic** (`startDue`): an event open for staffing becomes `live` at the start of its first day, in its
  own timezone. The cron does it every 5 minutes. The three saves that read the freeze (job descriptions, lead notes, event
  defaults) and a reopen call it first, so the freeze never waits for the cron. The page works the stage out on read
  (`stageOf`), so it says Running with no cron at all. An event still in Planning never starts by itself.
- **`setStatus` takes `staffing` or `closed` only.** Nothing can set `live`, `draft` or `confirmed` by hand any more.
- **Defaults taken, all reversible, Shane to confirm**: "Reopen event" is kept, with no confirmation, because it texts nobody
  and a close by mistake needs a way back; the automatic start is not written to the audit log (the cron has no user; its
  log line counts `started`); the confirmation is a second click on the page and the action does not check for it, as in S1.
- **Skipped (add when asked)**: refusing invites while an event is in Planning. The review saw a text go out from a draft
  event, and a reply to it finds nothing, because the sweeps and the SMS webhook skip drafts. Two ways to fix it: refuse the
  invite, or open the event on the first invite. Also skipped: a way to close or cancel an event still in Planning.
- **Also changed**: the board's small "live" label is "updates every 10 s" (it read as the event's status); the report says
  "not closed yet" in place of the raw status.
- **Before and after** (`docs/usability/s1-event-after.png` is the before; `s3-event-after.png`, `s3-close-after.png`,
  `s3-planning-after.png`, `s3-events-after.png`). They show the old top bar, because this branch does not have S2.
- Gate: lint and typecheck clean; `foundation:drift` clean against v1.2.0; vitest on the two files touched 16 of 16 (1 new,
  "stages" in `tests/integration/callboard-library.test.ts`). **The full vitest run and the e2e sweep did not pass locally**
  (next line). In their place a one-off script walked the production build: open for staffing, close with the warning,
  reopen, and the second close that texts nobody. It passed, and it took the screenshots. **CI on PR #6 is the gate**: read
  it with `gh run list --limit 3` before merging.
- **Environment, proven this time**: both full vitest runs failed the invariant harness (180 s timeout, then its cascade of
  `Org_pkey` and deadlock errors) at load 40 to 60, while alongside, loanbook, tradepost and storage business ran their
  own tests. The same file on the unchanged branch, at the same load, failed the same 8 tests. So it is the machine.
- Not checked: the page on a phone, keyboard order into the fold.

## S4, phone pages with the action first 2026-09-29 (branch `s4-phone-pages`, off `usability`, not merged)
- **Staff, before and after** (`docs/usability/s11-expo-staff-firstscreen.png`, `s4-staff-after-firstscreen.png`), a Greeter
  invite on a 375 by 812 phone: the top of Confirm from 916 px to 342 px, the words before it from about 140 to 34. The
  job description and the notes for this event sit under one fold, "What the job is". "Decline" reads "Can't make it".
- **Notes that repeat the job description are dropped** (`repeatsCard` in `src/lib/cards.ts`): only when every sentence
  of the notes is in the job description. A reworded repeat still shows, inside the fold.
- **Lead, before and after** (`l1-lead-alert.png`, `s4-lead-after.png`, `s4-cant-reach-after.png`): one list for one day.
  The people who are overdue sit at the top, marked red, each with their role and Here; nobody appears twice. The first
  Here is at 204 px after 29 words (about 160 before). The day shown is today, or the next day with shifts, or the last.
  The other days are one fold. A deputy's two-day page before the day: 523 words to 255, about 3,500 px to 2,152 px
  (`s12-expo-priya.png`, `s4-deputy-after.png`).
- **"Can't reach them"** (`cantReach` in `src/lib/dayof.ts`, kinds `unreachable` and `reach_undo` in `/p/[token]/act`): the
  no-show goes to the planners at once, by email and on the board ("with you", with the lead's name). The person is not
  texted and keeps the shift. **Undo** hands it back to the first step of the chain, restarts its timer and emails the
  planners that it is back. A second tap of either changes nothing and sends nothing.
- **A lead cannot release anyone from the phone any more.** The `release` kind is gone from the route (it answers 400).
  The planner releases from the Staff page, which texts the person as before. The no-show text to a lead now ends
  "Check them in, or pass it to the planner", not "Check in, release or get cover".
- **Defaults taken, all reversible, Shane to confirm**: the mark that a lead passed a no-show on is the alert's note, so
  there is no migration; "Can't reach them" shows once the sweep has raised the alert, up to 5 minutes after the person
  turns red; the undo emails the planners as well; a no-show row has no "Done", only Here and Can't reach them (a help
  request keeps Done, which was Handled); the house rules, the deputy, the radio channel and the lead notes moved to one
  fold at the foot of the team, "Lead notes and house rules".
- **Skipped (add when asked)**: the greyed Confirm that stays beside an active "Can't make it" after a yes, and the
  one-tap decline on the day; help pre-set to supplies, and the chip words "vip" and "relief"; the swap dropdown wider
  than its card; a shift heading with nothing under it when its whole crew is overdue. Tiers on the lead's list are S5's.
  The board and the Staff page still say the old words.
- No migration. No template-owned file changed.
- Gate: lint and typecheck clean; vitest 199 of 199 (2 new: can't reach in `tests/integration/callboard-dayof.test.ts`,
  the notes check in `tests/unit/callboard-lib.test.ts`); e2e `callboard` + `headers` 10 of 10 against a production build
  (this branch has none of S1's spec); `foundation:drift` clean against v1.2.0. The machine was quiet (load 4).
- **This branch carries S2's fix to the messages spec** (cherry-picked, `df03395`), so its e2e run does not have the race.
- **Two specs changed for the fold**: they open "What the job is" before they read the job description.
- **Left behind**: `git stash list` shows one entry on `s4-phone-pages`. It holds a copy of this file equal to S3's.
  Dropping it was refused in the session; `git stash drop` removes it.
- Not checked: keyboard order into the folds, the lead's page with no JavaScript, a team with more than about 30 people.

## S5, after-event and reliability hidden until needed 2026-09-29 (branch `s5-after-event`, off `s4-phone-pages`, not merged)
- **Lead review, before and after** (`docs/usability/l7-lead-review.png`, `s5-lead-review-after.png`): per person, three
  fields became one tick, "Anyone you would not have back?"; per area, three required questions became one optional
  note, "Anything the planner should know?". A crew of five: 18 fields to 6. A save with nothing ticked and no note is a
  whole review. Measured on Marcus's page, two areas and seven people, on a 375 px phone: 9 fields (it would
  have been 27), 184 words, 1,300 px.
- **A lead's save freezes nothing** (`saveReview` in `src/lib/review.ts`): a person gets a `Review` row only when they are
  ticked, when a tick is taken back, or when the planner picks what happened. Everyone else stays on check-in. The old
  form wrote a row for everyone listed, pre-filled, on every save.
- **The planner's review page keeps "what happened"** per person (the `outcomes` flag on `ReviewFields`), with the same
  tick and note. Its "People reviewed" column is gone: with rows written only for ticks it would read "1 of 7".
- **The bug, fixed at the cause**: one rule, `ended()` in `src/lib/review.ts`, "a shift counts once it has ended". Tiers
  had it. The report's counts, the report's coverage by hour and the review's list of people now read it too. So a shift
  still to come is not a no-show, an hour still to come is not an hour under minimum, and a close before the last shift
  ends no longer lists that crew as "never checked in" (section 7 of the review, the lead review row).
- **Report, before and after** (`p-report.png`, `s5-report-after.png`): four numbers first (places filled, no-shows,
  late, help requests), then what the leads said, then four folds: coverage by hour, no-shows by group, help requests,
  how fast alerts were handled. The equipment section is cut. Spring Expo after a close: about 690 words and a
  60-row table became 86 words and 720 px, one screen. Its "area-hours under minimum" fell from 33 to 3 when the hours
  of day two, three weeks out, stopped counting.
- **Templates are cut**: the page, the top bar link, "start from a template", "Save as a template" and `saveAsTemplate`
  are gone, and the seed makes none. "Start a new event from this one" on the events list is the feature. **A copy now
  keeps the leads and the emergency contact** (a template blanked both), so check the leads on the new event.
- **Rows saved as templates stay in the database** (production has "Expo template" from `seed:prod`): hidden from every
  list, still refused for staffing and status, reachable only by their address. No migration; `isTemplate`, `templateId`
  and `attendanceBand` stay as columns. Delete the rows by hand if they are ever in the way.
- **Reliability shows on the People page only**, in words: Reliable, Not enough history, Missed shifts. The pill is off
  the lead's list and off the invite list, which keeps its order (most reliable first). The report's fold uses the same
  words. `Person.tierOverride` still holds 1, 2 or 3.
- **Words changed in a text**: the review link's text and the lead's page say "about a minute", not "three minutes".
- **Defaults taken, all reversible, Shane to confirm**: the one note is stored in `AreaReview.wentWrong` (no migration;
  an old review keeps its other two answers and the report shows them); the note is optional; a crafted POST from a
  lead's link can still send "what happened", as the old form let them; "Not enough history" is also what a mixed record
  reads as (two lates in eight events), and "Missed shifts" is also two "would not have back", because the review gave
  three labels for three tiers; the reason sits beside the label on the People page.
- **Skipped (add when asked)**: per-person notes (the column stays, the old notes are kept and shown nowhere); "have them
  back: yes" (it never moved a tier); the Plan, Staff, Day of and After tabs (section 5 of the review, owned by no item);
  renaming `src/lib/templates.ts`, which now holds only the copy.
- No migration. No template-owned file changed.
- Gate: lint and typecheck clean; vitest 200 of 200 in 57 s (1 new, "a shift still to come is not a no-show"; the review
  and copy tests rewritten for the new form and for no templates); e2e `callboard` + `headers` 10 of 10 against a
  production build, run twice; `foundation:drift` clean against v1.2.0. The machine was at load 11 to 28 for the full
  runs. One earlier run of the library file, at load 62, lost an untouched test to a 20 s hook timeout and passed alone.
- **The spec moves the expo's running shifts into the past before it closes the event**, because the review and the
  report now read ended shifts only. S3's version of those steps uses the stage buttons: keep both when they meet.
- Not checked: keyboard order into the report's folds, the report on a phone, a review saved on the old form and opened
  on the new one in a browser (the integration test covers the save).

## Shipped 2026-09-28: phase 3, foundation v1.2.0, swaps
- Production got the four add-only migrations first (`db:status:prod` named exactly those four as pending), then main was
  fast-forwarded from `5e00041` to `d8f599a` (38 commits) and pushed, then `npm run seed:prod` ran (exit 0).
- CI run 36472337968 on main: `ci` and `modules-removed` both pass, the first green run on main.
- Production deployment `callboard-q794fwsw5` is Ready and holds the `callboard-ten.vercel.app` alias. `/`, `/demo` and `/login`
  answer 200; a GET to `/api/sms/inbound` answers 405. Nothing behind a sign-in was clicked through in production.
- The v1.1.1 security fixes were due on main by 2026-10-05: met. Everyone signed in was signed out once (cookie renamed).
- The six stacked branches are all contained in main and still exist locally and on origin. Delete them when convenient.
- ~~Open: failing Preview builds~~ and ~~open: availability~~: both decided and built the same day, next section.

## Moved to callboard.labintelligence.co 2026-09-28
- **DNS**: `A callboard 76.76.21.21`, DNS-only, in Cloudflare (saved 22:39 UTC, answered from 22:50). Vercel serves both
  addresses from one production deployment, each with a valid certificate.
- **What the delay was**: the first record was a CNAME saved backwards (name `cname.vercel-dns.com`, target `callboard`), so
  the name never existed; Shane deleted it. After the A record was saved, Cloudflare's nameservers went on answering
  NXDOMAIN for the A type for about 11 minutes while every other type already answered "exists, no data". A made-up name
  answered NXDOMAIN for all types. **To tell "not saved" from "not out yet", ask for TXT as well as A.**
- **Order it ran in**: `APP_URL` in Vercel production, then `scripts/deploy-twilio.sh` with the new address (both run by
  Shane in his terminal), then the push of `b1c5479`, which moved the script's default and was the redeploy.
- **Checked on the new address**: `/`, `/demo`, `/login`, `/api/health`, `/s/abc` answer 401 with no or a wrong password
  and 200 with the right one; `/p/<unknown>` 404; `/sw.js` 200; `/api/sms/inbound` 405 on a GET and 403 on an unsigned
  POST; `/api/cron` 401 without its secret. Twilio's number reports its SMS webhook as the new address.
  `callboard-ten.vercel.app` answers 401 without the password and 200 with it.
- **Not checked**: a real inbound text. Nothing signed by Twilio has been posted to the new address, so text YES to the
  number once before relying on it. `CRON_SECRET` is only in Vercel, so the cron was read from the logs, not called.
- **Permissions in this environment**: the auto mode classifier refuses DNS changes and `vercel env` writes from a session.
  Reading the Cloudflare zone with `CLOUDFLARE_API_TOKEN` (in the shell environment, DNS edit scope) is allowed.
- **Left in the zone, not touched**: four rows from June that look mistyped (`labintelligenc.coarecrod` twice, `aname`,
  `aname2`).

## The demo gate 2026-09-28 (how it was built; the move above is finished)
- **Decided by Shane 2026-09-28**: the subdomain is `callboard` (over `staffing`), and the site sits behind a shared password
  like rent and showcall (over open with texts off, and over open as it is). Neither is to be asked again.
- **No new database and no data load**: Neon project `callboard` already holds the demo (`seed:prod`, 2026-09-28).
- **Why a password**: `/demo` signs anyone in as an owner, and an owner can add any mobile number and text it on the Twilio
  account. Not tested: whether `DEMO_MODE` limits sends.
- **The gate** (`src/proxy.ts`, logic in `src/lib/demo-gate.ts`, brought across from showcall): HTTP Basic, any username,
  against `DEMO_ACCESS_PASSWORD`, compared in constant time. On Vercel a missing password fails closed with a 503; off Vercel
  there is no gate, so dev, vitest and e2e are unchanged. Open without the password: `/p/*` (the link token), `/api/sms/inbound`
  (Twilio's signature), `/api/cron` (`CRON_SECRET`), `/api/webhooks/stripe` (Stripe's signature), and static files with `/sw.js`.
  Share links (`/s/*`) and `/api/health` are behind it.
- `DEMO_ACCESS_PASSWORD` is read from `process.env`, not `@/core/env`, and is not in `.env.example`: the template owns the schema
  and INV-14 holds `.env.example` to exactly its keys. `src/proxy.ts` is a template-owned path, so it is listed in
  `FOUNDATION_PATCHES.md`. A gate for demo deployments should go upstream.
- Checked against a production build served locally with a test password: 401 with no or a wrong password on `/`, `/demo`,
  `/login`, `/o/acme/events`, `/api/health`, `/s/abc`; 200 with the right one; `/p/<unknown>` 404, `/sw.js` 200, the webhooks
  and the cron answer with their own refusals; with `VERCEL=1` and no password, `/` is 503 and `/p/<unknown>` still 404.
- Gate so far: lint and typecheck clean; `tests/unit/demo-gate.test.ts` 3 of 3; `foundation:drift` clean. The full vitest run
  was not trusted locally: at load average 35 (other projects' sweeps) five invariant controls timed out at 20 s and one
  deadlocked, the pattern recorded under swaps below. CI on the pull request is the full run.
- Done: the domain is added to the Vercel project (it reports "not configured" until DNS exists).
- **Gate shipped 2026-09-28**: `DEMO_ACCESS_PASSWORD` is in Vercel production (sensitive) and in `.env.production.local`.
  PR #2 merged, deployment `callboard-694l7ryqe` Ready. On `callboard-ten.vercel.app`: `/`, `/demo`, `/login`, `/api/health`
  answer 401 with no or a wrong password and 200 with the right one; `/p/<unknown>` 404, `/sw.js` 200, `/api/sms/inbound` 405
  on a GET, `/api/cron` its own 401.
- `callboard-ten.vercel.app` keeps working and is behind the same password. Links already texted point at it and stay valid.

## Availability and Preview builds 2026-09-28 (backlog 9)
- **Decided by Shane 2026-09-28**: build availability (over closing the project or PRD 6 P1), and skip Preview builds (over
  giving Preview its variables). Neither is to be asked again.
- **One rule, one place**: `findClash` in `src/lib/staffing.ts` is the double-booking check the invite always made (any open
  assignment in the org whose shift overlaps). It now runs on every path that gives someone a shift. Three had none:
  a float deploy from the board; the planner setting a declined or released row back to invited or confirmed; and the person
  confirming from their link after declining. Each is refused with the name of what holds them. The person sees
  `?done=clash`. Swaps keep their two-person query and share `OPEN` and `overlapping` with it.
- **Also fixed on the way**: deploying a float to a shift they had already answered for hit the unique index on (shift, person)
  and returned a 500. It is a form error now.
- **Invite list**: free people first, in tier order as before; busy people stay listed, cannot be ticked, and show what holds
  them ("busy: Greeter at Spring Expo, 7:30 AM to 12:00 PM"). One extra query per Staff page.
- **Preview builds**: `vercel.json` has `"git": { "deploymentEnabled": { "main": true, "**": false } }`. `**`, because `*` does
  not match a branch name with a slash. To get preview URLs back, give the Preview environment its three variables, then
  remove that block.
- Skipped (add when asked): a "who is free at this time" view of its own (the invite list answers it per shift), hiding busy
  floats from the board's deploy list (the action refuses with the reason), the check at check-in (the person is standing
  there), a lock against two requests in the same instant (`ponytail:` note on `findClash`).
- No migration.
- Gate: lint and typecheck clean; vitest 194 of 194 (2 new in `tests/integration/callboard-availability.test.ts`); e2e
  `callboard` + `headers` 10 of 10 against a production build; `foundation:drift` clean against v1.2.0.
- Found on the way: the first e2e run failed because the spec picked the shift card by "Floor runner", and once Tom is invited
  every other card at that time says "busy: Floor runner". The spec now matches the heading, and asserts Tom cannot be ticked.

## Swaps 2026-09-28 (backlog 8, PRD 3 P1)
- **The flow**: on their own page a person opens "Swap this shift" under a confirmed shift and picks a colleague's shift. The
  colleague gets a text and accepts or declines on their page. The lead then approves or refuses under "Swaps to approve" on
  theirs; a planner can do the same from the Staff page, which lists every open swap. Nothing moves until the approval.
- **What approval does**: each assignment row moves to the other's shift (`Assignment.shiftId`), in one transaction, and only
  if it is still what was offered (same shift, confirmed, not checked in). Answers, alerts and history stay with the person.
  `t7SentAt` and `t1SentAt` are cleared, so the pack goes out again for the new shift. Both people get their new shift by text.
- **Who may do what** (`src/lib/swaps.ts`, called by `/p/[token]/act` and the Staff action): only the link's own person offers
  their shift, only the named colleague answers, only a lead or deputy of that AoR approves, and never someone who is part of
  the swap (the deputy is asked instead, then the planners by email).
- **Refused with a reason**: another AoR, a double booking for either person on any event in the org (the invite's conflict
  check), a shift either has already answered for, a second swap on a shift that has one waiting, a shift past call time.
  The reason travels as a code in `?done=`, never as text, so a crafted link cannot put words on the page.
- **Defaults taken, all reversible, Shane to confirm**: swaps stay inside one AoR (across AoRs is the planner's by hand); a
  person sees the names and shifts, never the mobiles, of confirmed people in their own AoR; five asks a day per person, since
  every ask sends a text; an approved swap cannot be undone except by a second swap or the planner.
- Skipped (add when asked): SMS keywords for a swap, a minimum-age check (invites do not check it either), a swap for a shift
  that is only invited, a demo swap in the seed, the planner's name in "refused by" (it says "the planner"; the audit log names
  the user).
- One migration, `20260928200000_swaps`: the `Swap` table and its enum. It only adds.
- Gate: lint and typecheck clean; vitest 192 of 192 (7 new in `tests/integration/callboard-swaps.test.ts`); e2e `callboard` +
  `headers` 10 of 10 against a production build (one new spec, through three phones and the Staff page); `foundation:drift`
  clean; `foundation:check-modules` passes. The invariant harness covers the new Staff action; the fixture gained a swap row.
- Environment: the first vitest run lost three `inv-09-rate-limits` tests at load 27 (five other projects' runners were up).
  Killing it with `pkill -f "$PWD.*vitest"` left its workers alive, because a worker's command line is `node (vitest 1)` with
  no path in it, and the next run then shared the database with them and failed differently (`Org_slug_key`, a count of 0).
  **Kill by working directory instead** (`lsof -a -p <pid> -d cwd`), and check `pg_stat_activity` for `callboard_test` is 0
  before starting again. The clean rerun took 63 s.
- Found on the way: nothing in the person page's POST route showed a refusal to someone without JavaScript: `reply` redirects
  a plain form and drops the error. Swaps carry theirs as a `done` code. Check-in refusals ("too early") still vanish for a
  plain form; taps.tsx shows them when JavaScript runs.

## Foundation v1.2.0 2026-09-28 (backlog 7)
- Merged tag `v1.2.0` in one merge, which carries `v1.1.0` (FR-06..11), `v1.1.1` (security LOWs K1, K2, K5, K6, K13) and
  F-03. No migration. Conflicts: this file and the two layouts, both kept as Callboard's with the template's new markers added.
- What changes for users: the session cookie is now `__Host-session` and always `Secure`, so the deploy signs everyone out
  once; "sign out everywhere" also kills unused sign-in links; a TOTP code cannot be issued twice at once; rate limits count
  an IPv6 /64 as one address; share links die with their org; audit writes are atomic.
- Callboard changes the merge forced (FR-06): nine `/o/[org]/events/[id]` entrypoints did guard, but after `await params`.
  They now await `requireOrg` first. The five `/p/[token]` entrypoints and the Twilio webhook carry `// public:` lines naming
  their credential (the link token plus a same-origin POST; the Twilio signature). No action needed a `ref()` or `notRef()`.
- F-03: `REQUIRED_MODULES = ['notifications']`. `foundation:check-modules` removes billing alone and passes validate,
  generate, typecheck, build and drift. That is the first time billing has been removed from Callboard.
- Found on the way: `foundation:drift` had been failing unseen, since CI only runs it inside `modules-removed`. Two files
  differed: Prisma's comment lines in `migration_lock.toml` (restored to the template's) and the design pass's edit to
  `src/core/ui/action-form.tsx`, now listed in `FOUNDATION_PATCHES.md` with its hash. That patch should go upstream.
  `prisma migrate dev` may rewrite the lock file's comments; check it out from the tag again if drift names it.
- Not verified: Safari on plain `http://localhost` with the always-`Secure` cookie. Chromium is what the e2e suite runs.
- Gate: lint and typecheck clean; vitest 185 of 185 (24 new from the foundation); e2e 16 of 16, all seven specs, against a
  production build; `foundation:drift` clean against v1.2.0; `foundation:check-modules` passes.

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
