'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Pulls the live sheet when the page opens and every `ms` while the tab is visible, then re-renders the page. */
export function AutoSync({ pull, ms = 60_000 }: { pull: () => Promise<unknown>; ms?: number }) {
  const router = useRouter();
  const latest = useRef(pull);
  useEffect(() => { latest.current = pull; }, [pull]);
  useEffect(() => {
    const tick = () => { if (!document.hidden) latest.current().catch(() => null).then(() => router.refresh()); };
    tick();
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms, router]);
  return <small>Checked again every {ms / 1000} s while this page is open.</small>;
}
