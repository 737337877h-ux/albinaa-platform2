CREATE TABLE "branch_receipt_sequences" (
  "branch_id" UUID NOT NULL REFERENCES "branches"("id"),
  "year" INTEGER NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("branch_id", "year")
);

CREATE TABLE "branch_voucher_sequences" (
  "branch_id" UUID NOT NULL REFERENCES "branches"("id"),
  "year" INTEGER NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("branch_id", "year")
);

-- Continue after any receipts already generated with the new canonical pattern.
INSERT INTO "branch_receipt_sequences" ("branch_id", "year", "next_number")
SELECT
  "branch_id",
  substring("receipt_number" from '^R-([0-9]{4})-')::integer,
  max(substring("receipt_number" from '-([0-9]{6})$')::integer) + 1
FROM "collections"
WHERE "branch_id" IS NOT NULL AND "receipt_number" ~ '^R-[0-9]{4}-[0-9]{6}$'
GROUP BY "branch_id", substring("receipt_number" from '^R-([0-9]{4})-')::integer
ON CONFLICT ("branch_id", "year") DO UPDATE
SET "next_number" = GREATEST("branch_receipt_sequences"."next_number", EXCLUDED."next_number");

CREATE TABLE "collection_handover_vouchers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id"),
  "branch_id" UUID NOT NULL REFERENCES "branches"("id"),
  "collector_id" UUID NOT NULL REFERENCES "collectors"("id"),
  "currency_code" TEXT NOT NULL REFERENCES "currencies"("code"),
  "serial_number" TEXT NOT NULL,
  "sequence_year" INTEGER NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "total_amount" NUMERIC(18,4) NOT NULL CHECK ("total_amount" > 0),
  "status" TEXT NOT NULL DEFAULT 'submitted' CHECK ("status" IN ('submitted','matched','locked')),
  "created_by" UUID NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "matched_by" UUID REFERENCES "users"("id"),
  "matched_at" TIMESTAMPTZ,
  "approved_by" UUID REFERENCES "users"("id"),
  "approved_at" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_handover_voucher_org_serial" ON "collection_handover_vouchers"("organization_id", "serial_number");
CREATE UNIQUE INDEX "uq_handover_voucher_branch_sequence" ON "collection_handover_vouchers"("branch_id", "sequence_year", "sequence_number");
CREATE INDEX "idx_handover_voucher_status" ON "collection_handover_vouchers"("organization_id", "status", "created_at");

CREATE TABLE "collection_handover_items" (
  "voucher_id" UUID NOT NULL REFERENCES "collection_handover_vouchers"("id"),
  "collection_id" UUID NOT NULL REFERENCES "collections"("id"),
  "amount" NUMERIC(18,4) NOT NULL CHECK ("amount" > 0),
  PRIMARY KEY ("voucher_id", "collection_id"),
  CONSTRAINT "uq_handover_item_collection" UNIQUE ("collection_id")
);

CREATE TABLE "collection_reversal_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "collection_id" UUID NOT NULL REFERENCES "collections"("id"),
  "reason" TEXT NOT NULL CHECK (length(btrim("reason")) >= 3),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected')),
  "requested_by" UUID NOT NULL REFERENCES "users"("id"),
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewed_by" UUID REFERENCES "users"("id"),
  "reviewed_at" TIMESTAMPTZ,
  "review_note" TEXT,
  "reversal_id" UUID,
  CHECK ("reviewed_by" IS NULL OR "reviewed_by" <> "requested_by")
);
CREATE INDEX "idx_collection_reversal_request" ON "collection_reversal_requests"("collection_id", "status");
CREATE INDEX "idx_collection_reversal_pending" ON "collection_reversal_requests"("status", "requested_at");
CREATE UNIQUE INDEX "uq_collection_reversal_pending" ON "collection_reversal_requests"("collection_id") WHERE "status" = 'pending';

CREATE UNIQUE INDEX "uq_collections_branch_receipt"
  ON "collections"("branch_id", "receipt_number")
  WHERE "branch_id" IS NOT NULL AND "receipt_number" IS NOT NULL AND "status" <> 'reversed';
