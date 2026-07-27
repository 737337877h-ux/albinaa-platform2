-- ============================================================================
-- Migration: 20260718000000_auth_sessions  (Milestone 2)
-- سبب إنشاء جدول جديد (توثيق إلزامي حسب قواعد المشروع):
--   متطلبات المصادقة تفرض: Refresh Token منفصلاً، محفوظًا مجزّأً (Hash)،
--   وقابلاً للإبطال عند تسجيل الخروج أو تغيير كلمة المرور.
--   لا يوجد جدول في المخطط المعتمد v2 يخدم هذا الغرض، وتخزين الجلسات في
--   users يخالف التطبيع ويمنع تعدد الجلسات للجهاز الواحد.
-- ملاحظات أمنية:
--   - يُخزَّن SHA-256 للتوكن فقط — التوكن الخام لا يُحفظ ولا يُسجَّل أبدًا.
--   - الإبطال بتحديث revoked_at (لا حذف) للحفاظ على أثر تدقيقي.
-- ============================================================================
CREATE TABLE auth_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    token_hash      TEXT NOT NULL UNIQUE,          -- SHA-256(refresh_token)
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    replaced_by_id  UUID REFERENCES auth_sessions(id),  -- تدوير التوكن (Rotation)
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id, revoked_at);
