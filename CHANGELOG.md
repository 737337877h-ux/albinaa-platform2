# سجل التغييرات

جميع التغييرات الملحوظة في هذا المشروع موثقة في هذا الملف.

التنسيق مبني على [Keep a Changelog](https://keepachangelog.com/ar/1.0.0/)،
وهذا المشروع يتبع [Semantic Versioning](https://semver.org/lang/ar/).

## [1.0.0] - 2026-07-30 — الإصدار المستقر

### الإضافات الرئيسية
- **نظام المديونيات والتحصيل الكامل** — endpoints لكل العمليات الأساسية
- **نظام الوعود** مع State Machine صارم (upcoming → due_today → fulfilled/broken/cancelled)
- **نظام المتابعات** مع Type/Result مرجعي
- **لوحة المهام الذكية** تجمع الوعود المستحقة، العملاء غير المتابَعين، الأرصدة المرتفعة، المخاطر
- **Import Pipeline** لاستيراد Excel/CSV مع Idempotency وTransaction safety
- **JWT Authentication** مع Access + Refresh Tokens وRotation
- **RBAC** مع 30+ صلاحية وRoles مرنة
- **Mobile App** (React Native + Expo SDK 57)
  - مزامنة كاملة مع الـBackend
  - دعم العمل دون اتصال (Offline queue)
  - إدارة رصيد العميل (accounting + operational)
  - رفع السندات
  - GPS tagging
  - **إعدادات الخادم داخل التطبيق** — يمكن تغيير URL دون إعادة بناء
- **Web Dashboard** (Next.js 14)
- **PostgreSQL Schema كامل** مع 41 index/unique constraint
- **Prisma Migrations** مع idempotent deploy
- **Docker Compose** للتطوير والإنتاج
- **Nginx reverse proxy** مع SSL termination
- **Automated Backups** (cron داخل container)
- **Swagger/OpenAPI** للتوثيق
- **Audit Log** شامل لكل العمليات الحساسة
- **Rate Limiting** (5/min login, 10/min refresh, 100/min عام, 20/min upload)
- **Helmet** للأمان
- **CORS** مع allowlist
- **Global Exception Filter** مع Request ID
- **Health Checks** (/health, /health/database, /health/ready, /health/live)

### الأمان
- bcryptjs لتشفير كلمات المرور
- JWT مع TTL قصير + Refresh Rotation
- File upload validation (MIME + extension)
- SQL Injection protection عبر Prisma parameterized queries
- Idempotency keys للعمليات الحساسة
- Session tracking + revocation
- Max sessions per user

### الأداء
- Prisma includes لتقليل N+1 queries
- Strategic indexes على كل queries الشائعة
- SQLite dedup + unique indexes
- Mobile sync مع 30-second interval
- Incremental sync via syncToken

### Mobile
- ErrorBoundary
- TanStack Query مع invalidation patterns
- في حال النجاح، التحديث فوري بدون إعادة فتح التطبيق
- اختيار عميل موحد في كل النماذج
- Notifications مع parsing للـpayload
- Server settings modal مع ping + version detection
- كشف في-الوقت-الحقيقي لحالة الخادم

### الإصلاحات (Bug Fixes)
- Customer 360: لا تعطل عند فتح عميل
- Login: يعمل على IP مختلف (192.168.x.x)
- Notifications: تعرض كل الحقول (title, body, event type, read state, customer)
- Dashboard: يستخدم SQLite المحلي بدل syncData الفارغ
- Duplicate customers: dedup في كل sync + UI
- Tasks: تنشأ وتظهر فوراً
- Balance: التحصيل يُخفض operational فوراً، العكس يعيده
- Promises endpoint: `/promises` → `/payment-promises`
- Currency picker: لا AED (YER, SAR, USD فقط)
- Promise due date: حقل إلزامي
- Profile: إعادة جلب /auth/me عند التركيز

### الأمان (Security)
- Helmet middleware
- CORS allowlist
- Rate limiting
- ValidationPipe (whitelist + forbidNonWhitelisted)
- Global exception filter (لا تسريب stack traces)

### موثوقية (Reliability)
- 39 اختبار تلقائي يمر
- TypeScript: 0 errors
- ESLint: clean
- Expo Doctor: 20/20
- Android export: success

## [0.2.0] - 2026-07-XX — Milestone 2: API Foundation

- أول إصدار وظيفي للـBackend
- Auth + RBAC + Customers + Collections + Promises
- Prisma schema أساسي

---

## الإصدارات القادمة المُخططة

### [1.1.0]
- إشعارات Push (FCM/APNS)
- تحسينات UI/UX
- تقارير مالية متقدمة
- Call/SMS/WhatsApp buttons
- Customer location map

### [2.0.0]
- Microservices split
- Event-driven architecture
- GraphQL support
- Multi-tenant
