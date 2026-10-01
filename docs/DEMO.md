# Callboard demo script

Callboard staffs an onsite event: plan the shifts, invite people by text, watch the day on a board, review it after.
The demo is Acme Studio's **Spring Expo**, a two-day expo at the Lakeside Convention Center, about three weeks out,
half staffed. Twelve people in the directory, two leads, sixteen shifts, three past events for history.

Run it in production (section A) when you have a phone with you; run it on the laptop (section B) when you need the
phone pages without a real text. Every command below was run on 2026-10-01.

## Accounts and where the credentials live

| What | Value | Where it lives |
|---|---|---|
| Production | https://callboard.labintelligence.co | behind a shared password, HTTP Basic, any username |
| The shared password | `DEMO_ACCESS_PASSWORD` | `.env.production.local` (gitignored) and Vercel production. Give it out with the link. |
| Planner sign-in | `/demo`, click **owner@acme.demo.test** | no password: `/demo` signs in any seeded account while `DEMO_MODE=1` |
| Other planners | admin@acme.demo.test, member@acme.demo.test | same page. Globex Labs is a second, empty org; ignore it |
| Phone pages | `/p/<token>`, one per person per event | arrive by text; on a laptop, `npm run links` prints them |
| Local database | `callboard` on localhost:5432 | `DATABASE_URL` in `.env.local` |

The demo mobiles are `+1555010000x`, which do not route, so in production a text only reaches a person you add with a
real number. The TOTP secret the seed prints is for `/login`, which you will not need: `/demo` skips it.

## A. In production

### 0. Before you start (two minutes)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://callboard.labintelligence.co/        # 401: the gate is up
curl -s -u "demo:$DEMO_ACCESS_PASSWORD" https://callboard.labintelligence.co/api/health   # {"ok":true}
```

Open the site in a private window, enter any username and the password, then `/demo`. If Spring Expo looks used
(people checked in, the event closed), demo on a copy: **Start a new event from this one** on the events list, with a
new name and first day. A copy keeps the locations, roles, shifts, leads and the emergency contact and starts with no
one invited. An event cannot be renamed or deleted from the app, and `npm run seed:prod` skips Spring Expo while one
exists, so a true reset is a `DELETE` against the production database from your terminal.

Add yourself to the directory before the audience arrives: **People → add a person**, your real mobile, kind
volunteer. Then on **Spring Expo → Staff this event**, tick yourself on a Greeter shift and **Send invites**. The text
that arrives is step 4.

### 1. Events (`/o/acme/events`) — 30 seconds

*Say:* "One list. Each event shows its stage, its days and how many shifts are filled. The three closed ones are last
year's; they give the people a history."

Point at Spring Expo: **Staffing**, 16 shifts, 12 assignments. "Start a new event from this one" is how a planner
reuses a plan; there is no separate template feature any more.

### 2. The event page (`/o/acme/events/<id>`) — 2 minutes

*Say:* "The whole plan on one page. Headcount at the top: 7 confirmed of 40 needed. One form adds a shift; the
location and the role are made on the way if they are new. Everything else is under a fold."

Show the stage line: **Stage: Staffing. It starts running by itself on its first day.** Open **Close event…** and read
the warning aloud: "This texts 2 leads a review link and 0 people who checked in a thank-you. A text cannot be unsent."
Close the fold without clicking **Yes**.

Open **Edit** to show change and delete on every line, each delete behind a second click. Say that a delete tells you
why it cannot be done yet (people on the shift, shifts on the role).

### 3. Staff this event (`/staff`) — 2 minutes

*Say:* "This is where people get invited. The count at the top is the truth: 7 confirmed, 3 invited and waiting,
2 declined."

Open **Invite people to this shift** on the first Greeter shift. The list is in reliability order, most reliable
first. A person already on an overlapping shift is listed but cannot be ticked, and the line says what holds them
("busy: Greeter at Spring Expo, 7:30 AM to 12:00 PM"). Tick yourself if you did not before, **Send invites**.

**Nudge everyone still unconfirmed** re-texts the three who have not answered. Do not press it in front of people
unless you are the only real number in the directory (you are, unless someone added one).

### 4. Your phone — 2 minutes

The invite text is one line and a link. Open it. *Say:* "No app, no login. The link is the person's identity for this
event." The first screen is **Confirm** and **Can't make it**; the job, the call time, where to be and who the lead
is sit under **What the job is**. Tap **Confirm**. Back on the laptop, reload Staff: the count moved.

Reply **YES**, **NO** or **HELP** to the text instead if you want to show the SMS path; the webhook answers in
seconds. **STOP** opts the number out, so do not send that one.

### 5. Coverage board (`/board`) — 1 minute

*Say:* "On the day this is the planner's screen. It refreshes itself every ten seconds. Each row is a shift: call
time, who is here, who is overdue, open alerts."

Press **In** on a row to check someone in from the desk. On the day itself the person would tap Here on their own
page, or text HERE; a lead taps it for the crew, and those taps queue offline if the hall has no signal.

Say what you cannot show today: at call time plus grace, a person not checked in becomes an alert that goes to
the lead's phone, then the deputy's, then the planner's email, ten minutes a step.

### 6. Messages (`/messages`) — 1 minute

*Say:* "One message to a group: the whole event, the unconfirmed, one area, one shift, the float pool. Each person
gets a Got it button; the page shows who acknowledged and lets you re-send to the rest."

Send one to **Still unconfirmed (3)** only if you are in that group; otherwise just show the audience list.

### 7. Run of show (`/ros`) and print roster (`/roster`) — 1 minute

The run of show is four lines imported from a spreadsheet plus anything added by hand; an import replaces the imported
lines and keeps the hand-added ones. The roster is one printable sheet per area with the lead's QR code on it: "the
last resort when phones die". Scan the QR with your phone to open Marcus Bell's lead page.

### 8. The lead's page (from the roster QR) — 1 minute

*Say:* "The lead sees one day: who is overdue at the top, in red, with a Here button. Nothing a lead does not need."
Below the fold: the other days, the lead notes and house rules, swaps waiting for approval.

### 9. People (`/o/acme/people`) — 1 minute

*Say:* "Reliability in three words, from the last eight events: Reliable, Not enough history, Missed shifts. It orders
the invite list and shows nowhere else: not to the person, not to a lead." Chloe Zhang reads Missed shifts (two
no-shows in three events); Ben Okafor, with one, reads Not enough history. **Set by hand** overrides it, with a
reason the audit log keeps.

### 10. After the event (`/report`, `/review`) — 1 minute, talk only

Do not close Spring Expo in production. Say: "Closing texts each lead a one-minute review link: tick anyone you would
not have back, one optional note per area. Everyone who checked in gets a thank-you with a Count-me-in-next-time
link. The report is four numbers: places filled, no-shows, late, help requests, then the folds." Open `/report` to show
the four numbers on the empty event.

## B. On the laptop

```bash
cd ~/Projects/onsitestaffing
npm run seed:demo && npm run seed:callboard   # accounts, then Spring Expo (skips if it exists)
npm run dev                                   # http://localhost:4600, port fixed in package.json
npm run links                                 # one phone link per person for Spring Expo
```

Then http://localhost:4600/demo and the same walk as section A. Texts do not leave the laptop: every SMS lands in the
`CapturedMessage` table, so the phone pages come from `npm run links` (paste one into a phone-sized window, or
scan the roster QR from a phone on the same network, using the laptop's address in `APP_URL`).

Day-of on the laptop: the planner's **In** on the board works any day. A person's own Here is refused more than three
hours before call time, and the lead's red overdue rows need a shift past its call time, so describe those rather
than show them; the e2e spec is what exercises them (`e2e/callboard.spec.ts` moves shifts to now).

To show the review locally: close the event from its page, then open Marcus's link with `/review` on the end. The
report counts only shifts that have ended, so on a fresh seed it reads zeros until the event's days have passed.

## Troubleshooting

| Seen | Cause | Do |
|---|---|---|
| Browser asks for a username and password | the shared gate | any username, `DEMO_ACCESS_PASSWORD` |
| 503 on every page in production | `DEMO_ACCESS_PASSWORD` missing from Vercel | the gate fails closed on Vercel; set the variable and push a code change (an env-only redeploy is skipped by the ignore command) |
| `/demo` is 404 | `DEMO_MODE` is not `1` | `.env.local` or Vercel production env |
| Invite sent, no text arrived | the number is a `+1555` demo number, or the number is not in the directory | add yourself under People with a real mobile |
| Text arrived, link says expired or 404 | `AUTH_SECRET` was rotated (every link dies) or the database was reseeded | invite again; locally, `npm run links` |
| A phone page shows another person after a reseed | links are per person per event, the ids changed | `npm run links` again |
| Lead page: "Can't reach them" is missing on an overdue row; no-show alerts and reminders do not arrive | the cron that raises them runs once a day in production (cost review, 2026-10-01); invites and replies send at once, the cron is only retries and sweeps | say so; before a real event put `*/5 * * * *` back in `vercel.json` |
| Board says 0 confirmed where Staff says 2 | the board counts people here, Confirmed is a separate column | read the column headings |
| Report reads zeros | only shifts that have ended are counted | expected before the event |
| Local: `npm run dev` refuses to start | `swapcheck`: under 18% memory available | stop other projects' dev servers (`devservers`) |
| Local: `too many clients already` | other projects' test sweeps hold the Postgres connections | `psql -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname"`, wait for them |
| Local: a reply to a text does nothing | there is no Twilio locally; inbound SMS is production only | use the buttons on the phone page |
| `npm run build` locally fails with a cloud-database refusal | a production build reads `.env.production.local` (INV-18) | use `npm run dev`; the e2e scripts build with `.env.test` |

## Concede before you are asked

- **The data is synthetic.** Twelve made-up people, unroutable numbers, three invented past events. No real event
  has run through it.
- **Email sign-in is off** in production (`EMAIL_ENABLED=0`, no Resend key). Planners sign in through `/demo` only.
  Billing is the foundation's Stripe module, present and unused.
- **One Twilio number, no 10DLC registration**, so sends are low volume. The webhook is signature-checked.
- **Nothing is wired for scale.** The first close sends every thank-you in one transaction (fine to about 500
  people); the board polls every 10 seconds rather than pushing.
- **The live sheet (Smartsheet or Excel link with a Sync button) is built and tested against stand-ins, not the real
  services.** It is in production, but no real sheet has been synced there yet, and no Smartsheet token is set, so a
  Smartsheet link says "not connected". The file upload is the path that has been used.
- **Not reviewed:** keyboard focus order and colour contrast on the planner pages; Safari on plain http.
- **Deliberately not built:** readiness flags, QR-poster self check-in, a per-person message thread, a what-changed
  notice when a shift is edited, cron-driven sheet pulls, pushing check-ins back out to a sheet.
- **Deployed as a demo, not a service:** auto-deploy is off (`vercel.json`), the production database holds the demo
  on purpose, the whole site sits behind one shared password.
