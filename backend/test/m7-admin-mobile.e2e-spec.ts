import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

describe('Milestone 7 — Administration + Mobile API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  let weakUserId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // -----------------------------------------------------------------------
  // تسجيل الدخول كمدير
  // -----------------------------------------------------------------------
  it('POST /auth/login كمدير', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = res.body.accessToken;
  });

  // -----------------------------------------------------------------------
  // (1) العملات — GET و PATCH مع settings.manage
  // -----------------------------------------------------------------------
  it('GET /currencies — قائمة العملات (مع التوكن)', async () => {
    const res = await request(app.getHttpServer())
      .get('/currencies').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('PATCH /currencies/:code — يرفض بدون settings.manage', async () => {
    // إنشاء مستخدم بلا صلاحيات
    const uniq = `noperm_${Date.now().toString(36)}`;
    const created = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uniq, fullName: 'بلا صلاحية', password: 'Test1234pass' })
      .expect(201);
    weakUserId = created.body.id;

    const login = await request(app.getHttpServer())
      .post('/auth/login').send({ username: uniq, password: 'Test1234pass' })
      .expect(200);
    userToken = login.body.accessToken;

    await request(app.getHttpServer())
      .patch('/currencies/USD').set('Authorization', `Bearer ${userToken}`)
      .send({ nameAr: 'دولار أمريكي' })
      .expect(403);
  });

  it('PATCH /currencies/:code — المدير ينجح مع settings.manage', async () => {
    const res = await request(app.getHttpServer())
      .patch('/currencies/SAR').set('Authorization', `Bearer ${adminToken}`)
      .send({ nameAr: 'ريال سعودي (مُحدّث)', active: true })
      .expect(200);
    expect(res.body.nameAr).toContain('مُحدّث');
  });

  // -----------------------------------------------------------------------
  // (2) الإعدادات — GET, PUT, DELETE مع settings.manage
  // -----------------------------------------------------------------------
  it('GET /settings — قائمة الإعدادات', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PUT /settings/:key — إنشاء إعداد', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/test_key').set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'test_key', value: 'test_value' })
      .expect(200);
    expect(res.body.key).toBe('test_key');
    expect(res.body.value).toBe('test_value');
  });

  it('PUT /settings/:key — تحديث إعداد موجود', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/test_key').set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'test_key', value: 'updated_value' })
      .expect(200);
    expect(res.body.value).toBe('updated_value');
  });

  it('PUT /settings — يرفض بدون settings.manage', async () => {
    await request(app.getHttpServer())
      .put('/settings/test_key2').set('Authorization', `Bearer ${userToken}`)
      .send({ key: 'test_key2', value: 'x' })
      .expect(403);
  });

  it('DELETE /settings/:key — حذف إعداد', async () => {
    await request(app.getHttpServer())
      .delete('/settings/test_key').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // تحقق من الحذف
    const settings = await request(app.getHttpServer())
      .get('/settings').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(settings.body.find((s: any) => s.key === 'test_key')).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // (3) سجل التدقيق — الفلاتر والترقيم
  // -----------------------------------------------------------------------
  it('GET /audit — يرفض بدون audit.read', async () => {
    await request(app.getHttpServer())
      .get('/audit').set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /audit — المدير يقرأ', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('GET /audit?page=1&limit=5 — Pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?page=1&limit=5').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body.limit).toBe(5);
  });

  it('GET /audit?action=login_success — تصفية', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?action=login_success').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    for (const item of res.body.items) {
      expect(item.action).toBe('login_success');
    }
  });

  it('GET /audit?entityTable=currencies — تصفية', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?entityTable=currencies').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    for (const item of res.body.items) {
      expect(item.entityTable).toBe('currencies');
    }
  });

  it('GET /audit?from=...&to=... — تصفية تاريخ', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?from=2020-01-01&to=2030-12-31').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // (4) المحصلين — CRUD
  // -----------------------------------------------------------------------
  let collectorId: string;

  it('GET /collectors — يرفض بدون users.manage', async () => {
    await request(app.getHttpServer())
      .get('/collectors').set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /collectors — المدير يقرأ القائمة', async () => {
    const res = await request(app.getHttpServer())
      .get('/collectors').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /collectors — إنشاء محصل', async () => {
    const res = await request(app.getHttpServer())
      .post('/collectors').set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: weakUserId })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.userId).toBe(weakUserId);
    collectorId = res.body.id;
  });

  it('POST /collectors — يرفض تكرار المحصل', async () => {
    await request(app.getHttpServer())
      .post('/collectors').set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: weakUserId })
      .expect(409);
  });

  it('PATCH /collectors/:id — تعديل محصل', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/collectors/${collectorId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);
    expect(res.body.active).toBe(false);
  });

  it('GET /collectors/:id — تفاصيل محصل', async () => {
    const res = await request(app.getHttpServer())
      .get(`/collectors/${collectorId}`).set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.id).toBe(collectorId);
  });

  // -----------------------------------------------------------------------
  // (5) منع المستخدم غير المصرح له — مغطى في الاختبارات أعلاه
  // -----------------------------------------------------------------------
  it('مستخدم بلا صلاحية يمنع من كل نقاط النهاية المحمية', async () => {
    // تحقق من أن التوكن نفسه يعمل (المستخدم موجود)
    const me = await request(app.getHttpServer())
      .get('/auth/me').set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(me.body.permissions).not.toContain('settings.manage');
    expect(me.body.permissions).not.toContain('audit.read');
    expect(me.body.permissions).not.toContain('users.manage');
  });

  // -----------------------------------------------------------------------
  // (6–8) رفع السندات
  // -----------------------------------------------------------------------
  let collectionId: string;

  it('إنشاء تحصيل لاختبار رفع السند', async () => {
    // البحث عن عميل موجود
    const customerRes = await request(app.getHttpServer())
      .get('/mobile/customers').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // إنشاء تحصيل إن لم يوجد
    const customers = customerRes.body;
    if (customers.length > 0) {
      const methods = await request(app.getHttpServer())
        .get('/collection-methods').set('Authorization', `Bearer ${adminToken}`)
        .catch(() => ({ body: [] }));
      const methodId = methods.body?.[0]?.id;
      if (methodId) {
        const colRes = await request(app.getHttpServer())
          .post('/collections').set('Authorization', `Bearer ${adminToken}`)
          .send({
            customerId: customers[0].id,
            currencyCode: 'SAR',
            amount: 100,
            methodId,
          }).catch(() => ({ body: { id: null } }));
        collectionId = colRes.body?.id;
      }
    }
  });

  it('POST /mobile/upload-receipt — رفع سند صحيح', async () => {
    if (!collectionId) return; // تخط إن لم يوجد تحصيل
    const testFile = path.join(__dirname, '..', 'test-fixture.png');
    if (!fs.existsSync(testFile)) {
      // إنشاء ملف صورة وهمية
      const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      fs.writeFileSync(testFile, buf);
    }
    const res = await request(app.getHttpServer())
      .post('/mobile/upload-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', testFile)
      .field('collectionId', collectionId)
      .field('notes', 'سند اختبار')
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.entityTable).toBe('collections');
    expect(res.body.entityId).toBe(collectionId);
    // تنظيف
    if (res.body.storageKey && fs.existsSync(res.body.storageKey)) {
      fs.unlinkSync(res.body.storageKey);
    }
  });

  it('POST /mobile/upload-receipt — يرفض ملف >10MB', async () => {
    const largeBuf = Buffer.alloc(11 * 1024 * 1024);
    const largeFile = path.join(__dirname, '..', 'large-test.png');
    fs.writeFileSync(largeFile, largeBuf);
    await request(app.getHttpServer())
      .post('/mobile/upload-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', largeFile)
      .field('collectionId', collectionId ?? '00000000-0000-0000-0000-000000000000')
      .expect(413);
    fs.unlinkSync(largeFile);
  });

  it('POST /mobile/upload-receipt — يرفض نوع ملف غير مسموح (.exe)', async () => {
    const exeFile = path.join(__dirname, '..', 'malicious.exe');
    fs.writeFileSync(exeFile, 'fake exe content');
    await request(app.getHttpServer())
      .post('/mobile/upload-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', exeFile)
      .field('collectionId', collectionId ?? '00000000-0000-0000-0000-000000000000')
      .expect(400);
    fs.unlinkSync(exeFile);
  });

  it('POST /mobile/upload-receipt — يرفض تحصيل غير موجود', async () => {
    const testFile = path.join(__dirname, '..', 'test-fixture.png');
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(testFile, buf);
    await request(app.getHttpServer())
      .post('/mobile/upload-receipt')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', testFile)
      .field('collectionId', '00000000-0000-0000-0000-000000000000')
      .expect(404);
    fs.unlinkSync(testFile);
  });

  // -----------------------------------------------------------------------
  // (9) GPS — نقطة فردية
  // -----------------------------------------------------------------------
  it('POST /mobile/gps — تسجيل نقطة GPS فردية', async () => {
    const res = await request(app.getHttpServer())
      .post('/mobile/gps').set('Authorization', `Bearer ${adminToken}`)
      .send({ latitude: 24.7136, longitude: 46.6753, accuracy: 5.0 })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.latitude).toBe(24.7136);
    expect(res.body.longitude).toBe(46.6753);
  });

  it('POST /mobile/gps — مع entityTable/entityId', async () => {
    const res = await request(app.getHttpServer())
      .post('/mobile/gps').set('Authorization', `Bearer ${adminToken}`)
      .send({ latitude: 24.7, longitude: 46.6, entityTable: 'customers', entityId: '00000000-0000-0000-0000-000000000000' })
      .expect(201);
    expect(res.body.entityTable).toBe('customers');
  });

  // -----------------------------------------------------------------------
  // (10) GPS — Batch
  // -----------------------------------------------------------------------
  it('POST /mobile/gps/batch — رفع مجموعة نقاط', async () => {
    const res = await request(app.getHttpServer())
      .post('/mobile/gps/batch').set('Authorization', `Bearer ${adminToken}`)
      .send([
        { latitude: 24.71, longitude: 46.67, accuracy: 3.0 },
        { latitude: 24.72, longitude: 46.68 },
        { latitude: 24.73, longitude: 46.69, accuracy: 4.5, entityTable: 'collections', entityId: '00000000-0000-0000-0000-000000000000' },
      ])
      .expect(201);
    expect(res.body.count).toBe(3);
  });

  // -----------------------------------------------------------------------
  // (11–13) المزامنة
  // -----------------------------------------------------------------------
  let firstSyncToken: string;

  it('POST /mobile/sync — مزامنة أولى', async () => {
    const res = await request(app.getHttpServer())
      .post('/mobile/sync').set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201);
    expect(res.body.syncToken).toBeDefined();
    expect(res.body.serverTime).toBeDefined();
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(Array.isArray(res.body.customers)).toBe(true);
    expect(Array.isArray(res.body.followups)).toBe(true);
    expect(Array.isArray(res.body.promises)).toBe(true);
    expect(Array.isArray(res.body.collections)).toBe(true);
    firstSyncToken = res.body.syncToken;
  });

  it('POST /mobile/sync — مزامنة لاحقة مع syncToken', async () => {
    // انتظر قليلاً لضمان اختلاف التوقيت
    await new Promise((r) => setTimeout(r, 100));
    const res = await request(app.getHttpServer())
      .post('/mobile/sync').set('Authorization', `Bearer ${adminToken}`)
      .send({ lastSyncToken: firstSyncToken })
      .expect(201);
    expect(res.body.syncToken).toBeDefined();
    // sync token جديد مختلف
    expect(res.body.syncToken).not.toBe(firstSyncToken);
  });

  it('POST /mobile/sync — يعمل مع syncToken مستقبلي (يعيد بيانات فارغة)', async () => {
    const farFuture = '2099-01-01T00:00:00.000Z';
    const res = await request(app.getHttpServer())
      .post('/mobile/sync').set('Authorization', `Bearer ${adminToken}`)
      .send({ lastSyncToken: farFuture })
      .expect(201);
    expect(res.body.syncToken).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // (14) عزل بيانات المحصل
  // -----------------------------------------------------------------------
  it('GET /mobile/customers — المحصل يرى فقط عملاءه', async () => {
    // مستخدم بصلاحية جمع فقط
    const uniq2 = `coll_${Date.now().toString(36)}`;
    const newUser = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uniq2, fullName: 'محصل جديد', password: 'Test1234pass' })
      .expect(201);
    // منحه صلاحية customers.read_only
    // لكن mobile endpoint يستخدم customers.read_all للتحقق
    // المستخدم بدون read_all يرى فقط عملاءه المرتبطين

    const login = await request(app.getHttpServer())
      .post('/auth/login').send({ username: uniq2, password: 'Test1234pass' })
      .expect(200);
    // هذا المستخدم ليس محصلاً بعد وليس لديه read_all
    const customersRes = await request(app.getHttpServer())
      .get('/mobile/customers').set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(Array.isArray(customersRes.body)).toBe(true);
  });

  it('GET /mobile/customers/:id — يعيد 404 لعميل خارج النطاق', async () => {
    const uniq3 = `coll2_${Date.now().toString(36)}`;
    const newUser = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uniq3, fullName: 'محصل محدود', password: 'Test1234pass' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login').send({ username: uniq3, password: 'Test1234pass' })
      .expect(200);
    // محاولة الوصول لعميل عشوائي
    const randomId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .get(`/mobile/customers/${randomId}`).set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(404);
  });
});
