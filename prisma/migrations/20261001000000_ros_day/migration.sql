-- A multi-day run of show: the sheet's Day or Date column, as written. Adds only.
ALTER TABLE "RunOfShowRow" ADD COLUMN "day" TEXT NOT NULL DEFAULT '';
