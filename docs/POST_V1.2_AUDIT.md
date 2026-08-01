# Post-v1.2 Audit — Notifications, Dashboard Drilldown, UI Polish, Data Quality

**Branch:** `feature/v1.3-planning-audit`
**Base:** `main` = `a2702e8` (tag `v1.2.0`)
**Type:** تشخيص قراءة فقط — لا تغييرات منطقية، لا schema، لا migration.
**Date:** 2026-08-01

---

## 1) Notifications — التشخيص

### الحالة الفعلية
| المحور | النتيجة |
|--------|---------|
| النظام موجود؟ | ✅ نعم — `backend/src/notifications/` (GET /notifications + PATCH read/read-all) |
| المشكلة API؟ | ⚠️ جزئيًا — الـ API يعمل (رُصد 235 إشعارًا، منها 184 غير مقروء، للمدير 97). لكن نوعي `task_assigned` و`followup_due` موثقان في المخطط **ولم يُنشئهما أي مسار برمجي أبدًا**. |
| المشكلة Frontend؟ | ⚠️ نعم — صفحة `/notifications` الكاملة **Placeholder** ("قيد الإنشاء"). الجرس المنسدل يعمل (6 عناصر + استطلاع 60 ثانية). **لا يوجد تعليم كمقروء من الويب** — شارة غير المقروء لا تُمحى أبدًا من الويب (mobile فقط تعيّن read). |
| المشكلة Permissions؟ | ❌ لا — قراءة الإشعارات لا تتطلب صلاحية، أي مستخدم مصادق يقرأ إشعاراته. |
| المشكلة عدم بيانات؟ | ❌ لا — بيانات وفيرة (235 صفًا). |
| الخلاصة | الإشعارات "لا تظهر" لأن **الصفحة الكاملة غير مبنية** في الويب + **لا يوجد read/read-all** من الويب + نوعان من الإشعارات لا يُنشآن. الـ API سليم. |

### الحكم
- **Hotfix v1.2.1:** بناء صفحة الإشعارات الكاملة في الويب (قائمة + تعليم كمقروء + رابط للعنصر) — هذا يكمل تجربة موجودة بلا تغيير بنية.
- **v1.3:** إشعارات `task_assigned` / `followup_due` (إرسال جديد)، أو Push خارجي (خارج النطاق حاليًا).

---

## 2) Dashboard Drilldown — الاقتراح (بدون تنفيذ)

### الوضع الحالي
- بطاقات المؤشرات الأربع في `dashboard/page.tsx` (إجمالي العملاء، بطاقات العملات debtor/creditor، مديونية جديدة، المخاطر، مهام اليوم، +120 يوم) **كلها ثابتة (static)** — لا Links.
- الـ Backend يدعم الفلترة بالفعل:
  - `GET /customers` يقبل `balanceState=debtor|creditor|zero` + `currency=YER|SAR|USD` + `search` + `region` + `collectorId` + `status` + `sortBy` + `page/limit`.
  - `ValidationPipe` صارم (`forbidNonWhitelisted`) → أي param غير معروف = **400**. لا يوجد param اسمه `balanceType`.
- العملات في النظام: **YER / SAR / USD** (وليست YR/SR/USD).

### الاقتراح (للاعتماد ثم التنفيذ في v1.3)
| البطاقة | الرابط المقترح |
|---------|----------------|
| إجمالي المديونية حسب العملة (YER) | `/customers?balanceState=debtor&currency=YER` |
| العملاء المدينون (YER) | `/customers?balanceState=debtor&currency=YER` |
| العملاء الدائنون (SAR) | `/customers?balanceState=creditor&currency=SAR` |
| مهام اليوم | `/tasks` |
| عملاء +120 يوم | `/customers?search=&...` (يتطلب إضافة فلتر aging) |

- التنفيذ يحتاج: تحويل البطاقات إلى `Link`، وتمرير الـ query، والتأكد أن صفحة العملاء تقرأ `balanceState`/`currency` من URL وتطبقها (قد تتطلب إضافة قراءة URL في `customers/page.tsx`).

---

## 3) UI Polish — اقتراح Design Tokens فقط (بدون تنفيذ)

### الوضع الحالي
- **لا يوجد طبقة CSS variables** — كل الألوان في `tailwind.config.ts` فقط (`globals.css` بلا `:root` palette).
- خطوط: **System stacks فقط** (Tahoma/Segoe UI) — لا خط عربي ويب (قرار موثق: تجنب `next/font/google` لأن البناء قد يكون بلا إنترنت).
- RTL: `html lang="ar" dir="rtl"` في `layout.tsx:22` — سليم.
- البطاقات: مكوّن `Card` موحد (`rounded-xl bg-white shadow-card`)، التباعد `p-4` داخل `grid gap-4`.

### الاقتراح (v1.3، tokens فقط)
- نقل ألوان Tailwind إلى **CSS variables** (`:root` + `@theme`) كطبقة Design Tokens (مثال: `--color-surface`, `--color-debt-600`, ...).
- إضافة توكينز `borderRadius` (xl/lg/sm) و`spacing` للبطاقات و`fontSize` رقمي (`tabular-nums` موجود بالفعل).
- خط عربي اختياري عبر `@font-face` محلي (حل البناء بلا إنترنت) مثل Cairo/Tajawal.
- تحسين وضوح الأرقام/العملات عبر توكينز `tnum` + تنسيق موحد (موجود جزئيًا في `lib/format.ts`).
- لا إعادة تصميم (لا redesign) في هذه المرحلة.

---

## 4) Data Quality / Import Validation — الاقتراح (بدون زر "تحديث البيانات")

### الوضع الفعلي (قراءة قاعدة حية)
| الفحص | النتيجة |
|-------|---------|
| عملاء مكررون (اسم مُطبَّع) | **665 مجموعة مكررة / 1374 عميلًا** (أعلاها "عميل الاختبار الأول" ×14) |
| تكرار `external_customer_code` | 0 (قيد فريد سليم) |
| عملاء بلا رقم هاتف | **2160 من 2243 (96.3%)** |
| عملاء بلا كود | 0 |
| عملاء بعدة عملات | 81 عميلًا (متوقع: صف رصيد لكل عملة) |
| أزواج مكررة معلقة (PotentialDuplicate) | **808 معلقة + 11 مرفوضة** |
| ميزة الكشف موجودة؟ | ✅ `GET /customers/duplicates` (صلاحية `duplicates.review`) + `PATCH /customers/duplicates/:pairId` — **مراجعة بشرية فقط، لا merge تلقائي** — لكن **لا توجد صفحة ويب تستهلكها بعد** |

### الاقتراح (v1.3)
**Data Quality / Import Validation Dashboard** (تقرير فقط، بلا تعديل مباشر):
1. كشف العملاء المكررين — استهلاك `GET /customers/duplicates` في صفحة ويب للمراجعة البشرية (لا merge تلقائي).
2. كشف تكرار المبالغ/القيود في الاستيراد — قراءة `imported_transactions` بحثًا عن التكرار (سطر-و-hash).
3. كشف العملاء بلا رقم/كود — تقرير عدّ (لا حذف).
4. كشف اختلاف العملة — العملاء بعدة عملات (متوقع ومحلول بـ unique لكل عملة، يوثَّق فقط).
5. تقرير قبل التنفيذ — كل بند بنتيجة "لا تعديل مباشر على الأرصدة، لا حذف تلقائي، لا دمج بدون مراجعة".

---

## ما يجب أن يكون Hotfix v1.2.1
1. **صفحة الإشعارات الكاملة في الويب** (قائمة + تعليم كمقروء + رابط للعنصر) — استكمال لتجربة موجودة.
2. (اختياري) تعليم read/read-all من الويب في الجرس.

## ما يجب أن يكون v1.3
1. **Dashboard Drilldown** — بطاقات المبالغ روابط ذكية (`balanceState=debtor/creditor` + `currency=YER/SAR/USD`) بعد اعتماد خريطة العملات.
2. **Design Tokens** — طبقة CSS variables + توكينز ألوان/خط/تباعد + خط عربي محلي (بدون redesign).
3. **Data Quality / Import Validation** — صفحة تقرير (مكررون، تكرار قيود، بلا رقم/كود، اختلاف عملة) مع مراجعة بشرية فقط.
4. **إشعارات جديدة** `task_assigned` / `followup_due`.

## المخاطر
- **بطاقات drilldown**: ربط مباشر بمعرّف العملة الدقيق (YER/SAR/USD) — أي تغيير مستقبلي في رموز العملات يكسر الروابط؛ يُفضَّل URL عبر `balanceState` + `currency` من معرّف منشأ.
- **Data quality**: لا تعديل/حذف/دمج تلقائي أبدًا (سياسة معتمدة) — أي أداة تُنشأ للمراجعة فقط.
- **UI tokens**: نقل الألوان من Tailwind إلى CSS vars تغيير مرئي شامل — يجب داخل فرع معزول وقابل للتراجع، ولا يُدمج مع ميزات أخرى.
- **Notifications v1.2.1**: إذا أُطلق hotfix بعد tag v1.2.0 فيجب أن لا يمس schema ولا يرتفع إلا patch.
- **إصدار Mobile** يبقى 1.1.0 — لا APK في أي خطوة قبل أمر صريح.

## التوصية للـ PR التالي
- **v1.2.1 Hotfix** (Notifications full page + read) أولًا — صغير، يُغلق تجربة ناقصة دون مخاطرة.
- ثم **v1.3.0** (Drilldown → Design Tokens → Data Quality → Notifications kinds) في 3-4 PRs منفصلة.
