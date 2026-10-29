ALTER TABLE "collectors"
ADD COLUMN "oracle_collector_no" SMALLINT;

UPDATE "collectors" AS collector
SET "oracle_collector_no" = CASE app_user."username"
  WHEN 'admin3' THEN 1
  WHEN 'admin2' THEN 2
  WHEN 'admin4' THEN 3
  WHEN 'admin6' THEN 4
  WHEN 'admin5' THEN 5
  WHEN 'admin' THEN 6
END
FROM "users" AS app_user
WHERE app_user."id" = collector."user_id"
  AND app_user."username" IN ('admin3', 'admin2', 'admin4', 'admin6', 'admin5', 'admin');

CREATE UNIQUE INDEX "uq_collectors_oracle_collector_no"
ON "collectors"("oracle_collector_no");

ALTER TABLE "collectors"
ADD CONSTRAINT "collectors_oracle_collector_no_positive"
CHECK ("oracle_collector_no" IS NULL OR "oracle_collector_no" > 0);
