# الاستعادة (Restore)

راجع [BACKUP.md](./BACKUP.md) للإرشادات الكاملة. ملخص سريع:

## استعادة سريعة

```bash
# 1. إيقاف الخدمات
docker compose -f docker-compose.prod.yml down

# 2. تشغيل قاعدة البيانات فقط
docker compose -f docker-compose.prod.yml up -d db
sleep 10

# 3. استعادة الـdump
gunzip -c /path/to/backup.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db \
  psql -U $POSTGRES_USER -d $POSTGRES_DB

# 4. تشغيل migrations
docker compose -f docker-compose.prod.yml run --rm backend \
  npx prisma migrate deploy

# 5. إعادة تشغيل الخدمات
docker compose -f docker-compose.prod.yml up -d

# 6. فحص
curl https://api.yourdomain.com/health
```

## استعادة نقطة-في-الوقت (Point-in-Time)

```bash
# 1. استعادة آخر نسخة احتياطية كاملة
# 2. استعادة WAL files (يتطلب إعدادات مسبقة)

# أو: استعادة لآخر commit
git checkout v1.0.0
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate
```

## في حالة الطوارئ

تواصل مع فريق الدعم فوراً:
- **Email**: support@albinaa.com
- **Phone**: (يُضاف)
- **Status Page**: https://status.albinaa.com

## قائمة تحقق ما بعد الاستعادة

- [ ] `curl https://api.yourdomain.com/health` يعيد status: ok
- [ ] عدد السجلات يطابق المتوقع (`SELECT COUNT(*) FROM customers`)
- [ ] تسجيل دخول admin يعمل
- [ ] السجلات (logs) تعمل بدون أخطاء
- [ ] النسخ الاحتياطي اليومي يعمل مجدداً
- [ ] الـSSL certificate لم تنته صلاحيته
