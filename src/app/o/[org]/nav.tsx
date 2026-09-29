'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = { events: ['events', 'templates'], people: ['people'], library: ['cards', 'playbooks'], settings: ['rules', 'settings'] };
type Section = keyof typeof SECTIONS;

// The top bar: four places, and a second row under Library and Settings. Those two rows are built in the
// layout, because that is the file the module markers are read from.
export function Nav({ base, org, library, settings }: { base: string; org: string; library: React.ReactNode; settings: React.ReactNode }) {
  const path = usePathname();
  const at = (Object.keys(SECTIONS) as Section[]).find((s) => SECTIONS[s].some((p) => `${path}/`.startsWith(`${base}/${p}/`)));
  const top = (s: Section, href: string, label: string) => (
    <Link href={`${base}/${href}`} aria-current={at === s ? 'true' : undefined}>{label}</Link>
  );
  return (
    <>
      <nav className="topbar" aria-label="Organisation">
        {top('events', 'events', 'Events')}
        {top('people', 'people', 'People')}
        {top('library', 'cards', 'Library')}
        {top('settings', 'rules', 'Settings')}
        <Link href="/onboarding" className="right" title="Your organisations">{org}</Link>
        <Link href="/account/security">Account</Link>
      </nav>
      {at === 'library' && <nav className="topbar sub" aria-label="Library">{library}</nav>}
      {at === 'settings' && <nav className="topbar sub" aria-label="Settings">{settings}</nav>}
    </>
  );
}
