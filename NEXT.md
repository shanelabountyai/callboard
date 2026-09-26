# NEXT

## PRDs (done 2026-09-26)
Callboard — Onsite Staffing PRDs (Claude Doc, edit inline):
https://claude.ai/code/artifact/7eb03633-a1df-456e-bea8-c28565893944

Six PRDs + build plan. Working name "Callboard". Open decisions are the
checklist at the end of the doc; answer those before phase 1 starts.

## Next item
Phase 1 build: plan + AoRs/leads + directory import + one-tap confirm.
- Clone saas foundation template (Next.js + Prisma + Postgres + Vercel).
- Port 4600 (next free in the CLAUDE.md port table) — claim it in the same
  commit that creates the config, and add the table row.
- Local DATABASE_URL gets ?connection_limit=10&pool_timeout=20.
- vercel.json ignoreCommand from CLAUDE.md on day one.
- Start SMS sender (10DLC) registration in week one; it gates volume sends.
- Not a git repo yet: git init, private GitHub repo before first commit.
