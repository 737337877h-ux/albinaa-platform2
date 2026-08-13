# مراجعة الأمان — منصة البناء الراقي

## ملخص

| البند | الحالة | التفاصيل |
|-------|--------|---------|
| JWT | ✅ | Access Token 15 دقيقة، Refresh Token 7 أيام |
| Refresh Token Rotation | ✅ | كل طلب refresh يُبطل الجلسة القديمة ويُصدر جديدة |
| Refresh Token Storage | ✅ | مخزّن كـ SHA-256 hash فقط (أبداً بالنص الخام) |
| Rate Limiting | ✅ | 5/دقيقة login، 10/دقيقة refresh، 100/دقيقة عام |
| RBAC | ✅ | 3 طبقات: JWT → أدوار → صلاحيات |
| Permissions from DB | ✅ | تُحمّل من قاعدة البيانات لكل طلب (إبطال فوري) |
| Max Sessions | ✅ | 5 جلسات نشطة/مستخدم (الجلسات الأقدم تُبطل) |
| Password Policy | ✅ | 8 أحرف كحد أدنى للمدير |
| SQL Injection | ✅ | Prisma Client فقط (parameterized) |
| XSS | ✅ | لا `dangerouslySetInnerHTML` في الواجهة |
| Upload Validation | ✅ | امتدادات مسموحة (.xlsx, .xlsm)، حجم 30MB |
| Security Headers | ✅ | Helmet.js + Nginx headers |
| CORS | ✅ | مُعدّل من البيئة (لا wildcard) |
| Mass Assignment | ✅ | `whitelist + forbidNonWhitelisted` في ValidationPipe |
| Audit Logging | ✅ | كل عملية مُسجّلة مع userId/IP/userAgent |
| Password Redaction | ✅ | كلمة المرور والتوكن لا تظهر في السجلات |
| Swagger | ✅ | معطّل في بيئة الإنتاج |
| HTTPS | ✅ | Nginx reverse proxy مع TLS 1.2+ |
| HSTS | ✅ | `max-age=31536000; includeSubDomains` |
| Session Cleanup | ✅ | الجلسات المنتهية تُبطل تلقائيًا |

## ملاحظات

### JWT_REFRESH_SECRET
غير مستخدم حاليًا (الـ Refresh Tokens حركات عشوائية opaque) لكن يُحتفظ به
كحماية مستقبلية (defence-in-depth) إذا تم التحوّل إلى JWT-based refresh tokens.

### CSRF
المعرضة أقل لأن API يستخدم JWT في Authorization header (غير قابل للنسخ عبر cookie).

### Session Timeout
- Access Token: 15 دقيقة (قابل للتعديل عبر JWT_ACCESS_TTL)
- Refresh Token: 7 أيام (قابل للتعديل عبر JWT_REFRESH_TTL)
- الجلسات المُبطلة لا يمكن استخدامها مجددًا

### Password Storage
scrypt (Node.js crypto) مع N=16384, r=8, p=1، يُرقّى تلقائيًا إلى Argon2
عند إعادة تحميل كلمة المرور.
