-- The live run of show: the sheet's link and when it was last pulled. Adds only.
ALTER TABLE "Event" ADD COLUMN "rosSyncedAt" TIMESTAMPTZ(6),
ADD COLUMN "rosUrl" TEXT NOT NULL DEFAULT '';
