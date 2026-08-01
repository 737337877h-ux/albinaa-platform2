# خارطة الطريق — Roadmap

**آخر تحديث:** 2026-08-01 (بعد إصدار v1.2.1)

---

## ✅ منجزة

| الإصدار | التاريخ | المحتوى |
|---------|---------|---------|
| **v0.2.0** | 2026-07 | Milestone 2: API Foundation (Auth + RBAC + أساسيات) |
| **v1.0.0** | 2026-07-30 | الإصدار المستقر: النظام الكامل + 11 إصلاحًا + Mobile App |
| **v1.1.0** | 2026-07-30 | أدوات التواصل: Call/SMS/WhatsApp + خريطة + إشعارات تفاعلية + عملات ديناميكية |
| **v1.2.0** | 2026-08-01 | إدارة المديونية الذكية: Import Profiles + Debt Aging · Risk Score · Daily Work Queue · Customer360 Risk/Tasks · Dashboard KPIs · Customer Assignments · Task Execution + Followup + Promise · Stabilization (full e2e 122/122) |
| **v1.2.1** | 2026-08-01 | صفحة الإشعارات الكاملة (Web Hotfix): قائمة + تعليم كمقروء/الكل + فلتر غير المقروء + مزامنة جرس الإشعارات |

---

## 🔜 v1.3.0 — قيد التخطيط (تنتظر الموافقة)

### إشعارات Push (FCM/APNS)
- تنبيهات لحظية على جهاز المحصل عند الأحداث المهمة
- يتطلب: Dependencies جديدة (`expo-notifications` push channels, FCM credentials)

### تحسينات UI/UX
- تحسين شكل القوائم والبطاقات
- وضع ليلي (Dark Mode)
- خطوات أقل في النماذج

### تقارير مالية متقدمة
- تقارير التحصيل حسب المحصل/الفرع/الفترة
- رسوم بيانية (Dashboard analytics)
- تصدير PDF/Excel من الـWeb

### Mobile: تحسينات إضافية (مقترحة)
- البحث والفرز في قوائم التحصيلات/المتابعات
- تفاصيل وعد سداد / تحصيل كاملة
- دعم RTL كامل محسّن

---

## 🔮 v2.0.0 — رؤية بعيدة المدى

- **Microservices split** — فصل المكونات الكبيرة
- **Event-driven architecture** — معالجة غير متزامنة
- **GraphQL support** — بديل/مكمل لـREST
- **Multi-tenant** — دعم منشآت متعددة على نفس الخادم

---

## المبادئ التوجيهية

1. **Minimal Change** — كل مهمة أصغر تغيير ممكن
2. **No new dependencies** — ما لم تتطلبه المهمة مباشرة
3. **Backward Compatibility** — لا نكسر الواجهات القائمة
4. **اختبار قبل التسليم** — typecheck / lint / tests / expo-doctor / export
5. **Git Flow** — `main` للـReleases، `release/` للـFeatures
