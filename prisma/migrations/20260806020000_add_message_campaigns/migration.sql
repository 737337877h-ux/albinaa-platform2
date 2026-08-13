CREATE TABLE "message_campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "aging_bucket" TEXT NOT NULL,
  "currency_code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "provider" TEXT NOT NULL DEFAULT 'none',
  "total_count" INTEGER NOT NULL DEFAULT 0,
  "ready_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "message_dispatches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "destination" TEXT,
  "rendered_message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "error_message" TEXT,
  "provider_message_id" TEXT,
  "sent_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_dispatches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "message_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_dispatches_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_message_campaigns_org_created" ON "message_campaigns"("organization_id", "created_at");
CREATE UNIQUE INDEX "uq_message_dispatch_campaign_customer" ON "message_dispatches"("campaign_id", "customer_id");
CREATE INDEX "idx_message_dispatch_customer_created" ON "message_dispatches"("customer_id", "created_at");
