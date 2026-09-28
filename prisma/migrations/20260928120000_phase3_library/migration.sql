-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "playbookId" UUID;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "attendanceBand" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "breaks" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "helpStepMin" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minors" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "moves" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nudgeDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "overbookPct" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "stepMin" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "templateId" UUID,
ADD COLUMN     "thanks" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "wantsBackAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "Playbook" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "staffing" TEXT NOT NULL DEFAULT '',
    "callOffsetMin" INTEGER,
    "breakPlan" TEXT NOT NULL DEFAULT '',
    "floatPlan" TEXT NOT NULL DEFAULT '',
    "equipment" TEXT NOT NULL DEFAULT '',
    "setup" TEXT NOT NULL DEFAULT '',
    "close" TEXT NOT NULL DEFAULT '',
    "failurePoints" TEXT NOT NULL DEFAULT '',
    "changedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgRules" (
    "orgId" UUID NOT NULL,
    "graceMin" INTEGER NOT NULL DEFAULT 15,
    "callOffsetMin" INTEGER NOT NULL DEFAULT 45,
    "overbookPct" INTEGER NOT NULL DEFAULT 20,
    "stepMin" INTEGER NOT NULL DEFAULT 10,
    "helpStepMin" INTEGER NOT NULL DEFAULT 5,
    "nudgeDays" INTEGER NOT NULL DEFAULT 7,
    "breaks" TEXT NOT NULL DEFAULT '',
    "minors" TEXT NOT NULL DEFAULT '',
    "moves" TEXT NOT NULL DEFAULT '',
    "thanks" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OrgRules_pkey" PRIMARY KEY ("orgId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Playbook_orgId_key_version_key" ON "Playbook"("orgId", "key", "version");

-- CreateIndex
CREATE INDEX "Area_playbookId_idx" ON "Area"("playbookId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRules" ADD CONSTRAINT "OrgRules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

