-- ============================================================================
-- Migration: 20260719000000_collection_workflow  (Milestone 5)
-- تعديلات موثقة على المخطط المعتمد (السبب إلزامي حسب قواعد المشروع):
--
-- 1) followups.deleted_at/deleted_by:
--    متطلب M5 يفرض DELETE /followups/:id بأسلوب Soft Delete فقط.
--    المخطط المعتمد لم يتضمن حذفًا للمتابعات إطلاقًا؛ الحذف الناعم يحقق
--    المتطلب مع بقاء السجل كاملاً للتدقيق (لا حذف فعلي أبدًا).
--
-- 2) payment_promises.due_date + status_reason:
--    متطلب M5 يفرّق بين "تاريخ الوعد" (يوم قطع الوعد) و"تاريخ الاستحقاق"
--    (اليوم المتوقع للسداد)، ويطلب "سبب الإلغاء أو الإخلال".
--    المخطط المعتمد كان يحمل promise_date واحدًا فقط. القيم القديمة إن وجدت
--    تُهاجر بجعل due_date = promise_date.
--    ملاحظة معتمدة للمراجعة: حالات الوعد تبقى بالقائمة الغنية المعتمدة سابقًا
--    (upcoming/due_today/fulfilled/partially_fulfilled/unfulfilled/postponed/
--    cancelled_approved) وهي تغطي الحالات الأربع المطلوبة في M5:
--    Pending≈upcoming، Fulfilled=fulfilled، Broken=unfulfilled،
--    Cancelled=cancelled_approved — مع إبقاء "منفذ جزئيًا" و"مؤجل" من
--    المتطلبات الأصلية (§12). هذا التوفيق موثق هنا وقابل للنقض عند الاعتماد.
--
-- 3) collections.branch_id:
--    متطلب M5 يدرج "الفرع" ضمن بيانات التحصيل. يُشتق افتراضيًا من فرع
--    المحصل ويُخزَّن وقت العملية (قيمة تاريخية لا تتغير بنقل المحصل لاحقًا).
-- ============================================================================

ALTER TABLE followups
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID REFERENCES users(id);
CREATE INDEX idx_followups_alive ON followups (customer_id, followup_at)
    WHERE deleted_at IS NULL;

ALTER TABLE payment_promises
    ADD COLUMN due_date DATE,
    ADD COLUMN status_reason TEXT;
UPDATE payment_promises SET due_date = promise_date WHERE due_date IS NULL;
ALTER TABLE payment_promises ALTER COLUMN due_date SET NOT NULL;
CREATE INDEX idx_promises_due ON payment_promises (due_date, status);

ALTER TABLE collections
    ADD COLUMN branch_id UUID REFERENCES branches(id);
