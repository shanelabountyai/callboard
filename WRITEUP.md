# Project Write-Up: Callboard

> Portfolio write-up. Update the "Last synced" line every time the repo changes materially. A stale write-up is worse than none.

**Repo:** https://github.com/shanelabountyai/callboard (private)
**Live demo:** https://callboard.labintelligence.co (shared password, synthetic demo data only). The full demo runs locally from [`docs/DEMO.md`](docs/DEMO.md)
**Built with:** Claude Code + Next.js (App Router), TypeScript, Postgres + Prisma, Twilio SMS, hand-written CSS design tokens, Vercel
**Status:** Closed 2026-10-01, with one follow-up (the first real sheet sync, PR #11) shipped 2026-10-02 · A Sync of a real sheet in production is not done · Last synced: 2026-10-02
**Exec brief (non-technical):** https://claude.ai/artifact/AmmeAmYCareg3MWJb1QVYS

---

## The Business Problem

A corporate event or a conference runs on a few hundred people who are not employees: volunteers, temps, a vendor's crew. The planner staffs it from a spreadsheet and a group text. On the day, the question that matters is "who has not shown up, and who is already looking for them?" The sheet cannot answer it. A lead standing at a door has a phone and a radio, not a login. If a greeter is late, nothing tells the lead, nothing tells the planner, and by the time someone notices the post has been empty for an hour. The same people work several events a year, so the history that would tell the planner who is reliable lives in someone's head.

## What I Built

- **The planner plans an event once:** areas of responsibility, positions, shifts, a lead and a deputy for each area, and a run of show. A copy of last year's event keeps the leads and the emergency contact.
- **Staff work from a text message and a link.** There is no account and no app. An invite is an SMS with a personal link; the page opens on the one thing to do, Confirm. They can also reply YES, NO, HERE or DONE by text.
- **The day is a timer chain.** A person who has not checked in by call time plus a grace period raises an alert to their lead, then the deputy 10 minutes later, then the planner by email and on the board. A lead can tap "Can't reach them" to pass it up at once, with an undo.
- **A coverage board** refreshes every 10 seconds and shows each shift against its minimum. Float staff can be deployed to a gap from it.
- **After the event, a short review and a report.** The lead answers about a minute of questions. The report opens with four numbers: places filled, no-shows, late, help requests. Reliability shows on the People page only, in words.
- **A live run of show.** A planner pastes an Excel link (OneDrive or SharePoint) or a Smartsheet link, presses Sync, and the page is grouped by day. A file upload does the same job.
- **Swaps and availability.** A person can offer a shift to a colleague in their own area; the lead approves. Nobody can be given two shifts at the same time, on any path.

## How It's Built

It is a clone of my SaaS foundation template (v1.2.0), so auth, organisations, the outbox, the audit log and the invariant tests came with it. The Callboard schema adds 19 models in `prisma/schema/callboard.prisma`, on top of 15 foundation models, across 15 migrations. Every migration only adds. Staff identity is a signed token in the URL (`src/lib/links.ts`) rather than a login. Time is read through one `now()` in `@/core/clock`, so tests can move the clock. SMS goes through Twilio behind a signature-checked webhook. A cron runs the retries, reminders, no-show escalation and the automatic start of an event.

**Key design decisions** (the full running log is [`NEXT.md`](NEXT.md); each item records what was decided, what was skipped, and what I still have to confirm)

| Decision | Alternative considered | Why I chose it |
|---|---|---|
| Staff identity is a link in a text message, not an account | A login with a password reset | A volunteer on a venue's weak signal will not get through a sign-up. The cost is that the link is the credential, so `/p/[token]` pages stay open behind the demo gate and every one carries a `// public:` reason. |
| One double-booking check, `findClash`, on every path that gives someone a shift | Check in the invite only | The invite always checked. Three other paths did not (a float deploy, a planner reopening a declined row, a person confirming after declining). See *Defects Found*. |
| A shift counts only once it has ended, through one function `ended()` | Each report counts its own way | The report and the tiers disagreed, and a future shift read as a no-show. See below. |
| An event has four stages (Planning, Staffing, Running, Closed) and Running is automatic | A status dropdown with five values | Nobody should set "live" by hand. `startDue` flips it at the start of the first day in the event's timezone, and the page works the stage out on read, so it is right even if the cron is late. |
| The live sheet fetches a user-typed link from the server, behind a host allowlist | Accept any URL, or a Microsoft app registration | https only, six hosts, redirects followed by hand (five at most), each checked against the list, a 5 MB cap and a 15 s timeout. The Smartsheet token goes to `api.smartsheet.com` and nowhere else. |
| Rules are typed columns, not key and value rows | The PRD's JSON sketch | A typed column made the editor and the checks free. |
| Demo gate: HTTP Basic against one shared password, fails closed on Vercel | An open demo with texts off | `/demo` signs anyone in as an owner, and an owner can text any number on my Twilio account. |

## Skills Learned / Functions Unlocked

- **Simplifying a product by measurement.** I used my own build, found it too complicated, and wrote `docs/USABILITY_REVIEW.md` with 54 screenshots. Five ranked changes (S1 to S5) cut the event page from 38 buttons to 2, the top bar from 12 items to 4, and one report from about 690 words to 86. Each change had a before and after screenshot.
- **A trust boundary for a fetched URL.** Host allowlist, manual redirects, byte cap counted while reading, a timeout, and a token scoped to one host. See [`src/lib/sheet-link.ts`](src/lib/sheet-link.ts).
- **One rule in one place.** `findClash` in [`src/lib/staffing.ts`](src/lib/staffing.ts) for double-booking and `ended()` in [`src/lib/review.ts`](src/lib/review.ts) for "has this shift happened". Both exist because a rule written twice had drifted.
- **Authorization for people who never log in.** Only a link's own person offers their shift, only the named colleague answers, only a lead or deputy of that area approves, and never someone inside the swap. See [`src/lib/swaps.ts`](src/lib/swaps.ts). A refusal travels as a code in `?done=`, never as text, so a crafted link cannot put words on the page.
- **Cost review at closure.** Vercel was $0.27 for September, 92% of it build minutes. The cron was the one thing that kept the database awake, so it went from every 5 minutes to once a day. See [`vercel.json`](vercel.json).

## The Hardest Bug

**The first real OneDrive sync failed three ways in deployed code, and the unit tests had passed for three days.** The live sheet shipped on 2026-10-01 with tests that drove a stand-in for Microsoft's servers. The first real test was my own personal OneDrive link, a 52-line run of show over three days. It failed, and fixing the first failure showed the second.

1. **A 403 that read as a permission problem.** OneDrive's edge answers "The request is blocked" to any client with no browser user agent. My code sent none, and the page told the planner "That link is not open to everyone", which was wrong. It was true for every personal OneDrive link, not just mine.
2. **A cookie between redirect hops.** The share address sets a guest cookie, `FedAuth`, and the redirect to the file wants it back; without it the download hop bounces to a sign-in page. A server-side fetch with manual redirects carries no cookie jar. `excel()` now carries cookies between hops and returns each one only to the exact host that set it. That last part is the trust boundary again: a cookie jar that sent a cookie anywhere would have undone the allowlist.
3. **AM and PM were dropped.** `excelTime` stored "05:00 PM" as 05:00. This one did not break the sync; it silently corrupted it. The file upload and the hand-added line used the same function, so they had the bug too.

A small fourth thing sat next to them: `searchParams.set('download', '1')` rewrites the whole query string (`!` becomes `%21`) on an address Microsoft had signed, so it is no longer set when a redirect already carries it.

I picked this as the hardest because it is the only one no test I could write beforehand would have found. The unit tests were not wrong; they tested my idea of OneDrive. Each defect also hid the next: nothing reached the cookie bug until the user agent was fixed, and nothing reached the time bug until a file downloaded. The fix is in three places in `sheet-link.ts` and `ros.ts`, each with a case in `tests/unit/sheet-link.test.ts` (the OneDrive chain, the AM and PM cases). The part that is still open is the part I could not test: a Sync of the real sheet through the deployed page. I ran the real file through `fetchSheet` and `rosLines` from a script, not through the page, and SharePoint and Smartsheet links have never met their real services.

**What I'd instrument next time:** a real-service smoke check, run by hand once, before the feature is called shipped. A stand-in proves the code does what I think the service does. It cannot prove what the service does.

## Defects Found

Each of these cost a debugging pass. The lesson from each is written into `NEXT.md`, so the next session does not repeat it.

- **The report counted shifts that had not happened as no-shows.** Spring Expo, 18 days out, read "7 no-shows (100%)". `report.ts` had no end-time filter while the reliability tiers did. `ended()` is now the single rule, and it also fixed "area-hours under minimum" (33 down to 3) and a close before the last shift listing that crew as never checked in.
- **Three paths double-booked people and one of them returned a 500.** A float deploy, a planner moving a declined row back to invited, and a person confirming from their link after declining had no clash check. Deploying a float to a shift they had already answered for hit the unique index and returned a 500; it is a form error now. All three call `findClash`. It is check-then-write, so two requests in the same instant can both pass. That is marked as a known ceiling in the code.
- **A test that failed before midday UTC.** `callboard-swaps.test.ts` advanced the clock two days to get "past call time", which is only true after 12:00 UTC. CI on main would have gone red on any push in that window. The design pass found the same shape in the reminders test.
- **The e2e suite could not sign in on my laptop.** `next build` and `next start` read `.env.production.local` on their own, and since the gate shipped that file holds the demo password, so the test server answered 401 to everything. Playwright counts a 401 on the health check as "up", so it showed as a 30 second timeout on the first click. The config now blanks the variable for the test server.
- **The vitest kill-by-path trap.** `pkill -f "$PWD.*vitest"` killed the runner and left its workers alive, because a worker's command line is `node (vitest 1)` with no path in it. The next run shared the database with them and failed with `Org_slug_key` and a count of 0. I now find workers by working directory and check that `pg_stat_activity` for the test database is zero first.
- **A race in the messages spec.** The tap button sets its text to "…" before the POST answers, so "no Got it button" was true at once and the page reloaded before the acknowledgement was saved. A failed test restarts the worker and reseeds the demo event, which then failed the spec behind it. The spec waits for the POST.
- **A refusal that vanished for a plain form.** A form posted without JavaScript dropped a refusal because `reply` redirects and discards the error. Check-in refusals ("too early") still vanish without JavaScript.

## What I'd Do Differently

- **Show the page to a planner before building the third phase.** I built three phases from a PRD, used the result, and found it too complicated. The review was right and the cut was good, but five sessions of simplification are the price of not putting it in front of anyone earlier. No real planner has used it yet.
- **Call a feature shipped only after it has met the real service.** The live sheet was deployed and written up as done for a day before its first real link failed. The write-up now says Smartsheet and SharePoint are untested for the same reason.
- **Fix the rule first, then write the second report.** `ended()` exists because the tiers had the rule and the report did not. Any second place that decides what counts as "happened" is a defect even while the two places still agree.
- **Make every new entrypoint prove its guard from day one.** The foundation's invariant tests caught nine event entrypoints that guarded after `await params`. They are cheap to satisfy when a page is new and tedious when nine exist.
- **Check the machine before reading the stack trace.** Several times, a timeout in the invariant harness was load, not code. I now read `uptime` and the connection count first.

## By the Numbers

- **Built in 10 calendar days** (2026-09-23 to 2026-10-02, with commits on every one): 114 commits on main.
- **211 unit and integration tests** (the last recorded run on 2026-10-01; `vitest list` still reports 211) in 38 test files. **17 end-to-end tests** in 7 Playwright spec files, run against a production build, not a dev server. The full e2e sweep is run by CI, not on my laptop.
- About 7,100 lines of application TypeScript and 4,100 lines of tests, excluding the generated Prisma client.
- 19 Callboard data models (34 with the foundation's), 15 migrations, all additive.
- **11 pull requests.** Six merged (#1, #2, #3, #9, #10, #11, with #9 carrying the simplification), and #4 to #8, the five S-items, were closed unmerged because they shipped together in #9.
- **Event page, before and after S1:** 38 buttons to 2, 25 deletes to 0 on the default view, 838 words to 643.
- **Vercel cost:** $0.27 for September, 92% of it build minutes. Cron slowed from every 5 minutes (about 8,600 calls a month) to once a day.
- **What is not real:** the dataset is synthetic and the site is a demo behind a shared password. No planner has used it. Smartsheet and SharePoint links have never been tested against the real services, and a Sync of a real sheet in production has not been run. There is no Resend key (so planners sign in by the demo button, not by email) and no 10DLC registration, so SMS volume is limited to a single number. The cron runs once a day and has to go back to every 5 minutes before any real event, because the no-show chain needs it.

---

*Part of my Claude Code build log: https://claude.ai/artifact/28KeGV3xfBwcBuoMEQjFMj*
