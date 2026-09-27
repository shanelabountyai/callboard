# NEXT

## Callboard (onsite staffing) — phase 2 built 2026-09-26
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
3. Phase 3 (PRD 6: position card library, reliability record, review).

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
