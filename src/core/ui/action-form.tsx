'use client';
import { useActionState } from 'react';

/**
 * The one form for orgAction/userAction exports: shows the `{ error }` a refused action returns,
 * or the `{ notice }` one returns instead of redirecting (a value shown once, like a share link),
 * and disables itself while pending. Pass a bound action for org routes: `setRole.bind(null, slug)`.
 */
export function ActionForm({ action, children }: { action: (form: FormData) => Promise<unknown>; children: React.ReactNode }) {
  const [state, submit, pending] = useActionState(async (_: unknown, form: FormData) => action(form), null);
  const error = state && typeof state === 'object' && 'error' in state ? String(state.error) : null;
  const notice = state && typeof state === 'object' && 'notice' in state ? String(state.notice) : null;
  return (
    <form action={submit}>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={pending}>
        {children}
      </fieldset>
    </form>
  );
}
