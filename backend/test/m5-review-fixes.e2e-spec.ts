/**
 * اختبارات E2E — تصحيحات مراجعة Milestone 5
 * تثبت البنود: (2) شرط الإسناد الحالي للوعد والتحصيل، (3) ذرية إنشاء الوعد،
 * (4) مزامنة تاريخ المهمة مع تعديل الاستحقاق، (5) State Machine الكاملة،
 * (6) التحقق الكامل من الفرع، (7) حماية العكس من التزامن.
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
const uniq = `mr${Date.now().toString(36)}`;

describe('M5 Review Fixes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let collectorToken: string;
  let collectorId: string;
  let assignedCustomerId: string;    // 90001 — مسند للمحصل
  let unassignedCustomerId: string;  // 90003 — غير مسند
  let methodId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;

    let c = await prisma.customer.findFirst({ where: { externalCustomerCode: '90001' } });
    if (!c) {
      const up = await request(app.getHttpServer())
        .post('/imports/upload').set('Authorization', `Bearer ${adminToken}`)
        .attach('file', FIXTURE).expect(201);
      await request(app.getHttpServer())
        .post(`/imports/${up.body.jobId}/execute`)
        .set('Authorization', `Bearer ${adminToken}`).send({ force: true }).expect(200);
      c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90001' } });
    }
    assignedCustomerId = c.id;
    unassignedCustomerId = (await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90003' },
    })).id;

    const u = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `rev_${uniq}`, fullName: 'محصل المراجعة', password: 'Test1234pass' })
      .expect(201);
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'المحصل' } });
    await request(app.getHttpServer())
      .post(`/users/${u.body.id}/roles`).set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [role.id] }).expect(201);
    collectorId = (await prisma.collector.create({ data: { userId: u.body.id } })).id;

    await request(app.getHttpServer())
      .post('/assignments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: assignedCustomerId, collectorId, reason: 'اختبار المراجعة' })
      .expect(201);

    collectorToken = (await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: `rev_${uniq}`, password: 'Test1234pass' }).expect(200)).body.accessToken;

    methodId = (await prisma.collectionMethod.findFirstOrThrow({ where: { name: 'نقدي' } })).id;
  });

  afterAll(async () => {
    // حماية من خطأ ثانوي يُخفي السبب الجذري إن فشلت تهيئة التطبيق (مثل رفض
    // env.validation لأسرار JWT التجريبية) قبل أن يُسنَد app أصلاً.
    if (app) {
      await app.close();
    }
  });

  // ===== البند ثانيًا: شرط الإسناد الحالي =====
  describe('شرط الإسناد الحالي (البند 2)', () => {
    it('يرفض وعدًا لعميل غير مسند للمحصل (403)', async () => {
      await request(app.getHttpServer())
        .post('/payment-promises')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ customerId: unassignedCustomerId, dueDate: '2026-08-10', expectedAmount: 500, currencyCode: 'YER' })
        .expect(403);
    });

    it('يرفض تحصيلاً لعميل غير مسند للمحصل (403)', async () => {
      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ customerId: unassignedCustomerId, currencyCode: 'YER', amount: 100, methodId })
        .expect(403);
    });

    it('يرفض حتى من المدير التسجيل نيابةً عن محصل بلا إسناد ساري (403)', async () => {
      await request(app.getHttpServer())
        .post('/payment-promises')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: unassignedCustomerId, collectorId,
          dueDate: '2026-08-10', expectedAmount: 500, currencyCode: 'YER',
        })
        .expect(403);
    });

    it('المدير ينجح نيابةً عن المحصل عندما يكون الإسناد ساريًا', async () => {
      const res = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: assignedCustomerId, collectorId,
          currencyCode: 'YER', amount: 250, methodId, notes: 'نيابةً بموجب صلاحية إشرافية',
        })
        .expect(201);
      expect(res.body.collectorId).toBe(collectorId);
    });
  });

  // ===== البند ثالثًا: ذرية الوعد + مهمته =====
  describe('ذرية إنشاء الوعد (البند 3)', () => {
    it('الوعد ومهمته يُنشآن معًا — ولا يوجد أي وعد بلا مهمة في القاعدة', async () => {
      const res = await request(app.getHttpServer())
        .post('/payment-promises')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ customerId: assignedCustomerId, dueDate: '2026-08-15', expectedAmount: 2000, currencyCode: 'YER' })
        .expect(201);
      const task = await prisma.task.findFirst({ where: { sourcePromiseId: res.body.id } });
      expect(task).not.toBeNull();

      // فحص شامل: كل وعد في القاعدة له مهمة مصدرها هو (لا حالة جزئية إطلاقًا)
      const promises = await prisma.paymentPromise.findMany({ select: { id: true } });
      for (const p of promises) {
        const t = await prisma.task.count({ where: { sourcePromiseId: p.id } });
        expect(t).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ===== البند رابعًا: مزامنة dueDate =====
  describe('تعديل تاريخ الاستحقاق (البند 4)', () => {
    let promiseId: string;
    beforeAll(async () => {
      promiseId = (await request(app.getHttpServer())
        .post('/payment-promises')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ customerId: assignedCustomerId, dueDate: '2026-08-20', expectedAmount: 3000, currencyCode: 'YER' })
        .expect(201)).body.id;
    });

    it('تعديل dueDate يحدّث مهمة promise_due المفتوحة ويعيد حساب الحالة', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/payment-promises/${promiseId}`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ dueDate: '2026-09-01' })
        .expect(200);
      expect(res.body.status).toBe('upcoming');
      const task = await prisma.task.findFirstOrThrow({
        where: { sourcePromiseId: promiseId, taskType: 'promise_due', status: 'open' },
      });
      expect(task.dueDate.toISOString().slice(0, 10)).toBe('2026-09-01');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'promise_updated', entityId: promiseId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.oldValue).toBeTruthy(); // التاريخ القديم مسجل
      expect(audit!.newValue).toBeTruthy(); // والجديد
    });

    it('تاريخ استحقاق ماضٍ يُرفض مباشرة (400) برسالة توجيهية', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/payment-promises/${promiseId}`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ dueDate: '2026-01-01' })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('ماضٍ');
    });
  });

  // ===== البند خامسًا: State Machine =====
  describe('آلة حالات الوعد (البند 5)', () => {
    const newPromise = async () =>
      (await request(app.getHttpServer())
        .post('/payment-promises')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ customerId: assignedCustomerId, dueDate: '2026-08-25', expectedAmount: 10000, currencyCode: 'YER' })
        .expect(201)).body.id;

    it('partially_fulfilled بلا مبلغ → 400، وبمبلغ >= المتوقع → 400', async () => {
      const id = await newPromise();
      await request(app.getHttpServer())
        .patch(`/payment-promises/${id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'partially_fulfilled' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/payment-promises/${id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'partially_fulfilled', fulfilledAmount: 10000 })
        .expect(400);
    });

    it('تنفيذ جزئي بمبلغ صحيح يخزّن القيمة، ثم الإتمام إلى fulfilled مسموح، وبعدها كل انتقال 409', async () => {
      const id = await newPromise();
      const partial = await request(app.getHttpServer())
        .patch(`/payment-promises/${id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'partially_fulfilled', fulfilledAmount: 4000 })
        .expect(200);
      expect(Number(partial.body.fulfilledAmount)).toBe(4000);

      await request(app.getHttpServer())
        .patch(`/payment-promises/${id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'fulfilled' })
        .expect(200);

      // نهائي: أي انتقال آخر مرفوض 409
      for (const status of ['unfulfilled', 'postponed', 'partially_fulfilled']) {
        await request(app.getHttpServer())
          .patch(`/payment-promises/${id}/status`)
          .set('Authorization', `Bearer ${collectorToken}`)
          .send({ status, reason: 'x', fulfilledAmount: 1, newDueDate: '2026-12-01' })
          .expect(409);
      }
      // والتعديل على نهائي مرفوض أيضًا
      await request(app.getHttpServer())
        .patch(`/payment-promises/${id}`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ notes: 'محاولة تعديل نهائي' })
        .expect(409);
    });

    it('postponed بلا newDueDate → 400؛ والتأجيل الصحيح يحدّث الاستحقاق والمهمة ولا يبقى راكدًا', async () => {
      const id = await newPromise();
      await request(app.getHttpServer())
        .patch(`/payment-promises/${id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'postponed', reason: 'طلب العميل' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .patch(`/payment-promises/${id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'postponed', reason: 'طلب العميل', newDueDate: '2026-09-15' })
        .expect(200);
      // لا يبقى postponed: الحالة الفعالة تحسب من الموعد الجديد
      expect(res.body.status).toBe('upcoming');
      expect(res.body.dueDate.slice(0, 10)).toBe('2026-09-15');
      const task = await prisma.task.findFirstOrThrow({
        where: { sourcePromiseId: id, taskType: 'promise_due', status: 'open' },
      });
      expect(task.dueDate.toISOString().slice(0, 10)).toBe('2026-09-15');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'promise_postponed', entityId: id },
      });
      expect(audit).not.toBeNull(); // الحدث في Audit (وبالتالي في Timeline)
    });
  });

  // ===== البند سادسًا: التحقق من الفرع =====
  describe('التحقق الكامل من الفرع (البند 6)', () => {
    it('فرع من منشأة أخرى يُرفض 400 رغم صحة الـ UUID شكليًا', async () => {
      const otherOrg = await prisma.organization.create({ data: { name: `منشأة أخرى ${uniq}` } });
      const foreignBranch = await prisma.branch.create({
        data: { organizationId: otherOrg.id, name: 'فرع خارجي' },
      });
      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({
          customerId: assignedCustomerId, currencyCode: 'YER', amount: 100,
          methodId, branchId: foreignBranch.id,
        })
        .expect(400);
    });

    it('فرع معطل يُرفض 400', async () => {
      const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
      const disabled = await prisma.branch.create({
        data: { organizationId: admin.organizationId, name: `فرع معطل ${uniq}`, active: false },
      });
      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({
          customerId: assignedCustomerId, currencyCode: 'YER', amount: 100,
          methodId, branchId: disabled.id,
        })
        .expect(400);
    });
  });

  // ===== البند سابعًا: حماية العكس من التزامن =====
  describe('عكس التحصيل الآمن من التزامن (البند 7)', () => {
    it('محاولتا عكس متزامنتان: واحدة تنجح والأخرى 409، بلا سجل مرآة أو قيد دفتر إضافي', async () => {
      const col = (await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ customerId: assignedCustomerId, currencyCode: 'YER', amount: 777, methodId })
        .expect(201)).body;

      const reverse = () =>
        request(app.getHttpServer())
          .post(`/collections/${col.id}/reverse`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ reason: 'اختبار تزامن' });

      // إطلاق متوازٍ حقيقي
      const [r1, r2] = await Promise.all([reverse(), reverse()]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);

      // قيد دفتر عكسي واحد فقط (القيد الفريد في القاعدة هو الصمام)
      const ledgerCount = await prisma.operationalLedger.count({
        where: { sourceTable: 'collections', sourceId: col.id, entryType: 'collection_reversal' },
      });
      expect(ledgerCount).toBe(1);
      // سجل مرآة واحد فقط
      const mirrors = await prisma.collection.count({
        where: { notes: { contains: col.id } },
      });
      expect(mirrors).toBe(1);
      // ومحاولة لاحقة ثالثة أيضًا 409
      await reverse().then((r) => expect(r.status).toBe(409));
    });
  });
});
