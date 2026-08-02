-- CreateTable
CREATE TABLE "analytical_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "person_name" TEXT,
    "employee_number" TEXT,
    "currency_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytical_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytical_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL,
    "tx_date" DATE NOT NULL,
    "document_type" TEXT,
    "document_number" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "source_import_job_id" UUID,
    "source_row_number" INTEGER,
    "line_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytical_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_analytical_accounts_category" ON "analytical_accounts"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "uq_analytical_account_org_number_ccy" ON "analytical_accounts"("organization_id", "account_number", "currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "analytical_movements_line_hash_key" ON "analytical_movements"("line_hash");

-- CreateIndex
CREATE INDEX "idx_analytical_movements_account" ON "analytical_movements"("account_id", "currency_code", "tx_date");

-- AddForeignKey
ALTER TABLE "analytical_accounts" ADD CONSTRAINT "analytical_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytical_accounts" ADD CONSTRAINT "analytical_accounts_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytical_accounts" ADD CONSTRAINT "analytical_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytical_movements" ADD CONSTRAINT "analytical_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "analytical_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytical_movements" ADD CONSTRAINT "analytical_movements_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytical_movements" ADD CONSTRAINT "analytical_movements_source_import_job_id_fkey" FOREIGN KEY ("source_import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
