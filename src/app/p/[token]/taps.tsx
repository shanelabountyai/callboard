'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Offline check-in (PRD 5). Forms marked data-tap post as JSON to /p/<token>/act; when the network is
// down the tap is queued in localStorage with the device time and replayed, in order, when signal
// returns. The server keeps the earliest timestamp per assignment, so a replay never overwrites a
// later tap by someone else. Also registers the service worker that keeps the page itself openable.
type Tap = Record<string, string>;
export function Taps({ token }: { token: string }) {
  const router = useRouter();
  useEffect(() => {
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
    const key = `cb-taps:${token}`;
    const url = `/p/${token}/act`;
    const load = (): Tap[] => { try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; } };
    const save = (q: Tap[]) => { try { localStorage.setItem(key, JSON.stringify(q)); } catch { /* private mode: the tap still posts live */ } };
    const post = (body: Tap) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const show = () => {
      const n = load().length;
      const el = document.getElementById('tap-queue');
      if (el) el.textContent = n ? `${n} check-in${n === 1 ? '' : 's'} waiting for signal. Keep this page open; they send themselves.` : '';
    };
    const flush = async () => {
      let q = load();
      if (!q.length) return;
      while (q.length) {
        try { if (!(await post(q[0]!)).ok) break; } catch { break; } // ok or refused: drop it; no network: stop and wait
        q = q.slice(1);
        save(q);
      }
      show();
      router.refresh();
    };
    const onSubmit = async (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!form.matches('form[data-tap]')) return;
      e.preventDefault();
      const btn = e.submitter as HTMLButtonElement | null;
      const body: Tap = { ...(Object.fromEntries(new FormData(form)) as Tap), action: btn?.value ?? '', at: new Date().toISOString() };
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      try {
        const r = await post(body);
        if (!r.ok) window.alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'That did not work. Try again.');
        router.refresh();
      } catch {
        save([...load(), body]);
        if (btn) btn.textContent = 'Queued';
        show();
      }
    };
    document.addEventListener('submit', onSubmit);
    window.addEventListener('online', flush);
    void flush();
    show();
    return () => { document.removeEventListener('submit', onSubmit); window.removeEventListener('online', flush); };
  }, [token, router]);
  return <p id="tap-queue" aria-live="polite" />; // not role=status: the page's own one-time notices use that
}
