'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Re-renders the server page every `ms` while the tab is visible: a lightweight poll, no sockets (PRD 5). */
export function AutoRefresh({ ms = 10_000 }: { ms?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<string>('');
  useEffect(() => {
    const tick = () => { if (!document.hidden) { router.refresh(); setAt(new Date().toLocaleTimeString()); } };
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms, router]);
  return <small>{at ? `updated ${at}` : 'live'}</small>;
}
