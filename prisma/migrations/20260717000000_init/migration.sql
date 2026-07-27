-- ============================================================================
-- Migration: 20260717000000_init
-- منصة البناء الراقي — النواة التشغيلية (Sprint 1)
-- المخطط المعتمد في مرحلة التحقق والتصميم v2 كاملاً:
-- 36 جدولاً + القيود + الفهارس + Triggers الحماية + View الرصيد التشغيلي
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) الهيكل التنظيمي
-- ----------------------------------------------------------------------------
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_branches_org_name UNIQUE (organization_id, name)
);

-- ----------------------------------------------------------------------------
-- 2) المستخدمون والأدوار والصلاحيات (RBAC)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id       UUID REFERENCES branches(id),
    username        TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    password_hash   TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_org_username UNIQUE (organization_id, username)
);

CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_roles_org_name UNIQUE (organization_id, name)
);

CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    description_ar  TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by      UUID REFERENCES users(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE collectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id),
    branch_id       UUID REFERENCES branches(id),
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 3) البيانات المرجعية: العملات وأنواع المستندات
-- ----------------------------------------------------------------------------
CREATE TABLE currencies (
    code            TEXT PRIMARY KEY,
    source_code     TEXT NOT NULL,
    name_ar         TEXT NOT NULL,
    decimals        SMALLINT NOT NULL DEFAULT 2,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE document_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    effect          TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    notes           TEXT,
    CONSTRAINT uq_doctypes_org_name UNIQUE (organization_id, name),
    CONSTRAINT chk_doctypes_effect CHECK (effect IN ('debit','credit','mixed'))
);

-- ----------------------------------------------------------------------------
-- 4) العملاء
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organizations(id),
    branch_id               UUID REFERENCES branches(id),
    external_customer_code  TEXT NOT NULL,
    account_number          TEXT,
    name                    TEXT NOT NULL,
    name_normalized         TEXT NOT NULL,
    trade_name              TEXT,
    phone_primary           TEXT,
    phone_secondary         TEXT,
    whatsapp                TEXT,
    region                  TEXT,
    address                 TEXT,
    geo_lat                 NUMERIC(9,6),
    geo_lng                 NUMERIC(9,6),
    customer_type           TEXT,
    status                  TEXT NOT NULL DEFAULT 'active',
    relationship_start_date DATE,
    notes                   TEXT,
    created_by_import_job   UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_customers_org_code UNIQUE (organization_id, external_customer_code)
);
CREATE INDEX idx_customers_name_norm ON customers (organization_id, name_normalized);
CREATE INDEX idx_customers_phone ON customers (phone_primary);

CREATE TABLE customer_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id),
    collector_id    UUID NOT NULL REFERENCES collectors(id),
    effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to    DATE,
    reason          TEXT,
    assigned_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_current_assignment ON customer_assignments (customer_id)
    WHERE effective_to IS NULL;
CREATE INDEX idx_assignments_collector ON customer_assignments (collector_id)
    WHERE effective_to IS NULL;

CREATE TABLE customer_credit_policies (
    customer_id                 UUID PRIMARY KEY REFERENCES customers(id),
    allow_credit_sale           BOOLEAN NOT NULL DEFAULT FALSE,
    allow_purchase_with_debt    BOOLEAN NOT NULL DEFAULT FALSE,
    default_payment_days        INT,
    credit_limit_amount         NUMERIC(18,4),
    credit_limit_currency       TEXT REFERENCES currencies(code),
    credit_status               TEXT NOT NULL DEFAULT 'open',
    restriction_reason          TEXT,
    decided_by                  UUID REFERENCES users(id),
    decided_at                  TIMESTAMPTZ,
    CONSTRAINT chk_credit_status CHECK (credit_status IN ('open','restricted','suspended'))
);

CREATE TABLE potential_duplicate_customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_a_id   UUID NOT NULL REFERENCES customers(id),
    customer_b_id   UUID NOT NULL REFERENCES customers(id),
    match_reason    TEXT NOT NULL,
    review_status   TEXT NOT NULL DEFAULT 'pending',
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    CONSTRAINT uq_dup_pair UNIQUE (customer_a_id, customer_b_id),
    CONSTRAINT chk_dup_not_self CHECK (customer_a_id <> customer_b_id),
    CONSTRAINT chk_dup_status CHECK (review_status IN ('pending','merged','rejected_intentional'))
);

-- ----------------------------------------------------------------------------
-- 5) الاستيراد والأرصدة المحاسبية
-- ----------------------------------------------------------------------------
CREATE TABLE import_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    column_mapping  JSONB NOT NULL,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE import_jobs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organizations(id),
    template_id             UUID REFERENCES import_templates(id),
    file_name               TEXT NOT NULL,
    file_hash               TEXT NOT NULL,
    uploaded_by             UUID NOT NULL REFERENCES users(id),
    imported_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                  TEXT NOT NULL DEFAULT 'completed',
    rows_total              INT,
    txns_in_file            INT,
    customers_new           INT,
    customers_updated       INT,
    txns_inserted           INT,
    txns_skipped_duplicate  INT,
    errors_count            INT,
    total_balance_before    JSONB,
    total_balance_after     JSONB,
    error_report            JSONB,
    CONSTRAINT chk_import_status CHECK (status IN ('dry_run','running','completed','failed'))
);
CREATE INDEX idx_import_jobs_hash ON import_jobs (organization_id, file_hash);

CREATE TABLE imported_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    currency_code       TEXT NOT NULL REFERENCES currencies(code),
    document_type_id    UUID NOT NULL REFERENCES document_types(id),
    tx_date             DATE NOT NULL,
    document_number     TEXT,
    description         TEXT,
    reference_number    TEXT,
    debit               NUMERIC(18,4) NOT NULL DEFAULT 0,
    credit              NUMERIC(18,4) NOT NULL DEFAULT 0,
    line_hash           TEXT NOT NULL UNIQUE,
    source_row_number   INT,
    import_job_id       UUID NOT NULL REFERENCES import_jobs(id),
    CONSTRAINT chk_itxn_nonneg CHECK (debit >= 0 AND credit >= 0),
    CONSTRAINT chk_itxn_single_side CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_itxn_customer ON imported_transactions (customer_id, currency_code, tx_date);
CREATE INDEX idx_itxn_job ON imported_transactions (import_job_id);

CREATE TABLE customer_balances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    currency_code       TEXT NOT NULL REFERENCES currencies(code),
    opening_debit       NUMERIC(18,4) NOT NULL DEFAULT 0,
    opening_credit      NUMERIC(18,4) NOT NULL DEFAULT 0,
    accounting_balance  NUMERIC(18,4) NOT NULL DEFAULT 0,
    declared_balance    NUMERIC(18,4),
    declared_label      TEXT,
    last_import_job_id  UUID REFERENCES import_jobs(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_balance_customer_currency UNIQUE (customer_id, currency_code)
);

CREATE TABLE balance_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id),
    currency_code   TEXT NOT NULL REFERENCES currencies(code),
    balance         NUMERIC(18,4) NOT NULL,
    import_job_id   UUID NOT NULL REFERENCES import_jobs(id),
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_snapshots ON balance_snapshots (customer_id, currency_code, snapshot_at);

-- ----------------------------------------------------------------------------
-- 6) الدفتر التشغيلي (Append-Only) — مصدر الرصيد التشغيلي الوحيد
-- ----------------------------------------------------------------------------
CREATE TABLE operational_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id),
    currency_code   TEXT NOT NULL REFERENCES currencies(code),
    entry_type      TEXT NOT NULL,
    amount_signed   NUMERIC(18,4) NOT NULL,
    source_table    TEXT NOT NULL,
    source_id       UUID NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ledger_source UNIQUE (source_table, source_id, entry_type),
    CONSTRAINT chk_ledger_type CHECK (entry_type IN
        ('collection','collection_reversal','manual_adjustment_documented'))
);
CREATE INDEX idx_ledger_customer ON operational_ledger (customer_id, currency_code, created_at);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'هذا الجدول Append-Only — التصحيح بقيد عكسي موثق فقط، لا تعديل ولا حذف';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_immutable
    BEFORE UPDATE OR DELETE ON operational_ledger
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ----------------------------------------------------------------------------
-- 7) التسوية بين الرصيد المحاسبي والتشغيلي
-- ----------------------------------------------------------------------------
CREATE TABLE balance_reconciliations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    currency_code       TEXT NOT NULL REFERENCES currencies(code),
    import_job_id       UUID NOT NULL REFERENCES import_jobs(id),
    accounting_balance  NUMERIC(18,4) NOT NULL,
    operational_balance NUMERIC(18,4) NOT NULL,
    difference          NUMERIC(18,4) NOT NULL,
    review_status       TEXT NOT NULL DEFAULT 'pending',
    difference_reason   TEXT,
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_recon UNIQUE (customer_id, currency_code, import_job_id),
    CONSTRAINT chk_recon_status CHECK (review_status IN ('pending','approved','explained'))
);

-- ----------------------------------------------------------------------------
-- 8) العمليات التشغيلية (كلها متعددة العملات)
-- ----------------------------------------------------------------------------
CREATE TABLE collection_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_methods_org_name UNIQUE (organization_id, name)
);

CREATE TABLE collections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    collector_id        UUID NOT NULL REFERENCES collectors(id),
    currency_code       TEXT NOT NULL REFERENCES currencies(code),
    amount              NUMERIC(18,4) NOT NULL,
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    method_id           UUID NOT NULL REFERENCES collection_methods(id),
    reference_number    TEXT,
    bank_name           TEXT,
    cheque_number       TEXT,
    cheque_date         DATE,
    receipt_number      TEXT,
    notes               TEXT,
    status              TEXT NOT NULL DEFAULT 'recorded',
    reversed_by_id      UUID REFERENCES collections(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_collection_amount CHECK (amount > 0),
    CONSTRAINT chk_collection_status CHECK (status IN
        ('recorded','handed_to_cashier','matched','approved','reversed'))
);
CREATE INDEX idx_collections_customer ON collections (customer_id, currency_code, collected_at);
CREATE INDEX idx_collections_collector ON collections (collector_id, collected_at);

CREATE TRIGGER trg_collections_no_delete
    BEFORE DELETE ON collections
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE cash_handover (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id   UUID NOT NULL UNIQUE REFERENCES collections(id),
    currency_code   TEXT NOT NULL REFERENCES currencies(code),
    amount          NUMERIC(18,4) NOT NULL,
    cashier_id      UUID NOT NULL REFERENCES users(id),
    receipt_number  TEXT,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE followup_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_ftypes_org_name UNIQUE (organization_id, name)
);

CREATE TABLE followup_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name            TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_fresults_org_name UNIQUE (organization_id, name)
);

CREATE TABLE followups (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    type_id             UUID NOT NULL REFERENCES followup_types(id),
    result_id           UUID NOT NULL REFERENCES followup_results(id),
    followup_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes               TEXT,
    next_followup_date  DATE,
    expected_amount     NUMERIC(18,4),
    expected_currency   TEXT REFERENCES currencies(code),
    visit_lat           NUMERIC(9,6),
    visit_lng           NUMERIC(9,6),
    CONSTRAINT chk_followup_amount_currency CHECK
        (expected_amount IS NULL OR expected_currency IS NOT NULL)
);
CREATE INDEX idx_followups_customer ON followups (customer_id, followup_at);
CREATE INDEX idx_followups_next ON followups (next_followup_date);

CREATE TABLE payment_promises (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    collector_id        UUID NOT NULL REFERENCES collectors(id),
    promise_date        DATE NOT NULL,
    expected_amount     NUMERIC(18,4) NOT NULL,
    currency_code       TEXT NOT NULL REFERENCES currencies(code),
    expected_method_id  UUID REFERENCES collection_methods(id),
    notes               TEXT,
    status              TEXT NOT NULL DEFAULT 'upcoming',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_promise_amount CHECK (expected_amount > 0),
    CONSTRAINT chk_promise_status CHECK (status IN
        ('upcoming','due_today','fulfilled','partially_fulfilled',
         'unfulfilled','postponed','cancelled_approved'))
);
CREATE INDEX idx_promises_date ON payment_promises (promise_date, status);

CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID REFERENCES customers(id),
    assigned_to         UUID REFERENCES collectors(id),
    created_by          UUID REFERENCES users(id),
    task_type           TEXT NOT NULL,
    due_date            DATE NOT NULL,
    priority_reason     TEXT,
    expected_amount     NUMERIC(18,4),
    expected_currency   TEXT REFERENCES currencies(code),
    status              TEXT NOT NULL DEFAULT 'open',
    source_promise_id   UUID REFERENCES payment_promises(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_task_status CHECK (status IN ('open','done','escalated','cancelled')),
    CONSTRAINT chk_task_amount_currency CHECK
        (expected_amount IS NULL OR expected_currency IS NOT NULL)
);
CREATE INDEX idx_tasks_due ON tasks (assigned_to, due_date, status);

-- ----------------------------------------------------------------------------
-- 9) الحجوزات (العملاء الدائنون)
-- ----------------------------------------------------------------------------
CREATE TABLE reservations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    currency_code       TEXT NOT NULL REFERENCES currencies(code),
    credit_amount       NUMERIC(18,4) NOT NULL,
    used_amount         NUMERIC(18,4) NOT NULL DEFAULT 0,
    payment_date        DATE,
    document_number     TEXT,
    warehouse           TEXT,
    reserved_at         DATE NOT NULL DEFAULT CURRENT_DATE,
    expires_at          DATE,
    status              TEXT NOT NULL DEFAULT 'active',
    notes               TEXT,
    CONSTRAINT chk_res_amount CHECK (credit_amount > 0),
    CONSTRAINT chk_res_used CHECK (used_amount >= 0 AND used_amount <= credit_amount),
    CONSTRAINT chk_res_status CHECK (status IN
        ('active','partially_received','fully_received','expired','cancelled','refunded'))
);

CREATE TABLE reservation_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id  UUID NOT NULL REFERENCES reservations(id),
    item_name       TEXT NOT NULL,
    quantity        NUMERIC(18,4) NOT NULL,
    unit            TEXT NOT NULL,
    received_qty    NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 10) التقييم، المرفقات، الإشعارات، التدقيق، الإعدادات
-- ----------------------------------------------------------------------------
CREATE TABLE customer_scores (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    score       NUMERIC(6,2) NOT NULL,
    risk_level  TEXT NOT NULL,
    reasons     JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_risk_level CHECK (risk_level IN ('low','medium','high','critical'))
);
CREATE INDEX idx_scores_customer ON customer_scores (customer_id, computed_at);

CREATE TABLE attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_table TEXT NOT NULL,
    entity_id    UUID NOT NULL,
    file_name    TEXT NOT NULL,
    storage_key  TEXT NOT NULL,
    uploaded_by  UUID REFERENCES users(id),
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_entity ON attachments (entity_table, entity_id);

CREATE TABLE notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    kind       TEXT NOT NULL,
    payload    JSONB NOT NULL,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at);

CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id),
    action       TEXT NOT NULL,
    entity_table TEXT NOT NULL,
    entity_id    UUID,
    old_value    JSONB,
    new_value    JSONB,
    reason       TEXT,
    ip_address   INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs (entity_table, entity_id, created_at);
CREATE INDEX idx_audit_user ON audit_logs (user_id, created_at);

CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE system_settings (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    key             TEXT NOT NULL,
    value           JSONB NOT NULL,
    PRIMARY KEY (organization_id, key)
);

-- ----------------------------------------------------------------------------
-- 11) الرصيد التشغيلي: Materialized View قابلة لإعادة البناء بالكامل
--     (operational_balance ليس عمودًا يُعدّل يدويًا — يُشتق من الدفتر فقط)
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW operational_balances AS
SELECT
    b.customer_id,
    b.currency_code,
    b.accounting_balance
      + COALESCE((
            SELECT SUM(l.amount_signed)
            FROM operational_ledger l
            JOIN import_jobs j ON j.id = b.last_import_job_id
            WHERE l.customer_id  = b.customer_id
              AND l.currency_code = b.currency_code
              AND l.created_at   > j.imported_at
        ), 0) AS operational_balance,
    now() AS refreshed_at
FROM customer_balances b;

CREATE UNIQUE INDEX uq_opbal ON operational_balances (customer_id, currency_code);
-- التحديث: REFRESH MATERIALIZED VIEW CONCURRENTLY operational_balances;
