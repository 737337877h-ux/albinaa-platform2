DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "customer_merges") THEN
    RAISE EXCEPTION 'Cannot roll back customer merge schema after merge operations exist. Restore the pre-migration backup instead.';
  END IF;
END $$;

DELETE FROM "role_permissions" WHERE "permission_id" = (SELECT "id" FROM "permissions" WHERE "code" = 'duplicates.merge');
DELETE FROM "permissions" WHERE "code" = 'duplicates.merge';
ALTER TABLE "operational_ledger" DROP CONSTRAINT IF EXISTS "chk_ledger_type";
ALTER TABLE "operational_ledger" ADD CONSTRAINT "chk_ledger_type" CHECK (
  "entry_type" IN ('collection', 'collection_reversal', 'manual_adjustment_documented')
);
DROP TABLE IF EXISTS "customer_aliases";
DROP TABLE IF EXISTS "customer_merges";
DROP INDEX IF EXISTS "idx_customers_merged_into";
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_merged_into_id_fkey";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "merged_at", DROP COLUMN IF EXISTS "merged_into_id";
