ALTER TABLE "customer_aliases" DROP CONSTRAINT IF EXISTS "customer_aliases_source_customer_id_fkey";
DROP INDEX IF EXISTS "uq_customer_alias_org_customer_type_value";
CREATE UNIQUE INDEX "uq_customer_alias_org_type_value"
  ON "customer_aliases"("organization_id", "alias_type", "alias_normalized");
