# سجل التغييرات

## [1.0.0-rc.1] — 2026-07-28

### Release Candidate 1 — التجهيز للإنتاج

#### البنية التحتية
- CI/CD: GitHub Actions (lint → typecheck → build → test → docker build)
- Docker: خدمة Frontend مُضافة إلى docker-compose
- Production: docker-compose.prod.yml مع Nginx reverse proxy + backup
- Nginx: Gzip، Security Headers، SSL/TLS، Static Cache

#### الأمان
- Max Sessions: 5 جلسات نشطة/مستخدم (الجلسات الأقدم تُبطل)
- Swagger: معطّل في بيئة الإنتاج
- Password Policy: 8 أحرف كحد أدنى
- .env.prod.example: ملف قالب كامل
- .gitignore: تحسينات شاملة (pycache, test-output, eslintcache)

#### مراقبة الصحة
- `/health` — حالة عامة
- `/health/database` — اتصال قاعدة البيانات
- `/health/ready` — جاهزة للخدمة (readiness probe)
- `/health/live` — الخدمة حية (liveness probe) مع مراقبة الذاكرة

#### الأداء — فهارس جديدة
- `customer_assignments`: فهرس على (collectorId, effectiveFrom)
- `collections`: فهرس على (status, collectedAt)
- `payment_promises`: فهارس على (customerId, status) و (dueDate, status)
- `tasks`: فهرس على (customerId)
- `followups`: فهرس على (userId, followupAt)
- `customer_balances`: فهرس على (customerId)

#### الأداء — Frontend
- React Query: staleTime=30s، gcTime=5min
- No unnecessary re-renders verified

#### الواجهة
- `error.tsx` — حدود خطأ عربية لجميع مسارات App Router
- `loading.tsx` — مؤشرات تحميل (app + auth)
- `not-found.tsx` — صفحة 404 عربية

#### الاختبارات
- 29 اختبار Frontend (vitest + @testing-library/react)
- 6 اختبارات Backend parser
- 74 اختبار E2E

#### التوثيق
- README.md — محدث بالكامل
- INSTALL.md — خطوات التثبيت التفصيلية
- DEPLOYMENT.md — دليل نشر الإنتاج
- BACKUP.md — النسخ الاحتياطي والاستعادة
- SECURITY.md — مراجعة الأمان
- CHANGELOG.md — هذا الملف

---

## [0.9.0-rc.1] — 2026-07-28

### الإصدار المرشح الأول

- لوحة تحكم كاملة مع مؤشرات إحصائية
- إدارة العملاء مع بروفايل 360
- متابعة العملاء (Followups)
- وعود السداد مع آلة حالة
- تحصيل المدفوعات مع عكس موثق
- استيراد Excel مع تحقق وتدقيق
- 74 اختبار E2E ناجح
- 6 اختبارات وحدة Backend
