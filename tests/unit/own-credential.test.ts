import { describe, expect, it } from 'vitest';
import { ownCredential } from '@/lib/demo-gate';

// The paths this clone's proxy leaves to their own credential (moved from tests/unit/demo-gate.test.ts at v1.6.5;
// the gate's own tests are now the template's, in that file).
describe('callboard: routes outside the demo password', () => {
  it('leaves open only the paths with a credential of their own', () => {
    for (const p of ['/p/abc', '/p/abc/respond', '/api/sms/inbound', '/api/cron', '/api/webhooks/stripe']) expect(ownCredential(p)).toBe(true);
    for (const p of ['/', '/demo', '/login', '/p', '/o/acme/playbooks', '/api/health', '/api/cron/x', '/s/abc', '/demo/p/abc']) expect(ownCredential(p)).toBe(false);
  });
});
