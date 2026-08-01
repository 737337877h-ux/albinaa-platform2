# سجل التغييرات

جميع التغييرات الملحوظة في هذا المشروع موثقة في هذا الملف.

التنسيق مبني على [Keep a Changelog](https://keepachangelog.com/ar/1.0.0/)،
وهذا المشروع يتبع [Semantic Versioning](https://semver.org/lang/ar/).

## [1.2.0] - 2026-08-01 — إدارة المديونية الذكية (Release Candidate)

### الإضافات الجديدة

#### Import Profiles + Debt Aging
- **Import Profiles** — كشف تلقائي لملفات تصدير APMS الحقيقية (Master + Statement) مع دعم تخطيطات الطباعة/التصدير المتنوعة
- **Debt Aging Storage** — تخزين ملخصات وتفاصيل تقادم الديون مع `line-hash` يتضمن `fileHash` لإعادة الاستيراد الشهرية الآمنة

#### Risk Score
- خدمة درجات المخاطر (`POST /risk/recalculate`) بسبعة عوامل (تقادم الدين، حجم الرصيد، الوعود المكسورة، تأخر آخر سداد، عدم الرد، بعد آخر متابعة، طلبات المهلة) مع تصنيف low/medium/high/critical لكل عميل/عملة

#### Daily Work Queue
- محرك قائمة عمل اليوم (`GET /tasks/today` + `POST /tasks/generate-today`) — توليد المهام من المخاطر/التقادم/الوعود/المتابعات/الأرصدة مرتبة بالأولوية مع مسح الوعود المتأخرة تلقائيًا
- الإدارة ترى قائمة عمل المنشأة كاملة (org-wide)، والمحصل يرى مهامه المسندة فقط

#### Customer360 Risk/Tasks
- عرض درجة المخاطر وسببها + قائمة مهام العميل المفتوحة داخل شاشة العميل

#### Dashboard KPIs
- لوحة مؤشرات حقيقية (`GET /dashboard/kpis`): العملاء/المديونون، الديون بالعملات، توزيع المخاطر، مهام اليوم، الأسباب الأكثر تكرارًا، العملاء عاليو المخاطر، أعلى المهام أولوية

#### Customer Assignments
- إسناد/فك إسناد العملاء للمحصلين مع حفظ تاريخ الإسناد، وإعادة توزيع المهام المفتوحة تلقائيًا عند الإسناد أو فكّه

#### Task Execution + Followup + Promise
- إكمال المهام مع متابعة ونتيجة (تواصل ناجح / لا يرد / وعد بالسداد / يحتاج زيارة / مؤجل / ملاحظة)
- عند "وعد بالسداد" يُنشأ وعد سداد باسم المحصل المسند حاليًا، مع التحقق المسبق قبل أي كتابة (لا إغلاق للمهمة ثم فشل الوعد)

### الإصلاحات (Stabilization)
- **Promises**: شرط الإسناد الحالي إلزامي للجميع — لا مزيد من تسجيل وعد بلا إسناد ساري حتى للمدير
- **Tasks complete**: عزل تسجيل الوعد قبل أي كتابة وحلّ المحصل من الإسناد الحالي بدل المهمة المتقادمة
- **Test raked**: تحديث تأكيد `/tasks/today` للحساب الإداري ليطابق سلوك PR5 (قائمة المنشأة org-wide)

### الموثوقية
- **Full e2e: 122/122** ✅ (كان 120/122) · Unit: 25/25 · Backend/Frontend typecheck + lint نظيفان · Docker compose كل الخدمات healthy

---

## [1.1.0] - 2026-07-30 — أدوات التواصل مع العملاء

### الإضافات الجديدة

#### Mobile App
- **Call/SMS/WhatsApp** — أزرار اتصال مباشر في بطاقة العميل (Customer360)، مع تنظيف رقم الهاتف تلقائياً للرمز الدولي 967
- **Location Map** — زر "فتح في الخرائط" يعرض موقع العميل على الخريطة عبر `geo:` / `maps:` URI
- **Interactive Notifications** — الضغط على الإشعار يفتح الشاشة المرتبطة (Customer360 للمواعيد/المتابعات/التحصيلات، Tasks للمهام الجديدة)، مع Fallback إلى Dashboard عند عدم توفر الرابط
- **Dynamic Currencies** — قائمة العملات تُجلب من الـAPI (`GET /currencies`) بدلاً من كونها hardcoded في 3 شاشات (Promise, Collection, Task)

#### Backend
- **Collection payload** — إضافة `customerId` إلى إشعار `collection_created` لتمكين الـDeep Link

### الإصلاحات (Bug Fixes) — من v1.0.0
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

### موثوقية (Reliability)
- 33 اختبار تلقائي
- TypeScript: 0 errors
- ESLint: clean
- Expo Doctor: 20/20
- Android export: success

---

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

### الأمان (Security)
- Helmet middleware
- CORS allowlist
- Rate limiting
- ValidationPipe (whitelist + forbidNonWhitelisted)
- Global exception filter (لا تسريب stack traces)

## [0.2.0] - 2026-07-XX — Milestone 2: API Foundation

- أول إصدار وظيفي للـBackend
- Auth + RBAC + Customers + Collections + Promises
- Prisma schema أساسي

---

## الإصدارات القادمة المُخططة

### [1.3.0]
- إشعارات Push (FCM/APNS)
- تحسينات UI/UX
- تقارير مالية متقدمة

### [2.0.0]
- Microservices split
- Event-driven architecture
- GraphQL support
- Multi-tenant
