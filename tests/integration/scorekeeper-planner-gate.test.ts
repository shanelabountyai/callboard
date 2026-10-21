import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActionSpec } from '@/core/authz/action';
import { AuthzError } from '@/core/authz/guards';
import { db } from '@/core/db';
import { addPerson } from '@/app/o/[org]/people/actions';
import { POST as uploadRos } from '@/app/o/[org]/events/[id]/ros/upload/route';
import { inviteMember, setRole } from '@/app/o/[org]/settings/members/actions';
import Members from '@/app/o/[org]/settings/members/page';
import { seedApp } from '../fixtures/app';
import { allTables, resetAuthTables, signInAs } from '../helpers/auth';
import { actAs, addMember, makeOrg, roleOf } from '../helpers/org';
import { discover, generate } from '../invariants/harness';

beforeEach(resetAuthTables);

// D-001: Callboard's planner surface admits owner, admin and member only. A scorekeeper (core D-21) has no
// results to keep here, so it is refused everything but leaving the org.
type Action = ((slug: string, input: unknown) => Promise<unknown>) & { spec: ActionSpec };

async function snapshot() {
  const tables = (await allTables()).filter((t) => t !== 'RateLimit');
  const rows = await Promise.all(tables.map((t) => db.$queryRawUnsafe<{ j: string }[]>(`SELECT coalesce(json_agg(x ORDER BY x::text)::text, '[]') AS j FROM "${t}" x`)));
  return rows.map((r, i) => `${tables[i]}:${r[0]!.j}`).join('\n');
}

async function seeded() {
  const org = await makeOrg();
  const owner = await addMember(org.id, 'owner', 'owner@example.test');
  const refs = await seedApp({ orgId: org.id, userId: owner.id }, 'a');
  return { org, owner, refs };
}

describe('a scorekeeper in Callboard (D-001)', () => {
  it('is refused every planner action, and nothing is written', async () => {
    const planner = (await discover('src/app/o/**/actions.ts')).filter(({ fn, name }) => {
      const spec = (fn as Action).spec;
      return spec?.kind === 'org' && spec.perm === null && name !== 'leaveOrg';
    });
    expect(planner.length).toBeGreaterThanOrEqual(36);
    const { org, refs } = await seeded();
    const sk = await addMember(org.id, 'scorekeeper', 'sk@example.test');
    await signInAs(sk.id, { mfa: true });
    const leaked: string[] = [];
    for (const { file, name, fn } of planner) {
      const input = generate((fn as Action).spec.schema, (model) => refs[model]!).value;
      const before = await snapshot();
      const outcome = await (fn as Action)(org.slug, input).then((r) => ({ ok: r }), (e: unknown) => e);
      if (!(outcome instanceof AuthzError) || (await snapshot()) !== before) leaked.push(`${file}#${name}`);
    }
    expect(leaked).toEqual([]);
  });

  it('can still leave the org', async () => {
    const { org } = await seeded();
    const sk = await addMember(org.id, 'scorekeeper', 'sk@example.test');
    await signInAs(sk.id, { mfa: true });
    const { leaveOrg } = await import('@/app/o/[org]/settings/members/actions');
    await expect(leaveOrg(org.slug, {})).rejects.toThrow('/onboarding');
    expect(await roleOf(org.id, sk.id)).toBeNull();
  });

  it('is refused the run-of-show upload, and nothing is written', async () => {
    const { org, refs } = await seeded();
    const sk = await addMember(org.id, 'scorekeeper', 'sk@example.test');
    await signInAs(sk.id, { mfa: true });
    const body = new FormData();
    body.set('file', new File(['Time,Cue\n08:00,Doors\n'], 'ros.csv', { type: 'text/csv' }));
    const before = await snapshot();
    const req = new Request(`http://localhost/o/${org.slug}/events/${refs.event}/ros/upload`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body });
    await expect(uploadRos(req, { params: Promise.resolve({ org: org.slug, id: refs.event! }) })).rejects.toBeInstanceOf(AuthzError);
    expect(await snapshot()).toBe(before);
  });
});

describe('owner, admin and member keep the planner surface', () => {
  it.each(['owner', 'admin', 'member'] as const)('%s adds a person', async (role) => {
    const org = await makeOrg();
    const u = await addMember(org.id, role, `${role}@example.test`);
    await actAs(u.id, org.slug);
    await expect(addPerson(org.slug, { name: 'Sam', mobile: '312-555-0100', kind: 'volunteer' })).rejects.toThrow(`/o/${org.slug}/people`);
    expect(await db.person.count({ where: { orgId: org.id } })).toBe(1);
  });
});

/** Every <option> label in a rendered server-component tree (client components keep their children as props). */
function options(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(options);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const { type, props } = node as { type: unknown; props: { children?: ReactNode } };
  return type === 'option' ? [String(props.children)] : options(props.children);
}

describe('the members page and actions do not assign scorekeeper (D-001)', () => {
  it.each(['owner', 'admin'] as const)('the %s sees no scorekeeper in either role picker', async (role) => {
    const org = await makeOrg();
    const actor = await addMember(org.id, role, `${role}@example.test`);
    await addMember(org.id, 'member', 'member@example.test');
    await actAs(actor.id, org.slug);
    const offered = options(await Members({ params: Promise.resolve({ org: org.slug }) }));
    expect(offered).toContain('member');
    expect(offered).not.toContain('scorekeeper');
  });

  it('refuses an invite or a role change to scorekeeper, and writes nothing', async () => {
    const org = await makeOrg();
    const owner = await addMember(org.id, 'owner', 'owner@example.test');
    const member = await addMember(org.id, 'member', 'member@example.test');
    await actAs(owner.id, org.slug);
    expect(await inviteMember(org.slug, { email: 'new@example.test', role: 'scorekeeper' })).toHaveProperty('error');
    expect(await setRole(org.slug, { userId: member.id, role: 'scorekeeper' })).toHaveProperty('error');
    expect(await db.invite.count()).toBe(0);
    expect(await roleOf(org.id, member.id)).toBe('member');
  });
});
