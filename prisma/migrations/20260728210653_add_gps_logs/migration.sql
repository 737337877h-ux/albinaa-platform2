-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_uploaded_by_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_replaced_by_id_fkey";

-- DropForeignKey
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "balance_reconciliations" DROP CONSTRAINT "balance_reconciliations_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "balance_reconciliations" DROP CONSTRAINT "balance_reconciliations_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "balance_reconciliations" DROP CONSTRAINT "balance_reconciliations_import_job_id_fkey";

-- DropForeignKey
ALTER TABLE "balance_reconciliations" DROP CONSTRAINT "balance_reconciliations_reviewed_by_fkey";

-- DropForeignKey
ALTER TABLE "balance_snapshots" DROP CONSTRAINT "balance_snapshots_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "balance_snapshots" DROP CONSTRAINT "balance_snapshots_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "balance_snapshots" DROP CONSTRAINT "balance_snapshots_import_job_id_fkey";

-- DropForeignKey
ALTER TABLE "branches" DROP CONSTRAINT "branches_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_handover" DROP CONSTRAINT "cash_handover_cashier_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_handover" DROP CONSTRAINT "cash_handover_collection_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_handover" DROP CONSTRAINT "cash_handover_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "collection_methods" DROP CONSTRAINT "collection_methods_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "collections" DROP CONSTRAINT "collections_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "collections" DROP CONSTRAINT "collections_collector_id_fkey";

-- DropForeignKey
ALTER TABLE "collections" DROP CONSTRAINT "collections_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "collections" DROP CONSTRAINT "collections_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "collections" DROP CONSTRAINT "collections_method_id_fkey";

-- DropForeignKey
ALTER TABLE "collections" DROP CONSTRAINT "collections_reversed_by_id_fkey";

-- DropForeignKey
ALTER TABLE "collectors" DROP CONSTRAINT "collectors_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "collectors" DROP CONSTRAINT "collectors_user_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_assignments" DROP CONSTRAINT "customer_assignments_assigned_by_fkey";

-- DropForeignKey
ALTER TABLE "customer_assignments" DROP CONSTRAINT "customer_assignments_collector_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_assignments" DROP CONSTRAINT "customer_assignments_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_balances" DROP CONSTRAINT "customer_balances_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "customer_balances" DROP CONSTRAINT "customer_balances_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_balances" DROP CONSTRAINT "customer_balances_last_import_job_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_credit_policies" DROP CONSTRAINT "customer_credit_policies_credit_limit_currency_fkey";

-- DropForeignKey
ALTER TABLE "customer_credit_policies" DROP CONSTRAINT "customer_credit_policies_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_credit_policies" DROP CONSTRAINT "customer_credit_policies_decided_by_fkey";

-- DropForeignKey
ALTER TABLE "customer_scores" DROP CONSTRAINT "customer_scores_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "document_types" DROP CONSTRAINT "document_types_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "followup_results" DROP CONSTRAINT "followup_results_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "followup_types" DROP CONSTRAINT "followup_types_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_deleted_by_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_expected_currency_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_result_id_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_type_id_fkey";

-- DropForeignKey
ALTER TABLE "followups" DROP CONSTRAINT "followups_user_id_fkey";

-- DropForeignKey
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_template_id_fkey";

-- DropForeignKey
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_uploaded_by_fkey";

-- DropForeignKey
ALTER TABLE "import_templates" DROP CONSTRAINT "import_templates_created_by_fkey";

-- DropForeignKey
ALTER TABLE "import_templates" DROP CONSTRAINT "import_templates_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "imported_transactions" DROP CONSTRAINT "imported_transactions_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "imported_transactions" DROP CONSTRAINT "imported_transactions_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "imported_transactions" DROP CONSTRAINT "imported_transactions_document_type_id_fkey";

-- DropForeignKey
ALTER TABLE "imported_transactions" DROP CONSTRAINT "imported_transactions_import_job_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "operational_ledger" DROP CONSTRAINT "operational_ledger_created_by_fkey";

-- DropForeignKey
ALTER TABLE "operational_ledger" DROP CONSTRAINT "operational_ledger_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "operational_ledger" DROP CONSTRAINT "operational_ledger_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_promises" DROP CONSTRAINT "payment_promises_collector_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_promises" DROP CONSTRAINT "payment_promises_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "payment_promises" DROP CONSTRAINT "payment_promises_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_promises" DROP CONSTRAINT "payment_promises_expected_method_id_fkey";

-- DropForeignKey
ALTER TABLE "potential_duplicate_customers" DROP CONSTRAINT "potential_duplicate_customers_customer_a_id_fkey";

-- DropForeignKey
ALTER TABLE "potential_duplicate_customers" DROP CONSTRAINT "potential_duplicate_customers_customer_b_id_fkey";

-- DropForeignKey
ALTER TABLE "potential_duplicate_customers" DROP CONSTRAINT "potential_duplicate_customers_reviewed_by_fkey";

-- DropForeignKey
ALTER TABLE "reservation_items" DROP CONSTRAINT "reservation_items_reservation_id_fkey";

-- DropForeignKey
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_role_id_fkey";

-- DropForeignKey
ALTER TABLE "roles" DROP CONSTRAINT "roles_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "system_settings" DROP CONSTRAINT "system_settings_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assigned_to_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_created_by_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_expected_currency_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_source_promise_id_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_granted_by_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_role_id_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_fkey";

-- CreateTable
CREATE TABLE "gps_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "entity_table" TEXT,
    "entity_id" UUID,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gps_logs_entity_table_entity_id_idx" ON "gps_logs"("entity_table", "entity_id");

-- CreateIndex
CREATE INDEX "gps_logs_user_id_timestamp_idx" ON "gps_logs"("user_id", "timestamp");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assignments" ADD CONSTRAINT "customer_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assignments" ADD CONSTRAINT "customer_assignments_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assignments" ADD CONSTRAINT "customer_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_policies" ADD CONSTRAINT "customer_credit_policies_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_policies" ADD CONSTRAINT "customer_credit_policies_credit_limit_currency_fkey" FOREIGN KEY ("credit_limit_currency") REFERENCES "currencies"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_policies" ADD CONSTRAINT "customer_credit_policies_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_duplicate_customers" ADD CONSTRAINT "potential_duplicate_customers_customer_a_id_fkey" FOREIGN KEY ("customer_a_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_duplicate_customers" ADD CONSTRAINT "potential_duplicate_customers_customer_b_id_fkey" FOREIGN KEY ("customer_b_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_duplicate_customers" ADD CONSTRAINT "potential_duplicate_customers_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "import_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_balances" ADD CONSTRAINT "customer_balances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_balances" ADD CONSTRAINT "customer_balances_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_balances" ADD CONSTRAINT "customer_balances_last_import_job_id_fkey" FOREIGN KEY ("last_import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_ledger" ADD CONSTRAINT "operational_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_ledger" ADD CONSTRAINT "operational_ledger_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_ledger" ADD CONSTRAINT "operational_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_reconciliations" ADD CONSTRAINT "balance_reconciliations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_reconciliations" ADD CONSTRAINT "balance_reconciliations_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_reconciliations" ADD CONSTRAINT "balance_reconciliations_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_reconciliations" ADD CONSTRAINT "balance_reconciliations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_methods" ADD CONSTRAINT "collection_methods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_method_id_fkey" FOREIGN KEY ("method_id") REFERENCES "collection_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handover" ADD CONSTRAINT "cash_handover_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handover" ADD CONSTRAINT "cash_handover_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handover" ADD CONSTRAINT "cash_handover_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_types" ADD CONSTRAINT "followup_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_results" ADD CONSTRAINT "followup_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "followup_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "followup_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_expected_currency_fkey" FOREIGN KEY ("expected_currency") REFERENCES "currencies"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_promises" ADD CONSTRAINT "payment_promises_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_promises" ADD CONSTRAINT "payment_promises_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_promises" ADD CONSTRAINT "payment_promises_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_promises" ADD CONSTRAINT "payment_promises_expected_method_id_fkey" FOREIGN KEY ("expected_method_id") REFERENCES "collection_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "collectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_expected_currency_fkey" FOREIGN KEY ("expected_currency") REFERENCES "currencies"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_promise_id_fkey" FOREIGN KEY ("source_promise_id") REFERENCES "payment_promises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_scores" ADD CONSTRAINT "customer_scores_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_logs" ADD CONSTRAINT "gps_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
