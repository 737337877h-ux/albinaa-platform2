-- ============================================================================
-- Migration: 20260728000000_add_performance_indexes
-- إضافة فهارس أداء جديدة + إعادة بناء فهرس assignments
--
-- الفهارس المُضافة:
--   idx_assignments_collector  — إعادة بناء بدون WHERE (أعمدة: collector_id, effective_from)
--   idx_collections_status     — فلترة التحصيلات حسب الحالة
--   idx_promises_customer      — وعود السداد حسب العميل
--   idx_tasks_customer         — المهام حسب العميل
--   idx_followups_user         — المتابعات حسب المستخدم
--   idx_balances_customer      — أرصدة العملاء
-- ============================================================================

-- 1) إعادة بناء فهرس assignments: من partial إلى عادي
DROP INDEX IF EXISTS idx_assignments_collector;
CREATE INDEX idx_assignments_collector ON customer_assignments (collector_id, effective_from);

-- 2) فلترة التحصيلات حسب الحالة + التاريخ
CREATE INDEX idx_collections_status ON collections (status, collected_at);

-- 3) وعود السداد حسب العميل + الحالة
CREATE INDEX idx_promises_customer ON payment_promises (customer_id, status);

-- 4) المهام حسب العميل
CREATE INDEX idx_tasks_customer ON tasks (customer_id);

-- 5) المتابعات حسب المستخدم + التاريخ
CREATE INDEX idx_followups_user ON followups (user_id, followup_at);

-- 6) أرصدة العملاء (بحث مباشر بالعميل)
CREATE INDEX idx_balances_customer ON customer_balances (customer_id);
