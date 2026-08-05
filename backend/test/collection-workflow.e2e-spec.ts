/**
 * اختبارات E2E — Milestone 5: Collection Workflow
 * تغطي السيناريوهات العشرة المطلوبة:
 * متابعة، وعد سداد، تنفيذ وعد، وعد متأخر، تحصيل، تحديث الرصيد التشغيلي،
 * عكس تحصيل، نقل عميل، صلاحيات المحصل، صلاحيات المدير.
 * تعتمد على بيانات fixture (العميل 90001) — تُستورد تلقائيًا إن لم تكن موجودة.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupTestCustomers } from './test-helpers';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const FIXTURE = path.join(__dirname, 'fixtures', 'fixture.xlsx');
const uniq = `m5${Date.now().toString(36)}`;

describe('Collection Workflow — Milestone 5 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let collectorToken: string;
  let checkerToken: string;
  let collectorUserId: string;
  let collectorId: string;
  let customerId: string;      // 90001
  let otherCustomerId: string; // 90003 — غير مسند للمحصل
  let followupId: string;
  let promiseId: string;
  let collectionId: string;
  let methodId: string;

  const yerBalance = () =>
    prisma.customerBalance.findFirstOrThrow({
      where: { customerId, currencyCode: 'YER' },
    });
  const operationalOf = async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${customerId}/balances`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return res.body.find((b: any) => b.currency === 'YER');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;

    // بيانات fixture — تنظيف شامل ثم استيراد لضمان بيانات نظيفة
    await cleanupTestCustomers(prisma);
    // استيراد دائمًا بعد التنظيف
    const up = await request(app.getHttpServer())
      .post('/imports/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', FIXTURE).expect(201);
    await request(app.getHttpServer())
      .post(`/imports/${up.body.jobId}/execute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ force: true }).expect(200);
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90001' } });
    customerId = c.id;
    otherCustomerId = (await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90003' },
    })).id;

    // مستخدم محصل + دور المحصل + سجل collector
    const u = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `collector_${uniq}`, fullName: 'محصل م5', password: 'Test1234pass' })
      .expect(201);
    collectorUserId = u.body.id;
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'المحصل' } });
    await request(app.getHttpServer())
      .post(`/users/${collectorUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [role.id] }).expect(201);
    collectorId = (await prisma.collector.create({ data: { userId: collectorUserId } })).id;

    const cl = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: `collector_${uniq}`, password: 'Test1234pass' }).expect(200);
    collectorToken = cl.body.accessToken;

    const checker = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `checker_${uniq}`, fullName: 'أمين صندوق م5', password: 'Test1234pass' }).expect(201);
    const cashierRole = await prisma.role.findFirstOrThrow({ where: { name: 'أمين الصندوق' } });
    await request(app.getHttpServer()).post(`/users/${checker.body.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`).send({ roleIds: [cashierRole.id] }).expect(201);
    checkerToken = (await request(app.getHttpServer()).post('/auth/login')
      .send({ username: `checker_${uniq}`, password: 'Test1234pass' }).expect(200)).body.accessToken;

    methodId = (await prisma.collectionMethod.findFirstOrThrow({ where: { name: 'نقدي' } })).id;
  });

  afterAll(async () => {
    // حماية من خطأ ثانوي يُخفي السبب الجذري إن فشلت تهيئة التطبيق (مثل رفض
    // env.validation لأسرار JWT التجريبية) قبل أن يُسنَد app أصلاً.
    if (app) {
      await app.close();
    }
  });

  // ===== 8) نقل عميل (عبر وحدة الإسناد الجديدة) =====
  it('POST /assignments يسند 90001 للمحصل ويُشعره، والتاريخ محفوظ', async () => {
    await request(app.getHttpServer())
      .post('/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, collectorId, reason: 'إسناد م5' })
      .expect(201);

    const history = await request(app.getHttpServer())
      .get(`/assignments?customerId=${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(history.body.length).toBeGreaterThanOrEqual(1);
    expect(history.body.filter((a: any) => a.effectiveTo === null).length).toBe(1);

    const notif = await prisma.notification.findFirst({
      where: { userId: collectorUserId, kind: 'customer_transferred' },
    });
    expect(notif).not.toBeNull();
  });

  // ===== 9) صلاحيات المحصل =====
  it('المحصل لا يصل لعميل غير مسند إليه ولا لإدارة المستخدمين', async () => {
    await request(app.getHttpServer())
      .get(`/customers/${otherCustomerId}`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(404); // خارج نطاقه
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(403); // بلا users.manage
  });

  // ===== 1) إنشاء متابعة =====
  it('المحصل يسجل متابعة بنتيجة إلزامية، وتظهر في Timeline', async () => {
    const type = await prisma.followupType.findFirstOrThrow({ where: { name: 'مكالمة هاتفية' } });
    const result = await prisma.followupResult.findFirstOrThrow({ where: { name: 'وعد بالسداد' } });

    const res = await request(app.getHttpServer())
      .post('/followups')
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({
        customerId, typeId: type.id, resultId: result.id,
        notes: 'اتصال — وعد بالسداد', nextFollowupDate: '2026-08-01',
        expectedAmount: 5000, expectedCurrency: 'YER',
      })
      .expect(201);
    followupId = res.body.id;

    // على عميل خارج نطاقه → مرفوض
    await request(app.getHttpServer())
      .post('/followups')
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ customerId: otherCustomerId, typeId: type.id, resultId: result.id })
      .expect(404);

    const tl = await request(app.getHttpServer())
      .get(`/customers/${customerId}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(tl.body.items.some((e: any) => e.type === 'followup')).toBe(true);
  });

  it('تعديل المتابعة ثم حذفها الناعم (السجل يبقى في القاعدة)', async () => {
    await request(app.getHttpServer())
      .patch(`/followups/${followupId}`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ notes: 'ملاحظة معدلة' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/followups/${followupId}`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(200);
    const row = await prisma.followup.findUnique({ where: { id: followupId } });
    expect(row).not.toBeNull();          // لم يُحذف فعليًا
    expect(row!.deletedAt).not.toBeNull(); // حذف ناعم فقط
    await request(app.getHttpServer())
      .get(`/followups/${followupId}`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(404); // مخفي من الواجهات
  });

  // ===== 2) إنشاء وعد سداد =====
  it('وعد سداد ينشئ مهمة تلقائية وإشعارًا ويظهر في Timeline', async () => {
    const res = await request(app.getHttpServer())
      .post('/payment-promises')
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ customerId, dueDate: '2026-08-15', expectedAmount: 5000, currencyCode: 'YER' })
      .expect(201);
    promiseId = res.body.id;

    const task = await prisma.task.findFirst({ where: { sourcePromiseId: promiseId } });
    expect(task).not.toBeNull();
    expect(task!.taskType).toBe('promise_due');

    const notif = await prisma.notification.findFirst({
      where: { userId: collectorUserId, kind: 'promise_due' },
    });
    expect(notif).not.toBeNull();

    const tl = await request(app.getHttpServer())
      .get(`/customers/${customerId}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(tl.body.items.some((e: any) => e.type === 'payment_promise')).toBe(true);
  });

  // ===== 4) وعد متأخر (المسح التلقائي) =====
  it('وعد تجاوز استحقاقه → unfulfilled تلقائيًا + تصعيد + إشعار عند نداء عمل اليوم', async () => {
    const overdue = await request(app.getHttpServer())
      .post('/payment-promises')
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ customerId, dueDate: '2026-07-01', expectedAmount: 1000, currencyCode: 'YER' })
      .expect(201);

    // نداء محرك المهام اليومي ينفذ المسح
    const today = await request(app.getHttpServer())
      .get('/tasks/today')
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(200);

    const swept = await prisma.paymentPromise.findUniqueOrThrow({
      where: { id: overdue.body.id },
    });
    expect(swept.status).toBe('unfulfilled');
    expect(swept.statusReason).toContain('تلقائي');
    const escalation = await prisma.task.findFirst({
      where: { sourcePromiseId: overdue.body.id, taskType: 'promise_escalation' },
    });
    expect(escalation).not.toBeNull();
    // البند يظهر في عمل اليوم بأولوية التصعيد
    expect(today.body.items.some((i: any) => i.reason.includes('تصعيد'))).toBe(true);
    expect(today.body.summary.tasksToday).toBeGreaterThanOrEqual(1);
    const promiseRiskAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'risk_recalculated' }, orderBy: { createdAt: 'desc' },
    });
    expect((promiseRiskAudit.newValue as any).source).toBe('promise_broken');
    expect((promiseRiskAudit.newValue as any).targetedCustomerIds).toContain(customerId);
  });

  // ===== 5+6) تسجيل تحصيل + تحديث الرصيد التشغيلي =====
  it('تحصيل 3000 YER يقيّد في الدفتر ويخفض التشغيلي (المحاسبي ثابت حتى الاستيراد)', async () => {
    const before = await operationalOf();
    expect(before.operationalBalance).toBe(before.accountingBalance); // لا قيود بعد

    const res = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({
        customerId, currencyCode: 'YER', amount: 3000,
        methodId, receiptNumber: `R-${uniq}`, notes: 'دفعة نقدية',
      })
      .expect(201);
    collectionId = res.body.id;

    const ledger = await prisma.operationalLedger.findFirst({
      where: { sourceTable: 'collections', sourceId: collectionId, entryType: 'collection' },
    });
    expect(ledger).not.toBeNull();
    expect(Number(ledger!.amountSigned)).toBe(-3000);

    const after = await operationalOf();
    expect(after.accountingBalance).toBe(before.accountingBalance);              // المرجع المحاسبي لا يُمس
    expect(after.operationalBalance).toBe(before.operationalBalance - 3000);     // التشغيلي مشتق تلقائيًا

    // مبلغ صفري/سالب مرفوض
    await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ customerId, currencyCode: 'YER', amount: 0, methodId })
      .expect(400);

    // أمين الصندوق (صلاحية cash.receive) استلم إشعار تحصيل جديد — للمدير هنا
    const notif = await prisma.notification.findFirst({ where: { kind: 'collection_created' } });
    expect(notif).not.toBeNull();
    const collectionRiskAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'risk_recalculated' }, orderBy: { createdAt: 'desc' },
    });
    expect((collectionRiskAudit.newValue as any).source).toBe('collection_created');
    expect((collectionRiskAudit.newValue as any).targetedCustomerIds).toContain(customerId);
  });

  it('يقفل الشهر على التحصيل المؤرخ ويقصر التجاوز على صلاحية خاصة وسبب موثق', async () => {
    const period = await request(app.getHttpServer()).post('/accounting-periods/lock')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year: 2025, month: 1, reason: 'إقفال اختبار يناير' }).expect(201);
    const body = { customerId, collectorId, currencyCode: 'YER', amount: 25, methodId, collectedAt: '2025-01-15T10:00:00.000Z' };
    await request(app.getHttpServer()).post('/collections').set('Authorization', `Bearer ${collectorToken}`).send(body).expect(403);
    await request(app.getHttpServer()).post('/collections').set('Authorization', `Bearer ${adminToken}`).send(body).expect(400);
    await request(app.getHttpServer()).post('/collections').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...body, accountingOverrideReason: 'تصحيح معتمد بعد الإقفال' }).expect(201);
    const overrideAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'accounting_period_overridden' }, orderBy: { createdAt: 'desc' } });
    expect(overrideAudit.reason).toBe('تصحيح معتمد بعد الإقفال');
    await request(app.getHttpServer()).post(`/accounting-periods/${period.body.id}/unlock`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'إنهاء اختبار القفل' }).expect(201);
  });

  it('تنفيذ الوعد يغلق مهمته، والتحصيل يظهر في Timeline', async () => {
    // ===== 3) تنفيذ وعد =====
    await request(app.getHttpServer())
      .patch(`/payment-promises/${promiseId}/status`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ status: 'fulfilled' })
      .expect(200);
    const task = await prisma.task.findFirst({ where: { sourcePromiseId: promiseId } });
    expect(task!.status).toBe('done');

    const tl = await request(app.getHttpServer())
      .get(`/customers/${customerId}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(tl.body.items.some((e: any) => e.type === 'collection')).toBe(true);
  });

  // ===== 7) عكس تحصيل =====
  it('العكس بسبب موثق يعيد التشغيلي، والحذف/التكرار ممنوعان، والمحصل بلا صلاحية العكس', async () => {
    // المحصل لا يملك collections.reverse
    await request(app.getHttpServer())
      .post(`/collections/${collectionId}/reverse`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .send({ reason: 'خطأ إدخال' })
      .expect(403);

    const before = await operationalOf();
    const requested = await request(app.getHttpServer())
      .post(`/collections/${collectionId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'خطأ في المبلغ' })
      .expect(200);
    expect(requested.body.status).toBe('pending');
    await request(app.getHttpServer())
      .post(`/collections/reconciliation/reversal-requests/${requested.body.requestId}/review`)
      .set('Authorization', `Bearer ${adminToken}`).send({ approve: true }).expect(403);
    const res = await request(app.getHttpServer())
      .post(`/collections/reconciliation/reversal-requests/${requested.body.requestId}/review`)
      .set('Authorization', `Bearer ${checkerToken}`).send({ approve: true }).expect(200);
    expect(res.body.reversal).toBeDefined();

    const after = await operationalOf();
    expect(after.operationalBalance).toBe(before.operationalBalance + 3000); // القيد المعاكس

    const original = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    expect(original.status).toBe('reversed');
    expect(original.reversedById).toBe(res.body.reversal);

    // عكس معكوس → 409
    await request(app.getHttpServer())
      .post(`/collections/${collectionId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'تكرار' })
      .expect(409);

    // الحذف الفعلي ممنوع بـ Trigger في القاعدة
    await expect(
      prisma.collection.delete({ where: { id: collectionId } }),
    ).rejects.toThrow();
  });

  // ===== لوحة المحصل =====
  it('Collector Dashboard يعرض أرقام المحصل مفصولة بالعملة', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/collector')
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(200);
    expect(res.body.assignedCustomers).toBe(1);
    expect(res.body.collectionsThisWeek).toBeDefined();
    expect(res.body.outstandingByCurrency).toBeDefined();
    expect(res.body.overduePromises).toBeDefined();
  });

  // ===== 10) صلاحيات المدير =====
  it('المدير يرى كل الوعود والتحصيلات ولوحة أي محصل؛ وعمليات M5 كلها في Audit', async () => {
    const promises = await request(app.getHttpServer())
      .get('/payment-promises')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(promises.body.total).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .get(`/dashboard/collector?collectorId=${collectorId}`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);

    // والمحصل ممنوع من لوحة محصل آخر بالمعامل
    await request(app.getHttpServer())
      .get(`/dashboard/collector?collectorId=${collectorId}`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(403);

    for (const action of [
      'followup_created', 'followup_updated', 'followup_soft_deleted',
      'promise_created', 'promise_status_changed',
      'collection_created', 'collection_reversed', 'customer_reassigned',
    ]) {
      const count = await prisma.auditLog.count({ where: { action } });
      expect(count).toBeGreaterThan(0);
    }
  });

  // ===== الإشعارات API =====
  it('GET /notifications يعرض إشعارات المحصل مع عدّاد غير المقروء، والقراءة تعمل', async () => {
    const list = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(200);
    expect(list.body.unread).toBeGreaterThanOrEqual(1);
    const first = list.body.items[0];
    await request(app.getHttpServer())
      .patch(`/notifications/${first.id}/read`)
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(200);
    const after = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${collectorToken}`)
      .expect(200);
    expect(after.body.unread).toBe(list.body.unread - 1);
  });
});
