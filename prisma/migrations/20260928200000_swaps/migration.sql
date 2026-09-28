-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('proposed', 'accepted', 'approved', 'declined', 'refused', 'cancelled');

-- CreateTable
CREATE TABLE "Swap" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "fromId" UUID NOT NULL,
    "toId" UUID NOT NULL,
    "fromShiftId" UUID NOT NULL,
    "toShiftId" UUID NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'proposed',
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMPTZ(6),
    "decidedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Swap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Swap_eventId_status_idx" ON "Swap"("eventId", "status");

-- CreateIndex
CREATE INDEX "Swap_fromId_idx" ON "Swap"("fromId");

-- CreateIndex
CREATE INDEX "Swap_toId_idx" ON "Swap"("toId");

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

