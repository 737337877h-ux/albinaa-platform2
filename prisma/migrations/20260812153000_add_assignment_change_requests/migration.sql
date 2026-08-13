CREATE TABLE "assignment_change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "current_collector_id" UUID,
  "requested_collector_id" UUID,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "review_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ,
  CONSTRAINT "assignment_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assignment_change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assignment_change_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assignment_change_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assignment_change_requests_current_collector_id_fkey" FOREIGN KEY ("current_collector_id") REFERENCES "collectors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assignment_change_requests_requested_collector_id_fkey" FOREIGN KEY ("requested_collector_id") REFERENCES "collectors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assignment_change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assignment_change_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX "idx_assignment_change_requests_status"
  ON "assignment_change_requests"("organization_id", "status", "created_at");
CREATE INDEX "idx_assignment_change_requests_customer"
  ON "assignment_change_requests"("customer_id", "status");
CREATE UNIQUE INDEX "uq_assignment_change_requests_pending_customer"
  ON "assignment_change_requests"("customer_id") WHERE "status" = 'pending';

-- مالك المنتج اعتمد عرض الطلبات ومعالجتها لمدير النظام ومدير المديونية والمحاسب.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'customers.transfer'
WHERE r."name" IN ('مدير النظام', 'مدير المديونية', 'المحاسب')
ON CONFLICT DO NOTHING;
