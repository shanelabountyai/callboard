-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('no_show', 'help');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "checkInMethod" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "checkInSyncedAt" TIMESTAMPTZ(6),
ADD COLUMN     "checkOutMethod" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "checkedInAt" TIMESTAMPTZ(6),
ADD COLUMN     "checkedOutAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "emergencyContact" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "graceMin" INTEGER,
ADD COLUMN     "isFloat" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 2,
    "personId" UUID NOT NULL,
    "assignmentId" UUID,
    "aorId" UUID,
    "step" INTEGER NOT NULL DEFAULT 0,
    "steppedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolution" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "outboxId" UUID,
    "ackedAt" TIMESTAMPTZ(6),

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_assignmentId_resolvedAt_idx" ON "Alert"("assignmentId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Alert_eventId_resolvedAt_idx" ON "Alert"("eventId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Broadcast_eventId_createdAt_idx" ON "Broadcast"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_personId_ackedAt_idx" ON "BroadcastRecipient"("personId", "ackedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_personId_key" ON "BroadcastRecipient"("broadcastId", "personId");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_aorId_fkey" FOREIGN KEY ("aorId") REFERENCES "Aor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
