# تقرير التسليم — v1.1.0

**الإصدار:** v1.1.0 — أدوات التواصل مع العملاء
**التاريخ:** 2026-07-30
**Tag:** `v1.1.0` (`b345ef1`)
**الفرع:** `main`

---

## ما تم إنجازه في v1.1.0

### 1. أزرار اتصال مباشر — Call/SMS/WhatsApp ✅

**الملف:** `mobile/src/screens/customer-360.tsx`

- أزرار **اتصال** و**رسالة نصية** و**واتساب** في بطاقة العميل (Customer360)
- استخدام `Linking.openURL()` من React Native (بدون مكتبات جديدة)
- دالة `cleanPhone()` لتنظيف الرقم وإضافة رمز الدولة 967 تلقائيًا
- إخفاء الأزرار عند عدم وجود رقم هاتف
- روابط عميقة: `tel:`, `sms:`, `https://wa.me/...`

### 2. خريطة موقع العميل — Location Map ✅

**الملف:** `mobile/src/screens/customer-360.tsx`

- زر **"فتح في الخرائط"** يعرض موقع العميل
- استخدام URI: `geo:` (إحداثيات) أو `maps:` (بحث بالعنوان)
- إخفاء الزر عند عدم وجود عنوان أو إحداثيات (Fallback)

### 3. إشعارات تفاعلية — Deep Linking ✅

**الملف:** `mobile/src/screens/notifications.tsx`

- الضغط على الإشعار **يفتح الشاشة المرتبطة**:
  | نوع الإشعار | الوجهة |
  |------------|--------|
  | `followup_due`, `promise_due`, `promise_overdue`, `customer_transferred`, `collection_created` | Customer360 (بمعرّف العميل) |
  | `task_new` | شاشة المهام |
  | رابط ناقص/غير صالح | Dashboard (Fallback) |
- يعتمد على `customerId` في الـpayload

**الملف:** `backend/src/collections/collections.service.ts`

- إضافة `customerId` إلى payload إشعار `collection_created` (كان ناقصًا)

### 4. عملات ديناميكية من الـAPI ✅

**الملفات:** `mobile/src/api/endpoints.ts`, `mobile/src/screens/new-promise.tsx`, `new-collection.tsx`, `new-task.tsx`

- دالة جديدة `fetchCurrencies()` → `GET /currencies`
- استبدال قائمة `['YER', 'SAR', 'USD']` المكتوبة يدويًا في 3 شاشات بقائمة من الـBackend
- بدون أي Dependency جديدة

### 5. تحديثات وثائقية

| الملف | الوصف |
|-------|-------|
| `CHANGELOG.md` | قسم v1.1.0 كامل + تحديث الإصدارات المخطط لها |
| `RELEASE_NOTES_v1.1.0.md` | ملاحظات الإصدار المختصرة |
| `PROJECT_STATE.md` | حالة المشروع الحالية |
| `DATABASE_SCHEMA.md` | توثيق قاعدة البيانات / Prisma Schema |
| `ROADMAP.md` | خارطة الطريق للمستقبل |
| `mobile/app.json`, `package.json`, `backend/package.json` | رقم الإصدار → `1.1.0` |

---

## Commits (v1.0.0 → v1.1.0)

| Commit | الوصف |
|--------|-------|
| `b345ef1` | release: v1.1.0 — أدوات التواصل مع العملاء |
| `2b9e050` | feat(mobile): open customer address in native maps app |
| `49fcea9` | feat(mobile): Call/SMS/WhatsApp buttons in Customer360 |
| `da9f2cb` | fix(frontend): null-safe .name access — crash TypeError null.name |
| `0bd9deb` | fix: nginx RSC routing and AppShell hydration (React #418/#423, 401) |
| `f1be7f9` | fix(frontend): resolve React #418/#423 hydration error and 401 requests |

---

## فحوصات الجودة (Checks)

| الفحص | النتيجة |
|-------|--------|
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| ESLint | ✅ 0 errors (3 تحذيرات قديمة موجودة مسبقًا) |
| Mobile Tests (`jest`) | ✅ 33/33 pass |
| Expo Doctor | ✅ 20/20 |
| Android Export (`expo export`) | ✅ 968 modules |

---

## الـAPK

| البند | القيمة |
|-------|--------|
| الملف | `mobile/albinaa-collector-v1.1.0.apk` |
| الحجم | ~87 MB |
| البناء | EAS Cloud (`preview` profile) |
| Build ID | `ff902da4-3b10-4c47-87d6-62a6e889763d` |
| Version | 1.1.0 (code 1) |
| Profile | preview (internal) |
| بيئة الـAPI | `https://api.albinaa.com` |

---

## نطاق v1.1.0 (لم يُنفَّذ — قرار متعمد)

| البند | الحالة |
|-------|--------|
| Push Notifications (FCM/APNS) | مؤجل إلى v1.2.0 — يتطلب Dependencies جديدة |
| تحسينات UI/UX | مؤجلة إلى v1.2.0 |
| تقارير مالية متقدمة | مؤجلة إلى v1.2.0 |

**المتطلبات الملتزمة بها:** Minimal Change، بدون Dependencies جديدة، بدون تغيير Architecture، الحفاظ على Backward Compatibility.
