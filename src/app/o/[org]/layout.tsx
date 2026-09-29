import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Nav } from './nav';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  return (
    <>
      <Nav
        base={base}
        org={org.name}
        library={
          <>
            <Link href={`${base}/cards`}>Job descriptions</Link>
            <Link href={`${base}/playbooks`}>Lead notes</Link>
          </>
        }
        settings={
          <>
            <Link href={`${base}/rules`}>Event defaults</Link>
            <Link href={`${base}/settings/members`}>Members</Link>
            {can(ctx.role, 'billing.manage') && <Link href={`${base}/settings/billing`}>Billing</Link>} {/* billing */}
            {can(ctx.role, 'org.delete') && <Link href={`${base}/settings/danger`}>Delete org</Link>}
          </>
        }
      />
      {children}
    </>
  );
}
