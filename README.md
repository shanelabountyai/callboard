# callboard

> Cloned from saas-foundation v1.0.1. Port 4600. Upgrade with `npm run foundation:status`; template-owned paths are listed in the template's plan §3.2.

A Next.js 16 + Prisma 7 + Postgres template with the parts every multi-tenant app rebuilds: magic-link sign-in with TOTP,
orgs and roles, one authorization path, an append-only audit log, share links, cron, and optional billing (Stripe) and
notifications (SMS). Its safety rules are executable: `tests/invariants/` holds INV-01 to INV-28, and CI fails if one breaks.

Design and decisions: `FOUNDATION_SPEC.md`. Milestones and the sync model: `IMPLEMENTATION_PLAN.md`. Releases: `CHANGELOG.md`. Clones: `CLONES.md`.

## Quickstart (about 10 minutes)

Needs Node 22 and a local Postgres 17 you can create databases in (Homebrew `postgresql@17` works with no password).

```bash
git clone git@github.com:shanelabountyai/saas-foundation.git my-app
cd my-app
git remote rename origin template
git checkout -B main v1.0.0   # -B: a fresh clone already has a main
npm ci
npm run new-project -- my-app 4200   # name and port; rewrites package.json, CI, Playwright, README
npm run db:setup                     # creates my_app and my_app_test, writes .env.local and .env.test, migrates both
npm run seed:demo                    # two orgs, owner/admin/member each; owners and admins have TOTP
npm run dev                          # http://localhost:4200/demo
```

**Do not use GitHub's "Use this template" button.** It drops the shared history, so later fixes can't be merged.
Working on the template itself: `npm run dev:template` serves on :4100.

`db:setup` never overwrites an existing `.env.*` and never prints a value. It uses your OS user against `localhost:5432`;
set `PGUSER`/`PGPASSWORD` or `LOCAL_PG_URL_BASE` for a different Postgres. Real keys (Resend, Stripe, Twilio) are optional
and go in `.env.local`; without them email is captured in the database, billing uses a mock, and SMS is off.

## Callboard

Onsite staffing for live events: plan the crew, group areas under leads, invite employees and volunteers by SMS with one-tap confirm, mirror the run of show from Excel or Smartsheet, then run the day: check-in (lead taps that work offline, SMS HERE, the person's page), no-show alerts that walk the lead → deputy → planner chain, help requests, float deploy, a coverage board, broadcasts with a one-tap "Got it", and a printable roster. The PRDs are the spec: see `NEXT.md` for the link.

| Command | What it does |
|---|---|
| `npm run seed:demo && npm run seed:callboard` | demo accounts plus the Spring Expo for the Acme org (12 people, 2 AoRs, 16 shifts, a half-staffed plan) |
| `npm run dev` | http://localhost:4600/demo, sign in as owner@acme.demo.test (DEMO_MODE=1) |
| `npm test` | unit, integration and invariants; Callboard's are `tests/unit/callboard-lib.test.ts`, `tests/integration/callboard-reminders.test.ts` and `tests/integration/callboard-dayof.test.ts` |
| `npm run test:e2e -- e2e/callboard.spec.ts` | invite → SMS link → confirm without a login; .xlsx run-of-show import; the board, self and lead check-in; a broadcast with Got it |

Where things live: `prisma/schema/callboard.prisma` (tables), `src/lib/` (phone, CSV, xlsx reader, timezone, magic links, message templates, reminders, `dayof.ts` for check-in and alerts, `inbound.ts` for SMS keywords, `broadcast.ts` for targeted sends), `src/app/o/[org]/{people,events}` (planner pages: plan, staff, board, messages, roster, run of show), `src/app/p/[token]` (the person's and lead's page, no login; `act/` takes its taps, `taps.tsx` queues them offline, `public/sw.js` keeps the page openable), `src/app/api/sms/inbound` (Twilio webhook, signature-checked, fails closed without `TWILIO_AUTH_TOKEN`), `src/app/cron-jobs.ts` (reminders, the day-of sweep, then the outbox drain).

Messages: without Twilio keys every SMS and email is captured in `CapturedMessage` (read it with `psql`). Invites, nudges, releases, broadcasts and alerts drain the outbox immediately; the cron runs every 5 minutes (`vercel.json`) for reminders, no-show alerts and escalation. Point Twilio's inbound webhook at `APP_URL/api/sms/inbound`; the signature is computed over that exact URL.

## Commands

| Command | What it does |
|---|---|
| `npm test` | vitest against the local test database: unit, integration and all invariants |
| `npm run test:e2e` | Playwright against a production build (`E2E_DEV=1` runs the dev server for debugging one spec) |
| `npm run lint` / `typecheck` | ESLint (including the core-boundary rule) and `tsc` |
| `npm run db:migrate` | create a migration in dev; `db:migrate:test` applies to the test database |
| `npm run seed:demo` | idempotent demo accounts; refuses a cloud database |
| `npm run foundation:drift` | in a clone: fails if a template-owned file was edited |
| `npm run foundation:status` | in a clone: current vs latest release, and any `security:` changelog entries between |
| `npm run foundation:check-modules` | builds a scratch copy with both modules deleted (CI runs it) |

## Layout

- `src/core/`: env, db, auth, tenancy, authz, audit, tokens, email, share links, cron. Never imports from `src/modules` or `src/app` (lint-enforced).
- `src/modules/{billing,notifications}/`: optional, deletable.
- `src/app/`: routes. `src/app/cron-jobs.ts` is where a clone adds its own cron work.
- `prisma/schema/`: `core.prisma` plus one file per module. A clone's tables get their own file and migrations.
- `tests/invariants/`: the security rules as tests. `tests/fixtures/app.ts` holds a clone's harness rows.

## Removing a module

Delete the paths listed for it in `scripts/foundation-modules.ts`, the lines ending `// billing` or `// notifications`
in `prisma/schema/core.prisma` and `src/app/cron-jobs.ts`, and the module's nav link in `src/app/o/[org]/layout.tsx`.
`foundation:check-modules` does exactly this in a scratch copy and requires validate, typecheck, build and drift to pass.
The module's tables stay in the migration history; drop them with a clone migration if you want them gone.

## Staying current

Template-owned paths (core, modules, invariants, security routes) are never edited in a clone, so `git merge vX.Y.Z` is clean.
An urgent local patch goes in `FOUNDATION_PATCHES.md` (path and reason) and moves upstream at the next release.
Upgrade steps and versioning rules: `IMPLEMENTATION_PLAN.md` §3.3.

## Not included

Legal pages are stubs (`/legal/privacy`, `/legal/terms`) and are not legal advice. There is no audit-log viewer and no
`/o/[org]/settings/security` page yet.
