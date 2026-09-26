import { createHmac, randomUUID } from 'node:crypto';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { env } from '@/core/env';
import { hit, LIMITS } from '@/core/rate-limit';
import { hashToken } from '@/core/tokens';
import type { Prisma } from '@/generated/prisma/client';

// One magic link per person per event (PRD 3). The token is derived from the row id and
// AUTH_SECRET, so every message can carry the same link while the database holds only its
// hash (INV-07). Rotating AUTH_SECRET invalidates every link, which is the intended blast radius.
const tokenFor = (id: string) => createHmac('sha256', env.AUTH_SECRET).update(`person-link:${id}`).digest('base64url');
export const linkUrl = (id: string) => `${env.APP_URL}/p/${tokenFor(id)}`;

type Tx = Pick<Prisma.TransactionClient, 'personLink'>;
export type LinkScope = { orgId: string; eventId: string; personId: string };

/** Returns the person's link for this event, creating it or extending its expiry as needed. */
export async function ensurePersonLink(tx: Tx, scope: LinkScope, expiresAt: Date): Promise<string> {
  const existing = await tx.personLink.findFirst({ where: scope, select: { id: true, expiresAt: true } });
  if (existing) {
    if (existing.expiresAt < expiresAt) await tx.personLink.update({ where: { id: existing.id }, data: { expiresAt } });
    return linkUrl(existing.id);
  }
  const id = randomUUID();
  await tx.personLink.create({ data: { id, ...scope, tokenHash: hashToken(tokenFor(id)), expiresAt } });
  return linkUrl(id);
}

/** The anonymous read behind /p/[token]: rate-limited per IP; unknown and expired both read as null. */
export async function readPersonLink(token: string, ip: string) {
  if (!(await hit(`plink:ip:${ip}`, LIMITS.shareReadPerIp))) return 'limited' as const;
  return db.personLink.findFirst({ where: { tokenHash: hashToken(token), expiresAt: { gt: now() } }, include: { person: true, event: true } });
}
