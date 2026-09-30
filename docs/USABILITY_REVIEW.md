# Callboard usability review

29 September 2026. I reviewed the running app on a local dev server (port 4600, local database `callboard`, demo org Acme Studio) using a scripted browser at 1280 px for planner pages and 375 px for lead and staff pages. I drove every job below end to end, including a brand-new org, a new event built from blank, a day-of run with real no-show alerts, a help request, a swap and a close. Screenshots are in [`docs/usability/`](usability/). The round Next.js "N" badge in the corner of the screenshots appears only in development. Ignore it.

---

## 1. Verdict

You are right, but the product is not complicated everywhere. The phone pages that staff see are mostly simple: one card, one big button. The complexity is on the **planner side**, and it comes from one cause: **every feature from all three phases is shown at once, on every event, from the first minute.** The event page alone has 38 buttons, and 25 of them are Delete (no confirmation on any of them). Nine concepts (areas of responsibility, areas, positions, shifts, cards, playbooks, templates, rules, tiers) appear before the planner has invited a single person. The top bar has twelve items, and a first event needs three of them. The lead page has the same problem on a smaller scale: two check-in lists for the same crew, and a one-tap "Release them" that texts the person with no undo.

## 2. The five changes that would matter most

| # | Change | What the person experiences now | What to change | Cost | What is lost |
|---|---|---|---|---|---|
| 1 | **A plain event page** | For Spring Expo the event page is 4,300 px tall and has 838 words, 38 buttons (25 are Delete), 15 visible fields and 11 fold-outs ([p-event.png](usability/p-event.png)). Every dropdown has its own Save button beside it: Set status, Set playbook, Move, Set card, Save lead. Adding a shift asks for call offset and overbook %; adding a position asks for 8 things, including grace and float pool ([a3-add-shift.png](usability/a3-add-shift.png), `src/app/o/[org]/events/[id]/page.tsx:195-227`). | Show one list: *Location → Role → Shifts*, with **one "Add shift" form** that has five fields (location, role, day, start and end, how many). Put a lead picker in the same place. Move card, playbook, grace, float, call offset, overbook, radio channel and colour into a **"More options"** fold on each item. Replace the per-control Save buttons with one Save per item. Put every Delete behind an "Edit" mode and a confirmation. | Medium (2 to 3 days) | Nothing functional. Someone who sets overbook or grace per shift needs one extra click. |
| 2 | **Four items in the top bar, not twelve** | The bar shows Home, Events, People, Cards, Playbooks, Templates, Rules, Members, Billing, Delete org, Your orgs and Account ([p-events.png](usability/p-events.png)). Home is the same page as Events. In a brand-new org, Cards, Playbooks and Templates are empty pages ([n3-new-org-cards.png](usability/n3-new-org-cards.png)). "Delete org" sits in the main navigation. | **Events · People · Library · Settings**, with the account and org switcher on the right. Library holds job descriptions (cards), and later lead notes. Settings holds event defaults (rules), members, billing and delete org. Cut Home and Templates (see change 5). | Small (under a day) | Some discoverability of the library, which a first event does not need. |
| 3 | **Clear event stages instead of a five-option status dropdown** | Status is a dropdown (draft, staffing, confirmed, live, closed) plus a "Set status" button. From the code, staffing, confirmed and live all behave the same except that live freezes cards and rules (`src/lib/dayof.ts:18`, `src/lib/reminders.ts:10`). Invites go out even while the event is a draft (I invited Tom to a draft event and the text was sent). Choosing "closed" and pressing Set status immediately texts every lead and everyone who checked in. There is no confirmation (`src/app/o/[org]/events/[id]/actions.ts:23-36`). | Replace the dropdown with one button showing the next step: **"Open for staffing"** and then **"Close event…"**, which opens a confirmation such as *"This texts 3 leads a review link and 12 people a thank-you."* Make "live" automatic on the first day. Cut "confirmed". | Small to medium (1 day) | Manually freezing cards before the day. It becomes automatic at the start of the first day. |
| 4 | **Phone pages: the action first, everything else folded** | *Staff:* when the position has a job card, the Confirm button sits below the first screen: its top is at 916 px on an 812 px phone, after about 140 words ([s11-expo-staff-firstscreen.png](usability/s11-expo-staff-firstscreen.png)). The card text is followed by the position notes, which repeat it almost word for word. *Lead:* on the day, each missing person appears twice, once in "Needs you" with They're here / Release them / Handled and again in the roster with Here ([l1-lead-alert.png](usability/l1-lead-alert.png)). One tap on "Release them" took Tom off his shift and texted him "You are not needed" with no confirmation or undo ([l3-lead-after-release.png](usability/l3-lead-after-release.png)). A deputy's page for the two-day expo is 523 words and about 3,500 px long, with every shift of both days expanded ([s12-expo-priya.png](usability/s12-expo-priya.png)). | *Staff:* show the shift, "Be there by" and **Confirm / Can't make it** first, with the job description folded below under "What the job is". Drop the notes when they repeat the card. *Lead:* show **today only**, with one roster where the overdue people sit at the top in red and each row has a Here button. Change "Release them" to **"Can't reach them"**, which tells the planner and does not text the person, and add an undo. | Medium (2 days) | A lead can no longer release someone from the phone. The planner does that. That is arguably safer. |
| 5 | **Hide the after-event and reliability machinery until it earns its place** | Tiers (tier 1/2/3) show on the People list, the invite list and the lead's roster ([a5-invite-list.png](usability/a5-invite-list.png), [l4-lead-swap.png](usability/l4-lead-swap.png)). The lead review asks 18 questions for a crew of five: an outcome, "Have them back?" and a note per person, then three free-text questions ([l7-lead-review.png](usability/l7-lead-review.png)). The report opens with a 60-row coverage-by-hour table ([p-report.png](usability/p-report.png)). **Bug:** for Spring Expo, 18 days away, the report says "7 confirmed shifts, 7 no-shows (100%)", because a shift that has not happened yet counts as a no-show (`src/lib/review.ts:41`, used by `src/lib/report.ts:67`). Templates duplicate "Start a new event from this one", which already sits on every event in the list. | Lead review: **"Anyone you would not have back?"** (tick names) plus one note box, pre-filled from check-in. Report: four numbers first (filled, no-shows, late, help requests), with the hourly table folded. Show tiers only on the People page, not to leads. Cut Templates and keep "Start from an earlier event". Fix the future-shift no-show count. | Medium (2 to 3 days) | Per-person outcome edits by the lead: the planner can still change them. The template library: a closed event is the template. |

## 3. Job walkthroughs

Clicks include taps and ticks. "Fields" means fields typed or chosen. "Decisions" means choices the screen forces that a first-timer has no basis for. Words are the words on screen before the person can act.

### Planner

| Job | Screens | Clicks | Fields | Decisions | Words before acting | Target after changes |
|---|---|---|---|---|---|---|
| (a) Create an event and get one shift staffed with one confirmed person (the person already in People) | 3 (Events, event, Staff) | 12 | 8 | 5: whether an AoR is needed first; area vs position vs shift; call offset; overbook %; which of 5 statuses to use (left at draft, which still sent the invite) | ~325 (events ~115, blank event ~150, staff ~60) | 2 screens, 6 clicks, 5 fields, 1 decision |
| (a) plus giving the area a lead | +0 | +4 | +3 | +1: an AoR has to be created, then the lead saved, then the area "moved" into it, each with its own button ([a7-add-aor.png](usability/a7-add-aor.png)) | +40 | +1 click, +1 field (lead picked in the Add shift form) |
| (a) in a brand-new org | +1 (People) | +2 | +5 | +0 | +45 | The same, but the empty event page links to "Add people" |
| (b) On the day, see who has not arrived and act | 2 (event → Coverage board) | 2 to open, +1 per shift row to see names, +1 to act | 0, or 1 (the typed "How it was resolved" note) | 1 | ~210 ([b1-board-dayof.png](usability/b1-board-dayof.png)) | 1 screen (board as the event's day-of home), 1 click, 0 fields |
| (c) Send everyone a message | 2 | 2 | 1 (audience defaults to the whole event) | 1 ("Got it" tick) | ~60 ([p-messages.png](usability/p-messages.png)) | Unchanged: this page is already right |
| (d) Close the event and read how it went | 3 (event → Review → Report) | 3 (pick "closed", Set status, Report link) | 1 | 1 among 5 statuses, with no warning that texts go out | ~240 on Review, ~690 on Report with its 60-row table | 2 screens, 2 clicks plus a confirmation, 0 fields, report summary under 80 words |

### Lead (phone, no login)

| Job | Screens | Taps | Fields | Decisions | Words before acting | Target |
|---|---|---|---|---|---|---|
| (a) Check in their crew | 1 | 1 per person | 0 | 1: which of the two check-in buttons to use for the same person | ~160 on the day ([l1-lead-alert.png](usability/l1-lead-alert.png)), ~256 before the day for a two-day event ([l6-expo-lead.png](usability/l6-expo-lead.png)) | 1 tap per person, one list, under 50 words |
| (b) Respond to a no-show alert | 1 | 1 | 0 | 1 among 3: They're here / Release them / Handled. "Release" is permanent and texts the person | ~30 per alert | 1 tap among 2: Here / Can't reach them, with undo |
| (c) Approve a swap | 1 | 1 | 0 | 1 | ~40 ([l4-lead-swap.png](usability/l4-lead-swap.png)) | Unchanged: already right |
| (post-event) Review | 1 | 1 | 18 for five people | 15 (outcome and "have them back" per person) | ~215 ([l7-lead-review.png](usability/l7-lead-review.png)) | 1 tap plus optional ticks and one note: 1 to 3 fields |

### Staff (phone, no login)

| Job | Screens | Taps | Fields | Decisions | Words before acting | Target |
|---|---|---|---|---|---|---|
| (a) Confirm a shift from the text | 1 | 1, plus a scroll when the role has a card | 0 | 1 | 31 without a card ([s1-invite-page.png](usability/s1-invite-page.png)); ~140 with one, and Confirm is below the fold ([s11-expo-staff-firstscreen.png](usability/s11-expo-staff-firstscreen.png)) | 1 tap, no scroll, under 40 words |
| (b) Find where to be and when | 1 | 0 | 0 | 0 | Top of the page: "Be there by 9:07 AM", where, what to wear, lead's number | Unchanged: good |
| (c) Check in | 1 | 1 | 0 | 0 | ~30 ([s3-staff-dayof.png](usability/s3-staff-dayof.png)) | Unchanged: good |
| (d) Ask for help | 1 | 2 (open "Need help?", then "Send to my lead") | 0 to 2 | 1 (kind; "supplies" is pre-picked) | ~25 ([s5-help-open.png](usability/s5-help-open.png)) | 2 taps; unchanged apart from the wording in section 7 |

## 4. Cut, hide, merge, keep

"Hide" means move it into a fold or a section named where the item goes, so it is not shown by default.

| Feature or item | Where it is now | Verdict | Reason |
|---|---|---|---|
| Home | Top bar | **Cut** | Same page as Events. |
| Events | Top bar | Keep | The planner's home. |
| People | Top bar | Keep | Needed before a first invite. |
| Cards | Top bar | **Hide** → Library | Useful, but not needed for a first event. |
| Playbooks | Top bar | **Merge** → a "Notes for the lead" box on each location | A playbook is lines of text shown to one lead. A separate versioned library is too heavy for that. |
| Templates | Top bar | **Cut** | Duplicates "Start a new event from this one" on the events list. A template is also an event that can never be staffed, which is a second concept for the same thing. |
| Rules (standard rules) | Top bar | **Hide** → Settings › Event defaults | Ten settings with good defaults. A first-timer should never need to see them. |
| Members | Top bar | **Hide** → Settings | Rarely used. |
| Billing | Top bar | **Hide** → Settings | Rarely used. |
| Delete org | Top bar | **Hide** → Settings, at the bottom | Should never sit in the main navigation. |
| Your orgs, Account | Top bar | **Merge** → account menu at the right | Standard place. |
| Projects page | `/o/acme/projects`, not linked | **Cut** | Left over from the template ([p-projects.png](usability/p-projects.png)). |
| Event sub-links: Staff this event, Coverage board, Messages, Print roster, Run of show, Review, Report (eight with Events) | Event page | **Merge** into four tabs: Plan · Staff · Day of · After | See section 5. |
| Status dropdown and Set status | Event page | **Merge** → stage buttons | Change 3. |
| "Rules for this event" | Event page | **Hide** → Plan › More options | Almost always standard. |
| "Save as a template" | Event page | **Cut** | Change 5. |
| Headcount table | Event page | Keep, simplified | The best summary on the page. Drop the "AoR" and "Invited" columns. |
| Areas of responsibility (as a separate section) | Event page | **Merge** → a "Lead" picker on each location | Leads matter. A separate object with its own add form, colour, radio and Move button does not. |
| Deputy | AoR section | Keep, under More options | The escalation chain uses it. |
| Radio channel, colour swatches | Add AoR form | **Hide** → More options; colour automatic | Defaults work. |
| Playbook picker per area | Event page | **Merge** (see Playbooks) | |
| "Belongs to" and Move per area | Event page | **Merge** → the Lead picker | |
| Card picker per position, with version | Event page | **Hide** → More options; match a card by role name automatically | A first-timer does not know what a card version is. |
| Minimum and target headcount | Add position | **Merge** → one "How many"; minimum under More options | Two numbers per role is a decision with no basis the first time. |
| What to wear, notes for this event | Add position | Keep | Staff need them. |
| No-show grace per position | Add position | **Hide** → More options | |
| Float pool checkbox | Add position | **Hide** → More options | Only the day-of board uses it. |
| Call offset, overbook % per shift | Add shift | **Hide** → More options | Event defaults cover them. |
| Delete AoR, area, position, shift (25 buttons on Spring Expo) | Event page | **Hide** → Edit mode, with a confirmation | None of them asks "are you sure?" (`src/core/ui/action-form.tsx` has no confirm step). |
| Timezone as free text | New event form | **Hide** → default from the org, a picker under More | Typing "America/Chicago" is error-prone. |
| "Start a new event from this one" | Events list | Keep, as one button per event | This is the template feature. |
| Per-shift invite list | Staff page | Keep | Works; 3 clicks ([a5-invite-list.png](usability/a5-invite-list.png)). |
| Tier pills in the invite list | Staff page | **Hide** → sort order only | Sorting already does the work. |
| Per-person status dropdown and Set | Staff page | **Merge** → a small row menu (Remind, Mark confirmed, Remove) | |
| Nudge everyone still unconfirmed | Staff page | Keep, renamed "Remind" | |
| Swaps list | Staff page | Keep | |
| Coverage board | Event | Keep, as the "Day of" tab | Already clear ([b1-board-dayof.png](usability/b1-board-dayof.png)). |
| Print roster | Event | **Merge** → a button on Day of | |
| Messages | Event | Keep | Already simple. |
| Run of show, with live sheet and file import | Event | **Hide** → a Plan › Run of show fold, empty by default | Not needed to staff an event. |
| Review (planner page) | Event | **Merge** → After tab | |
| Report | Event | Keep in After, with the summary first | Change 5. |
| Report: equipment section | Report | **Cut** | It says the feature does not exist. |
| Report: no-shows by tier | Report | **Hide** → fold | |
| Reliability column and "Set by hand" | People | **Hide** → a fold per person | |
| Remove per person | People | Keep, with a confirmation | |
| CSV import | People | Keep, folded | Needed for a first real event. |
| Card history, versions | Cards | Keep, folded | Already folded. |
| Thank-you and "Count me in next time" | Close | Keep | Cheap and warm. |
| Lead review, 3 questions per person | Lead phone | **Cut** to the short form | Change 5. |

## 5. Proposed navigation and event page

```
Top bar:  Events   People   Library   Settings            [Acme Studio ▾] [You ▾]
            Library  = Job descriptions (cards) · Lead notes
            Settings = Event defaults (rules) · Members · Billing · Delete org

Events
  Upcoming first, then past
  [New event]   [Start from an earlier event ▾]

Event: Spring Expo        Stage: Planning → [Open for staffing]   (later: [Close event…])
  Tabs:  Plan | Staff | Day of | After

  Plan    Headcount summary (filled / needed, per location)
          Location ▸ Role ▸ Shifts          [+ Add shift]  (location, role, day, times, how many, lead)
          each item: More options (job description, lead notes, deputy, grace, extra invites, arrive-early minutes, radio)
          Run of show (folded)   Event defaults for this event (folded)   [Edit] shows the delete buttons
  Staff   Per shift: who is confirmed, invite people, remind, swaps waiting
  Day of  Needs attention now (overdue, help) · coverage by team · [Message people] [Print roster]
  After   Summary (4 numbers) · lead reviews done · coverage by hour (folded) · [Message people]
```

## 6. Wording

| Current word | Proposed word | Where it appears |
|---|---|---|
| Area of responsibility, AoR | **Team** (with "led by") | Event page headings and table header, board, lead page "You lead…" |
| Ungrouped (planner) | No lead (you) | Headcount table, "Belongs to" dropdown |
| Position | Role | Event page, report |
| Card, position card | Job description | Top bar, event page ("Card (version 1)"), cards page |
| Playbook | Lead notes | Top bar, event page, lead page |
| Template | (cut) | Top bar, event page |
| Standard rules, rules | Event defaults | Top bar, rules page, event page |
| Deviates from standard | Changed for this event | Events list, event page, rules page |
| Tier 1 / 2 / 3 | Reliable / Not enough history / Missed shifts (People page only) | People, invite list, lead roster, report |
| Overbook % | Extra invites (%) | Every shift line on the event page ("overbook 20%"), add-shift form, rules |
| Invite slots used | Invites sent (of N allowed) | Staff page shift header ("0 of 3 invite slots used") |
| Call offset (min) | Arrive early by (minutes) | Add shift form |
| Call time, "call 6:45 AM" | Arrive by 6:45 AM | Event page, board column "Call", lead roster. The staff page already says "Be there by", which is good. |
| No-show grace | Counts as late after (minutes) | Rules, add position |
| No-show escalation, help escalation | If nobody answers, pass it on after (minutes) | Rules |
| Float pool | Floaters | Add position |
| Release them | Can't reach them | Lead alert card |
| Handled | Done | Lead alert card |
| Nudge everyone still unconfirmed | Remind everyone who hasn't answered | Staff page |
| Status values draft / staffing / confirmed / live / closed | Planning / Staffing / Running / Closed | Event page, events list |
| "live" (small label on the board) | Updating every 10 s | Board header ([p-board.png](usability/p-board.png)); it reads as the event's status |
| Help kinds "vip", "relief" | VIP guest, Need a break | Staff help chips |

**Terms that appear before they are explained:** AoR is a table column in Headcount before the "Areas of responsibility" section explains it. "Overbook" is on every shift line and is explained only on the Rules page. "Tier" appears on the invite list and is explained only on People. "Card (version 1)" appears on the event page. "Grace" and "escalation" appear only on Rules, but their effects show up on the board and in texts ("overdue since").

## 7. Smaller findings

| Page | Finding | Severity | Evidence |
|---|---|---|---|
| Report | Future confirmed shifts count as no-shows: Spring Expo (18 days away) reports "7 no-shows (100%)", "Tier 2: 6 no-shows". A planner reading the report before an event would be alarmed. | Blocks the job (wrong numbers) | [p-report.png](usability/p-report.png), `src/lib/review.ts:41` |
| Board | For an event weeks away, the board shows every shift with a red "0 here". | Slows | [p-board.png](usability/p-board.png) |
| Board | To resolve an alert there is a text box, "How it was resolved", beside Resolve. It is optional, but it looks required. | Cosmetic | [b1-board-dayof.png](usability/b1-board-dayof.png) |
| Event page | Changing a dropdown does nothing until the button beside it is pressed (Set playbook, Move, Set card, Save). In my scripted run, a lead Save and an area Move pressed back to back left the area without its team. Pending forms disable each other. This is an inference from the run: a person changing several dropdowns and pressing one button will lose the others. | Slows | [a8-event-with-aor.png](usability/a8-event-with-aor.png) |
| Event page | A lead cannot be picked when the team is created. It takes three separate saves: create, set lead, move area. | Slows | [a7-add-aor.png](usability/a7-add-aor.png) |
| Event page | "Invited" counts and the event status disagree: a draft event sends real invites. | Slows (trust) | `a1`–`a6` run; SMS captured while the status was draft |
| Events list | Events are listed by creation date, so the upcoming Spring Expo sits below three closed events. Also "1 shifts". | Cosmetic | [p-events.png](usability/p-events.png) |
| New org | The empty Events page says "Create one below" but does not say that people need to be added first. "Start from a template" leads to an empty page. | Slows | [n1-new-org-landing.png](usability/n1-new-org-landing.png), [p-templates.png](usability/p-templates.png) |
| People | Every row has a Remove button with no confirmation, and the list has no search. It is fine at 12 people and will not be at 200 (inference). | Slows | [p-people.png](usability/p-people.png) |
| Rules | Ten settings on one page with no indication of which matter. | Cosmetic, once hidden | [p-rules.png](usability/p-rules.png) |
| Close | Closing sends texts to leads and everyone who checked in, with no preview or count. | Blocks (irreversible) | `src/app/o/[org]/events/[id]/actions.ts:23-36` |
| Lead page | "Release them" is one tap, permanent, and texts the person immediately. | Blocks (irreversible) | [l3-lead-after-release.png](usability/l3-lead-after-release.png) |
| Lead page | The alert text says "Check in, release or get cover", but there is no "get cover" action on the page. | Slows | Captured SMS |
| Lead page | Tiers show next to each crew member's name. That puts a reliability score in front of a colleague from another department. It is a product choice, but it is the kind of thing that makes a volunteer lead uneasy (inference). | Cosmetic | [l4-lead-swap.png](usability/l4-lead-swap.png) |
| Lead page | "3 confirmed of 2" is shown when overbooking worked. It reads as an error. | Cosmetic | [l1-lead-alert.png](usability/l1-lead-alert.png) |
| Lead review | Closing before the later shifts had ended pre-filled "No-show" for people whose shifts were still to come. Only the lead's attention stops that from becoming a strike. | Slows (wrong defaults) | [l7-lead-review.png](usability/l7-lead-review.png) |
| Staff page | After confirming, the Confirm button stays on screen, greyed out, next to an active Decline. On the day, a confirmed person can still decline with one tap. | Cosmetic | [s2-after-confirm.png](usability/s2-after-confirm.png), [s8-swap-open.png](usability/s8-swap-open.png) |
| Staff page | The position notes repeat the card almost word for word. | Cosmetic | [s11-expo-staff.png](usability/s11-expo-staff.png) |
| Staff page | The "Swap with" dropdown is wider than the card on a 375 px phone and sticks out past its edge. | Cosmetic | [s8-swap-open.png](usability/s8-swap-open.png) |
| Staff page | The help panel says "call venue security first" but gives no number unless the planner filled in the emergency contact (hidden under the event's Rules fold). | Slows | [s5-help-open.png](usability/s5-help-open.png) |
| Staff page | Help is pre-set to "supplies", so a hurried tap on Send reports a medical problem as supplies. | Slows | [s5-help-open.png](usability/s5-help-open.png) |
| Staff text | The invite says "Lead: the planner" when an area has no lead. | Cosmetic | Captured SMS |
| Messages | Fine as it is. | – | [p-messages.png](usability/p-messages.png) |
| Swaps | Fine: one tap per person, clear wording. | – | [s9-swap-asked.png](usability/s9-swap-asked.png), [s10-omar-swap-ask.png](usability/s10-omar-swap-ask.png) |
| Check-in (staff) | Fine: one large button with the time shown after. | – | [s4-staff-checked-in.png](usability/s4-staff-checked-in.png) |

**Accessibility basics (what I checked):** on the phone pages every button measured 44 px tall or more. The only smaller targets are the phone-number links (about 18 px tall), which is acceptable for inline links. Form fields on the planner pages have visible labels. The alert selects on the lead review carry their question inside the option text ("Have them back? No opinion") instead of a separate label, which is harder to scan. I did not measure contrast or test keyboard focus order (see section 8).

## 8. What I did not review

- **Not reviewed:** Members, Billing, Account and security, email sign-in, SMS keywords (YES, HERE, HELP and so on), the offline queue for lead taps, the printed roster in print layout, dark mode, keyboard focus order, screen readers and colour contrast measurement.
- **From code only:** that staffing, confirmed and live behave the same apart from freezing (`src/lib/dayof.ts:18`, `src/lib/reminders.ts:10`, `src/lib/inbound.ts:22`); that no form has a confirmation step (`src/core/ui/action-form.tsx`); and what closing sends (`actions.ts:23-36`). The texts it sent were also seen in the captured messages.
- **How the day-of state was made:** I built a throwaway event, "Usability Gala", through the UI (create, area, role, shift, team, lead, invite, confirm), then moved its day to today in the local database and ran the no-show sweep once by hand, as the 5-minute cron would. Its call times were set in the past on purpose, so the "Late" pre-fills in [l7-lead-review.png](usability/l7-lead-review.png) are an effect of that setup and are not reported as a defect.
- **Left behind in the local environment:** I deleted the throwaway event and a throwaway org, "Usability Blank" (removed through Settings › Delete org). New person links for Tom, Marcus and Priya on Spring Expo, captured messages and audit rows remain in the local database. `next dev` wrote `AGENTS.md` and `CLAUDE.md` into the repo root (untracked). I was not permitted to delete them, so remove them by hand if you do not want them.
