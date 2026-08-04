DROP INDEX "uq_customer_alias_org_type_value";

CREATE UNIQUE INDEX "uq_customer_alias_org_customer_type_value"
  ON "customer_aliases"("organization_id", "customer_id", "alias_type", "alias_normalized");

ALTER TABLE "customer_aliases"
  ADD CONSTRAINT "customer_aliases_source_customer_id_fkey"
  FOREIGN KEY ("source_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
