# Foundation patches

Template-owned files this clone has changed. Format: `` `path` `hash` — reason `` (`npm run foundation:drift` prints the hash).
Each one moves upstream at the next release; the excuse stops matching once the file changes again.

- `src/core/ui/action-form.tsx` `edb0678ba028` — design pass 2026-09-26: the fieldset reset moved from an inline style to `globals.css`, so no inline styles remain in `src/`.
