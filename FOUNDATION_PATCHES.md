# Foundation patches

Template-owned files this clone has changed. Format: `` `path` `hash` — reason `` (`npm run foundation:drift` prints the hash).
Each one moves upstream at the next release; the excuse stops matching once the file changes again.

- `src/core/ui/action-form.tsx` `edb0678ba028` — design pass 2026-09-26: the fieldset reset moved from an inline style to `globals.css`, so no inline styles remain in `src/`.
- `src/proxy.ts` `ab3583508221` — demo gate 2026-09-28: the deployed demo sits behind a shared password (`DEMO_ACCESS_PASSWORD`, logic in `src/lib/demo-gate.ts`). The template ships no proxy; a gate for demo deployments belongs upstream.
