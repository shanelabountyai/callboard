-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('showed', 'late', 'no_show', 'left_early');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "closedAt" TIMESTAMPTZ(6),
ADD COLUMN     "reviewAskedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "tierNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tierOverride" INTEGER;

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "cardId" UUID;

-- CreateTable
CREATE TABLE "PositionCard" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "duties" TEXT NOT NULL DEFAULT '',
    "situations" TEXT NOT NULL DEFAULT '',
    "never" TEXT NOT NULL DEFAULT '',
    "demands" TEXT NOT NULL DEFAULT '',
    "minAge" INTEGER,
    "changedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "rehire" BOOLEAN,
    "note" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaReview" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "understaffed" TEXT NOT NULL DEFAULT '',
    "overstaffed" TEXT NOT NULL DEFAULT '',
    "wentWrong" TEXT NOT NULL DEFAULT '',
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "waiveNote" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AreaReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositionCard_orgId_key_version_key" ON "PositionCard"("orgId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Review_assignmentId_key" ON "Review"("assignmentId");

-- CreateIndex
CREATE INDEX "Review_eventId_idx" ON "Review"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "AreaReview_areaId_key" ON "AreaReview"("areaId");

-- CreateIndex
CREATE INDEX "AreaReview_eventId_idx" ON "AreaReview"("eventId");

-- CreateIndex
CREATE INDEX "Position_cardId_idx" ON "Position"("cardId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PositionCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionCard" ADD CONSTRAINT "PositionCard_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaReview" ADD CONSTRAINT "AreaReview_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaReview" ADD CONSTRAINT "AreaReview_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaReview" ADD CONSTRAINT "AreaReview_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
