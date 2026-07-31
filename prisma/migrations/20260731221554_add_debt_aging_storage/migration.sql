-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "aging_documents_written" INTEGER,
ADD COLUMN     "aging_rows_written" INTEGER,
ADD COLUMN     "aging_skipped_duplicate" INTEGER;

-- CreateTable
CREATE TABLE "debt_aging_summary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_job_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_code" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "bucket_0_30" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_31_60" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_61_90" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_91_120" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_120_plus" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_due" DECIMAL(18,4) NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "line_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_aging_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_aging_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_job_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_code" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "document_number" TEXT,
    "document_date" DATE,
    "document_type" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "bucket_0_30" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_31_60" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_61_90" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_91_120" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bucket_120_plus" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "source_row_number" INTEGER NOT NULL,
    "line_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_aging_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_aging_summary_line_hash_key" ON "debt_aging_summary"("line_hash");

-- CreateIndex
CREATE INDEX "idx_aging_summary_customer" ON "debt_aging_summary"("customer_id", "currency_code");

-- CreateIndex
CREATE INDEX "idx_aging_summary_job" ON "debt_aging_summary"("import_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "debt_aging_details_line_hash_key" ON "debt_aging_details"("line_hash");

-- CreateIndex
CREATE INDEX "idx_aging_details_customer" ON "debt_aging_details"("customer_id", "currency_code");

-- CreateIndex
CREATE INDEX "idx_aging_details_job" ON "debt_aging_details"("import_job_id");

-- AddForeignKey
ALTER TABLE "debt_aging_summary" ADD CONSTRAINT "debt_aging_summary_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_aging_summary" ADD CONSTRAINT "debt_aging_summary_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_aging_summary" ADD CONSTRAINT "debt_aging_summary_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_aging_details" ADD CONSTRAINT "debt_aging_details_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_aging_details" ADD CONSTRAINT "debt_aging_details_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_aging_details" ADD CONSTRAINT "debt_aging_details_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
