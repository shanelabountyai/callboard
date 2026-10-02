-- The live run of show: when a pull was last tried, and what each sync changed. Adds only.
ALTER TABLE "Event" ADD COLUMN "rosTriedAt" TIMESTAMPTZ(6);

CREATE TABLE "RosSync" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "changes" JSONB NOT NULL,

    CONSTRAINT "RosSync_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RosSync_eventId_at_idx" ON "RosSync"("eventId", "at");

ALTER TABLE "RosSync" ADD CONSTRAINT "RosSync_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RosSync" ADD CONSTRAINT "RosSync_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
