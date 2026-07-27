/**
 * اختبارات E2E — تصحيحات مراجعة Dashboard (Milestone 6):
 * 1) GET /tasks/today لا يُلقي 403/404 لحساب إداري بلا سجل محصل شخصي —
 *    يعيد 200 بنتيجة فارغة مميزة (isCollector=false).
 * 2) فلتر تحصيلات fromDate/toDate يشمل تحصيلات اليوم فعليًا (حدود بتوقيت
 *    المنشأة +03:00، ونهاية غير شاملة عبر بداية اليوم التالي).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const FIXTURE = path.join(__dirname, 'fixtures', 'fixture.xlsx');
const uniq = `dr${Date.now().toString(36)}`;

describe('Dashboard Review Fixes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminUserId: string;
  let customerId: string;
  let methodId: string;
  let collectorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;
    adminUserId = (await prisma.user.findFirstOrThrow({ where: { username: 'admin' } })).id;

    if (!(await prisma.customer.findFirst({ where: { externalCustomerCode: '90001' } }))) {
      const up = await request(app.getHttpServer())
        .post('/imports/upload').set('Authorization', `Bearer ${adminToken}`)
        .attach('file', FIXTURE).expect(201);
      await request(app.getHttpServer())
        .post(`/imports/${up.body.jobId}/execute`)
        .set('Authorization', `Bearer ${adminToken}`).send({ force: true }).expect(200);
    }
    customerId = (await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90001' } })).id;
    methodId = (await prisma.collectionMethod.findFirstOrThrow({ where: { name: 'نقدي' } })).id;

    // محصل ثابت لكل اختبارات هذا الملف + إسناد العميل إليه
    const cu = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `drcollector_${uniq}`, fullName: 'محصل اختبار المراجعة', password: 'Test1234pass' })
      .expect(201);
    const collectorRole = await prisma.role.findFirstOrThrow({ where: { name: 'المحصل' } });
    await request(app.getHttpServer())
      .post(`/users/${cu.body.id}/roles`).set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [collectorRole.id] }).expect(201);
    collectorId = (await prisma.collector.create({ data: { userId: cu.body.id } })).id;

    await request(app.getHttpServer())
      .post('/assignments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, collectorId, reason: 'إعداد اختبارات مراجعة Dashboard' })
      .expect(201);
  });

  afterAll(async () => {
    // حماية من خطأ ثانوي يُخفي السبب الجذري إن فشلت تهيئة التطبيق (مثل رفض
    // env.validation لأسرار JWT التجريبية) قبل أن يُسنَد app أصلاً.
    if (app) {
      await app.close();
    }
  });

  describe('/tasks/today — حساب إداري بلا سجل محصل شخصي', () => {
    it('يعيد 200 بنتيجة فارغة مميزة (isCollector=false) لا 403 ولا 404', async () => {
      const ownCollector = await prisma.collector.findUnique({ where: { userId: adminUserId } });
      expect(ownCollector).toBeNull(); // تأكيد أن admin ليس محصلاً في هذا السياق

      const res = await request(app.getHttpServer())
        .get('/tasks/today')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.isCollector).toBe(false);
      expect(res.body.collectorId).toBeNull();
      expect(res.body.items).toEqual([]);
      expect(res.body.summary.tasksToday).toBe(0);
    });

    it('لا يزال يرفض 403 عند تمرير collectorId بلا صلاحية إشرافية (خطأ صلاحية حقيقي)', async () => {
      const u = await request(app.getHttpServer())
        .post('/users').set('Authorization', `Bearer ${adminToken}`)
        .send({ username: `norights_${uniq}`, fullName: 'بلا صلاحيات', password: 'Test1234pass' })
        .expect(201);
      const limitedRole = await prisma.role.create({
        data: { organizationId: u.body.organizationId, name: `دور محدود ${uniq}`, isSystem: false },
      });
      const tasksPerm = await prisma.permission.findFirstOrThrow({ where: { code: 'tasks.manage' } });
      await prisma.rolePermission.create({ data: { roleId: limitedRole.id, permissionId: tasksPerm.id } });
      await prisma.userRole.create({ data: { userId: u.body.id, roleId: limitedRole.id, grantedBy: adminUserId } });

      const login = await request(app.getHttpServer())
        .post('/auth/login').send({ username: `norights_${uniq}`, password: 'Test1234pass' }).expect(200);

      await request(app.getHttpServer())
        .get(`/tasks/today?collectorId=${collectorId}`)
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(403); // غياب صلاحية فعلي — يبقى 403 كما يجب
    });

    it('لا يزال يرفض 404 لمعرّف محصل غير موجود (خطأ فعلي، لا يتأثر بالتصحيح)', async () => {
      await request(app.getHttpServer())
        .get('/tasks/today?collectorId=00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('محصل حقيقي يستمر بالحصول على isCollector=true وبيانات فعلية', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login').send({ username: `drcollector_${uniq}`, password: 'Test1234pass' }).expect(200);
      const res = await request(app.getHttpServer())
        .get('/tasks/today')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(res.body.isCollector).toBe(true);
      expect(res.body.collectorId).toBe(collectorId);
    });
  });

  describe('فلتر تحصيلات fromDate/toDate (حدود اليوم بتوقيت المنشأة)', () => {
    it('تحصيل مُسجَّل الآن يظهر فعليًا عند فلترة fromDate=toDate=اليوم', async () => {
      const created = await request(app.getHttpServer())
        .post('/collections').set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId, collectorId, currencyCode: 'YER', amount: 42, methodId,
          notes: `اختبار حدود اليوم ${uniq}`,
        })
        .expect(201);

      // تاريخ اليوم بتوقيت المنشأة (+03:00) — كما ترسله الواجهة فعليًا
      const todayLocal = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

      const res = await request(app.getHttpServer())
        .get(`/collections?fromDate=${todayLocal}&toDate=${todayLocal}&limit=50`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const found = res.body.items.find((c: any) => c.id === created.body.id);
      expect(found).toBeDefined(); // كان يُستبعد قبل التصحيح (الخطأ المُبلَّغ عنه)
      expect(res.body.totalsByCurrency.YER).toBeGreaterThanOrEqual(42);
    });

    it('تحصيل بالأمس لا يظهر عند فلترة اليوم فقط (النهاية غير شاملة صحيحة)', async () => {
      const yesterday = new Date(Date.now() - 24 * 3_600_000);
      const backdated = await prisma.collection.create({
        data: {
          customerId, collectorId, currencyCode: 'YER',
          amount: 77, collectedAt: yesterday, methodId, status: 'recorded',
          notes: `اختبار الأمس ${uniq}`,
        },
      });

      const todayLocal = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
      const res = await request(app.getHttpServer())
        .get(`/collections?fromDate=${todayLocal}&toDate=${todayLocal}&limit=50`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.find((c: any) => c.id === backdated.id)).toBeUndefined();
    });
  });
});
