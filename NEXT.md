# NEXT

## Callboard (onsite staffing) — phase 1 shipped 2026-09-26
PRDs (Claude Doc, edit inline): https://claude.ai/code/artifact/7eb03633-a1df-456e-bea8-c28565893944
Repo: https://github.com/shanelabountyai/callboard (private). Port 4600. Clone of saas-foundation v1.0.1.

Phase 1 = events/days/areas/positions/shifts, duplicate-event as the template, AoRs with
lead + deputy (lead gets their roster link by SMS), directory + CSV import, invites with
one-tap confirm from a magic link (no login), planner overrides, T-7/T-1 reminders via cron,
run of show from .xlsx/.csv plus hand-added lines. Gate: lint, typecheck, vitest (incl. the
INV harness over every action) and e2e all green.

## Next item: deploy phase 1, then phase 2 (day-of)
Deploy (needs Shane for two things):
- Neon project → DATABASE_URL (pooled) + DIRECT_URL (unpooled) in Vercel. Not creatable from here.
- Vercel project, Root Directory ".", env: AUTH_SECRET, APP_URL, CRON_SECRET, DEMO_MODE=1 (demo only),
  RESEND_API_KEY/EMAIL_FROM (required in production), Twilio keys when the 10DLC number exists.
- SMS sender: start 10DLC registration; it gates volume sends (PRD 4 open decision).

Phase 2 (PRD 5 P0, PRD 4 targeted sends + ack): offline lead tap check-in on the /p page,
HERE/DONE/YES/NO/HELP inbound keywords (Twilio webhook, signature-checked), coverage board,
no-show alerts keyed off callAt + graceMin with the lead → deputy → planner chain, need-help,
float deploy, printable roster. Note: /p pages must keep the default Referrer-Policy — `no-referrer`
makes browsers send `Origin: null` on the form POST and the same-origin guard refuses it.

Open decisions still unanswered: see the checklist at the end of the PRD doc.
