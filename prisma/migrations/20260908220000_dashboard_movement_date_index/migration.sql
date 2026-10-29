-- Concurrent build allows existing platform imports and requests to continue.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_oracle_customer_movements_created"
ON "oracle_customer_movements_mirror" ("organization_id", "source_created_at");
