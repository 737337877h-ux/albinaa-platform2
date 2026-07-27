# Backend — منصة البناء الراقي (Milestone 2: API Foundation)

NestJS + TypeScript + Prisma + PostgreSQL — REST API بمصادقة JWT وصلاحيات RBAC كاملة على مستوى الـ API.

## التشغيل الكامل بأمر واحد (Docker)

```bash
cd albinaa-platform
cp .env.example .env
# ولّد السرين وضعهما في .env:
openssl rand -hex 64   # → JWT_ACCESS_SECRET
openssl rand -hex 64   # → JWT_REFRESH_SECRET

docker compose up -d --build
# الـ entrypoint يطبق الـ Migrations تلقائيًا قبل الإقلاع
# ثم Seed مرة واحدة:
docker compose exec backend node prisma/seed.js
```

- API: http://localhost:3000
- Swagger: http://localhost:3000/docs
- الدخول: `admin` / قيمة `ADMIN_INITIAL_PASSWORD` (الافتراضية `ChangeMe!2026`)

## التشغيل للتطوير (بدون Docker للـ Backend)

```bash
cd albinaa-platform && npm run db:up          # PostgreSQL فقط
cd backend && cp .env.example .env && npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

## الاختبارات (13 سيناريو معايير القبول)

```bash
# تتطلب قاعدة مهاجرة ومزروعة (الخطوات أعلاه)
cd backend
npm run test:e2e
```

تغطي: Login ناجح/فاشل/معطل، إصدار وتدوير التوكنات، Refresh صالح/غير صالح،
Endpoint محمي، رفض بلا صلاحية ونجاح بصلاحية، إنشاء مستخدم، منع التكرار،
منع Mass Assignment، حماية آخر مدير نشط، Health، اتصال القاعدة، وAudit Log فعلي.

## قائمة الـ Endpoints المنفذة

| Method | Path | الحماية |
|---|---|---|
| GET | /health | عام |
| GET | /health/database | عام |
| POST | /auth/login | عام + Rate Limit (5/دقيقة) |
| POST | /auth/refresh | عام + Rate Limit (10/دقيقة) |
| POST | /auth/logout | JWT |
| GET | /auth/me | JWT |
| POST | /auth/change-password | JWT |
| GET | /users | users.manage |
| GET | /users/:id | users.manage |
| POST | /users | users.manage |
| PATCH | /users/:id | users.manage |
| PATCH | /users/:id/status | users.manage + حماية آخر مدير |
| POST | /users/:id/reset-password | users.manage |
| POST | /users/:id/roles | users.manage |
| DELETE | /users/:id/roles/:roleId | users.manage + حماية آخر مدير |
| GET | /roles | users.manage |
| GET | /permissions | users.manage |
| GET | /roles/:id/permissions | users.manage |
| POST | /roles/:id/permissions | users.manage (+ settings.manage للأدوار النظامية الحساسة) |
| DELETE | /roles/:id/permissions/:permissionId | users.manage (+ settings.manage للحساسة) |
| GET | /organizations/current | JWT |
| GET | /branches | JWT |
| GET | /branches/:id | JWT |
| POST | /branches | settings.manage |
| PATCH | /branches/:id | settings.manage |
| PATCH | /branches/:id/status | settings.manage |

## Milestone 3 — محرك استيراد Excel

| Method | Path | الحماية |
|---|---|---|
| POST | /imports/upload | imports.run — رفع + تحقق + تحليل + معاينة (dry-run) |
| POST | /imports/:id/execute | imports.run — تنفيذ idempotent (force لتجاوز تحذير الملف المكرر) |
| GET | /imports | imports.read |
| GET | /imports/:id | imports.read |
| GET | /imports/:id/report | imports.read — العدادات التسعة + الأرصدة قبل/بعد |
| GET | /imports/:id/errors | imports.read — صفوف تالفة/عملات مجهولة/أخطاء تنفيذ |

قرارات موثقة:
1. **الـ Parser البايثوني المُختبر يعمل كما هو** (subprocess يخرج JSON) — لا إعادة
   كتابة لمنطق تم التحقق منه على 18,569 صفًا حقيقيًا بمطابقة أرصدة 100%.
   صورة الـ Docker تتضمن python3 + openpyxl لهذا الغرض.
2. **Idempotency بدل معاملة عملاقة واحدة**: قيد line_hash الفريد + upserts تجعل
   إعادة تنفيذ أي استيراد فاشل آمنة تمامًا — لا تكرار ولا فقدان.
3. **الأخطاء لا توقف الاستيراد**: صف تالف/عملة مجهولة/كود ناقص → يُسجَّل في
   error_report ويستمر الباقي (متطلب صريح). نوع مستند جديد يُنشأ آليًا
   بعلامة "يحتاج مراجعة" بدل إيقاف العملية.
4. **اختبارات M3**: `npm run test:e2e` تشمل الملف الاصطناعي fixture.xlsx
   (بنفس بنية الملف الحقيقي + كتلة مجزأة + حركتان متطابقتان مشروعتان +
   صفان تالفان + عملة مجهولة) — الاستيراد الأول، إعادة الاستيراد، عدم
   التكرار، مطابقة الأرصدة، تعدد العملات، ومعالجة التلف.

## Milestone 4 — Customer Domain + Dashboard

| Method | Path | الحماية |
|---|---|---|
| GET | /customers | customers.read — بحث/تصفية/ترتيب/Pagination؛ المحصل يرى المسندين إليه فقط |
| GET | /customers/duplicates | duplicates.review — حالات تشابه الأسماء (لا دمج آلي) |
| PATCH | /customers/duplicates/:pairId | duplicates.review |
| GET | /customers/:id | customers.read — Customer 360 |
| GET | /customers/:id/timeline | customers.read — خط زمني موحد |
| GET | /customers/:id/balances | customers.read + balances.read — محاسبي وتشغيلي لكل عملة |
| GET | /customers/:id/statement | customers.read + balances.read — كشف حساب برصيد جارٍ |
| POST | /customers | customers.write |
| PATCH | /customers/:id | customers.write |
| PATCH | /customers/:id/status | customers.write |
| POST | /customers/:id/assign | customers.transfer — نقل بين المحصلين مع حفظ التاريخ |
| GET | /dashboard/summary | reports.read |

قرارات موثقة:
1. **نطاق رؤية المحصل مطبق في API**: صلاحية جديدة `customers.read_all` (مزروعة
   لكل الأدوار عدا المحصل) — من لا يملكها يرى العملاء المسندين إليه حاليًا فقط.
2. **الترتيب بالرصيد يتطلب عملة محددة** — رصيد العميل معرّف لكل عملة، ولا جمع
   مخلوطًا بين عملات (قاعدة معتمدة من مرحلة التصميم).
3. **كشف الحساب برصيد جارٍ صحيح حتى مع التصفية بالتاريخ**: رصيد بداية الفترة =
   الافتتاحي + كل الحركات السابقة (مؤكد بمحاكاة مستقلة).
4. **البحث بالاسم عبر name_normalized** — "الإختبار" تطابق "الاختبار".
5. **أعمار الديون في الـ Dashboard معلّمة estimated=true دائمًا** مع ذكر الأساس —
   الملف لا يوفر تواريخ استحقاق (قرار "لا دقة زائفة" المعتمد).
6. **المديونية الجديدة** = الزيادات الموجبة بين آخر استيرادين (Snapshots) + من
   أصبح مدينًا لأول مرة، لكل عملة.

## Milestone 5 — Collection Workflow

| المجموعة | Endpoints |
|---|---|
| Followups | POST/GET/GET:id/PATCH:id/DELETE:id (حذف ناعم فقط) `/followups` |
| Payment Promises | POST/GET/GET:id/PATCH:id/PATCH:id/status `/payment-promises` |
| Collections | POST/GET/GET:id + POST:id/reverse `/collections` |
| Assignments | GET/POST + PATCH:id/end `/assignments` |
| Daily Tasks | GET /tasks/today، GET /tasks، PATCH /tasks/:id/complete |
| Collector Dashboard | GET /dashboard/collector |
| Notifications | GET /notifications، PATCH :id/read، PATCH read-all |

قواعد عمل موثقة (Migration 20260719000000 يشرح أسباب كل تعديل مخطط):
1. **حالات الوعد — State Machine معتمدة (مراجعة M5)**:

   | من \ إلى | fulfilled | partially_fulfilled | unfulfilled | cancelled_approved | postponed |
   |---|---|---|---|---|---|
   | upcoming | ✓ | ✓ (fulfilledAmount إلزامي، 0<م<المتوقع) | ✓ (سبب) | ✓ (سبب) | ✓ (سبب + newDueDate قادم) |
   | due_today | ✓ | ✓ | ✓ | ✓ | ✓ |
   | partially_fulfilled | ✓ | ✓ (تحديث المبلغ) | ✓ | ✓ | ✓ |
   | fulfilled / unfulfilled / cancelled_approved | — نهائية: لا انتقالات ولا تعديل — | | | | |

   - `postponed` لا تُخزَّن كحالة راكدة: التأجيل يحدّث `dueDate` ومهمة
     `promise_due` المفتوحة، ويعيد الحالة إلى upcoming/due_today، والحدث
     موثق في Audit (action: `promise_postponed`) وفي Timeline.
   - `fulfilled` يخزّن `fulfilledAmount = expectedAmount` تلقائيًا.
   - تعديل `dueDate` عبر PATCH يرفض التواريخ الماضية (400) ويزامن المهمة
     ويعيد حساب الحالة ويسجل القديم والجديد في Audit.
2. **الوعد المتأخر**: مسح تلقائي (يستدعيه /tasks/today) يحوّله unfulfilled
   وينشئ مهمة تصعيد وإشعارًا — تنفيذ حرفي لقاعدة §12.
3. **التحصيل**: لا PATCH إطلاقًا ولا DELETE (Trigger)؛ التصحيح بعكس موثق
   بسبب إلزامي؛ كل عملية تقيّد في الدفتر التشغيلي Append-Only فيتحدّث
   الرصيد التشغيلي تلقائيًا (مشتق، لا يُعدَّل يدويًا).
4. **الفرع في التحصيل**: يُثبَّت وقت العملية (فرع المحصل ثم العميل) —
   قيمة تاريخية لا تتأثر بنقل المحصل لاحقًا.
5. **عمل اليوم**: أولوية معتمدة — تصعيدات فمستحقات اليوم فغير المتابَعين منذ
   X يومًا (إعداد followup_stale_days=14) فالرصيد المرتفع (أعلى 10% لكل عملة،
   إعداد) فالمخاطر العالية (قواعد مفسَّرة — الذكاء الاصطناعي لاحقًا).
6. **الإشعارات**: داخلية في القاعدة فقط (بلا Push) حسب متطلب المرحلة.

## قرارات أمنية موثقة

1. **كلمات المرور**: Argon2id للجديد؛ التحقق يدعم صيغة scrypt من Seed المرحلة الأولى
   ويرقّيها تلقائيًا إلى Argon2 عند أول دخول ناجح.
2. **Refresh Tokens**: عشوائية 384-bit، تُخزَّن SHA-256 فقط في جدول `auth_sessions`
   الجديد (سبب إنشائه موثق داخل ملف الـ migration)، مع تدوير عند كل تجديد
   وإبطال عند الخروج/تغيير كلمة المرور/التعطيل.
3. **رسالة فشل دخول موحدة**: لا تكشف وجود المستخدم أو حالة تعطيله.
4. **الصلاحيات تُحمَّل من القاعدة في كل طلب** (لا من التوكن) — التعطيل وسحب
   الأدوار يسريان فورًا.
5. **Mass Assignment ممنوع**: `whitelist + forbidNonWhitelisted` عالميًا.
6. **Audit**: خدمة مركزية تحجب تلقائيًا أي مفتاح يحتوي password/token/secret.
7. **الأخطاء موحدة** بالحقول الستة المطلوبة، وبدون Stack Trace في الإنتاج.
