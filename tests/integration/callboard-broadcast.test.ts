import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { resolveAudience } from '@/lib/broadcast';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';
import { stage } from '../helpers/stage';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); });

describe('a broadcast audience', () => {
  it('an id-less or malformed id is refused, never widened to the whole event', async () => {
    const s = await stage('live'); // Tom and Jen confirmed on Registration, Ana declined
    // Before the fix, 'person' with no id resolved to the whole event under the first person's name; 'aor:' was a 500.
    for (const bad of ['person', 'aor', 'area', 'person:', 'aor:', 'area:', 'shift:', 'aor:not-a-uuid', 'person:123']) {
      await expect(resolveAudience(s.orgId, s.event.id, bad), bad).rejects.toThrow('That audience no longer exists.');
    }
    await expect(resolveAudience(s.orgId, s.event.id, 'everyone')).rejects.toThrow('Pick who this goes to.');
  });

  it('names exactly who it says, in this org only', async () => {
    const s = await stage('live');
    const one = await resolveAudience(s.orgId, s.event.id, `person:${s.tom.id}`);
    expect(one).toMatchObject({ label: 'Tom Alvarez', people: [{ id: s.tom.id }] });
    const all = await resolveAudience(s.orgId, s.event.id, 'event');
    expect(all.people.map((p) => p.name).sort()).toEqual(['Jen Park', 'Tom Alvarez']); // a decline is not on the list

    const aor = await db.aor.findFirstOrThrow({ where: { eventId: s.event.id, leadId: s.marcus.id } });
    expect((await resolveAudience(s.orgId, s.event.id, `aor:${aor.id}`)).people).toHaveLength(2);
    const floor = await db.aor.findFirstOrThrow({ where: { eventId: s.event.id, leadId: s.sofia.id } });
    expect((await resolveAudience(s.orgId, s.event.id, `aor:${floor.id}`)).people).toHaveLength(0);

    const other = await makeOrg('globex');
    const stranger = await db.person.create({ data: { orgId: other.id, name: 'Sam Stone', mobile: '+15550100099', kind: 'volunteer' } });
    await expect(resolveAudience(s.orgId, s.event.id, `person:${stranger.id}`)).rejects.toThrow('That audience no longer exists.');
  });
});
