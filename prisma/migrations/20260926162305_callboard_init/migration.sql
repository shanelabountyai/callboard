-- CreateEnum
CREATE TYPE "PersonKind" AS ENUM ('employee', 'volunteer');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'staffing', 'confirmed', 'live', 'closed');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('invited', 'confirmed', 'declined', 'released');

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "kind" "PersonKind" NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "callOffsetMin" INTEGER NOT NULL DEFAULT 45,
    "graceMin" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDay" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "EventDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aor" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#4f46e5',
    "radioChannel" TEXT NOT NULL DEFAULT '',
    "leadId" UUID,
    "deputyId" UUID,

    CONSTRAINT "Aor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "aorId" UUID,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minHeadcount" INTEGER NOT NULL DEFAULT 1,
    "targetHeadcount" INTEGER NOT NULL DEFAULT 1,
    "uniform" TEXT NOT NULL DEFAULT '',
    "brief" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "callAt" TIMESTAMPTZ(6) NOT NULL,
    "startAt" TIMESTAMPTZ(6) NOT NULL,
    "endAt" TIMESTAMPTZ(6) NOT NULL,
    "needed" INTEGER NOT NULL,
    "overbookPct" INTEGER NOT NULL DEFAULT 20,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'invited',
    "respondedAt" TIMESTAMPTZ(6),
    "declineReason" TEXT NOT NULL DEFAULT '',
    "t7SentAt" TIMESTAMPTZ(6),
    "t1SentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonLink" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunOfShowRow" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "cue" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "RunOfShowRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Person_orgId_name_idx" ON "Person"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Person_orgId_mobile_key" ON "Person"("orgId", "mobile");

-- CreateIndex
CREATE INDEX "Event_orgId_createdAt_idx" ON "Event"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventDay_eventId_date_key" ON "EventDay"("eventId", "date");

-- CreateIndex
CREATE INDEX "Aor_eventId_idx" ON "Aor"("eventId");

-- CreateIndex
CREATE INDEX "Area_eventId_idx" ON "Area"("eventId");

-- CreateIndex
CREATE INDEX "Position_areaId_idx" ON "Position"("areaId");

-- CreateIndex
CREATE INDEX "Shift_eventId_dayId_idx" ON "Shift"("eventId", "dayId");

-- CreateIndex
CREATE INDEX "Shift_positionId_idx" ON "Shift"("positionId");

-- CreateIndex
CREATE INDEX "Assignment_personId_idx" ON "Assignment"("personId");

-- CreateIndex
CREATE INDEX "Assignment_eventId_status_idx" ON "Assignment"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_shiftId_personId_key" ON "Assignment"("shiftId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonLink_tokenHash_key" ON "PersonLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PersonLink_eventId_personId_key" ON "PersonLink"("eventId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "RunOfShowRow_eventId_sourceKey_key" ON "RunOfShowRow"("eventId", "sourceKey");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDay" ADD CONSTRAINT "EventDay_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDay" ADD CONSTRAINT "EventDay_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aor" ADD CONSTRAINT "Aor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aor" ADD CONSTRAINT "Aor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aor" ADD CONSTRAINT "Aor_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aor" ADD CONSTRAINT "Aor_deputyId_fkey" FOREIGN KEY ("deputyId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_aorId_fkey" FOREIGN KEY ("aorId") REFERENCES "Aor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonLink" ADD CONSTRAINT "PersonLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonLink" ADD CONSTRAINT "PersonLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonLink" ADD CONSTRAINT "PersonLink_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunOfShowRow" ADD CONSTRAINT "RunOfShowRow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunOfShowRow" ADD CONSTRAINT "RunOfShowRow_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
