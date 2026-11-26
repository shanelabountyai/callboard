import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
// Callboard (D-NN): every column of these tables is the org's own working data, none sealed or hashed, so rows go whole.
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  { name: 'Person', rows: (tx, orgId) => tx.person.findMany({ where: { orgId } }) },
  { name: 'Event', rows: (tx, orgId) => tx.event.findMany({ where: { orgId } }) },
  { name: 'EventDay', rows: (tx, orgId) => tx.eventDay.findMany({ where: { orgId } }) },
  { name: 'Aor', rows: (tx, orgId) => tx.aor.findMany({ where: { orgId } }) },
  { name: 'Area', rows: (tx, orgId) => tx.area.findMany({ where: { orgId } }) },
  { name: 'Position', rows: (tx, orgId) => tx.position.findMany({ where: { orgId } }) },
  { name: 'Shift', rows: (tx, orgId) => tx.shift.findMany({ where: { orgId } }) },
  { name: 'Assignment', rows: (tx, orgId) => tx.assignment.findMany({ where: { orgId } }) },
  { name: 'RunOfShowRow', rows: (tx, orgId) => tx.runOfShowRow.findMany({ where: { orgId } }) },
  { name: 'RosSync', rows: (tx, orgId) => tx.rosSync.findMany({ where: { orgId } }) },
  { name: 'Alert', rows: (tx, orgId) => tx.alert.findMany({ where: { orgId } }) },
  { name: 'Broadcast', rows: (tx, orgId) => tx.broadcast.findMany({ where: { orgId } }) },
  { name: 'BroadcastRecipient', rows: (tx, orgId) => tx.broadcastRecipient.findMany({ where: { orgId } }) },
  { name: 'PositionCard', rows: (tx, orgId) => tx.positionCard.findMany({ where: { orgId } }) },
  { name: 'Review', rows: (tx, orgId) => tx.review.findMany({ where: { orgId } }) },
  { name: 'AreaReview', rows: (tx, orgId) => tx.areaReview.findMany({ where: { orgId } }) },
  { name: 'Playbook', rows: (tx, orgId) => tx.playbook.findMany({ where: { orgId } }) },
  { name: 'OrgRules', rows: (tx, orgId) => tx.orgRules.findMany({ where: { orgId } }) },
  { name: 'Swap', rows: (tx, orgId) => tx.swap.findMany({ where: { orgId } }) },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {
  PersonLink: 'per-person magic links: only a token hash and an expiry, a credential table, never exported',
};
