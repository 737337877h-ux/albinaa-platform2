/**
 * اختبارات E2E — Milestone 4: Customer Domain + Dashboard
 * تعتمد على بيانات fixture.xlsx المستوردة (تشغّل اختبارات M3 أولاً أو
 * تستورد الـ fixture بنفسها إن لم تكن مستوردة).
 * كل الأرقام المتوقعة مؤكدة بمحاكاة محلية مسبقة (simulate_m4).
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
const uniq = Date.now().toString(36);

describe('Customer Domain — Milestone 4 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let cust90001Id: string;
  let collectorUserToken: string;
  let collectorId: string;
  let otherCollectorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;

    // تنظيف بيانات الاختبار القديمة واستيراد جديد لضمان بيانات نظيفة ومستقرة
    await cleanupTestCustomers(prisma);
    // استيراد دائمًا بعد التنظيف لضمان بيانات كاملة ومضمونة
    const up = await request(app.getHttpServer())
      .post('/imports/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', FIXTURE)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/imports/${up.body.jobId}/execute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ force: true })
      .expect(200);
    const c = await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90001' },
    });
    cust90001Id = c.id;

    // محصل ثانٍ لاختبار العزل (لا يلمس فك الإسناد مهامه)
    const userB = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `m4collectorB_${uniq}`, fullName: 'محصل م4ب', password: 'Test1234pass' })
      .expect(201);
    otherCollectorId = (await prisma.collector.create({ data: { userId: userB.body.id } })).id;
  });

  afterAll(async () => {
    // حماية من خطأ ثانوي يُخفي السبب الجذري إن فشلت تهيئة التطبيق (مثل رفض
    // env.validation لأسرار JWT التجريبية) قبل أن يُسنَد app أصلاً.
    if (app) {
      await app.close();
    }
  });

  // ==========================================================================
  // القائمة: بحث + تصفية + ترتيب + Pagination
  // ==========================================================================
  it('GET /customers مع Pagination يعيد page/limit/total/totalPages', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 2));
  });

  it('البحث بالكود وبالاسم المطبع يعمل', async () => {
    const byCode = await request(app.getHttpServer())
      .get('/customers?search=90001')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byCode.body.items.some((c: any) => c.externalCustomerCode === '90001')).toBe(true);

    // "إختبار" بهمزة تُطابق "اختبار" بعد التطبيع
    const byName = await request(app.getHttpServer())
      .get(`/customers?search=${encodeURIComponent('عميل الإختبار')}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byName.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('تصفية المدينين بعملة YER + الترتيب بالرصيد تنازليًا', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers?balanceState=debtor&currency=YER&sortBy=balance&sortDir=desc')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const balances = res.body.items.map(
      (c: any) => c.balances.find((b: any) => b.currency === 'YER')?.balance ?? 0,
    );
    for (let i = 1; i < balances.length; i += 1) {
      expect(balances[i - 1]).toBeGreaterThanOrEqual(balances[i]);
    }
    for (const b of balances) expect(b).toBeGreaterThan(0);
  });

  it('الترتيب بالرصيد بدون عملة يُرفض برسالة واضحة', async () => {
    await request(app.getHttpServer())
      .get('/customers?sortBy=balance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  // ==========================================================================
  // Customer 360 + الأرصدة + الخط الزمني
  // ==========================================================================
  it('Customer 360 يعيد البيانات والأرصدة لكل عملة والعدادات', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.externalCustomerCode).toBe('90001');
    const byCcy = Object.fromEntries(
      res.body.balances.map((b: any) => [b.currency, b.accountingBalance]),
    );
    expect(byCcy.YER).toBe(12000);
    expect(byCcy.SAR).toBe(700);
    expect(res.body.counts.importedTxns).toBe(3); // 2 YER + 1 SAR
    expect(res.body.balances[0].lastImport).not.toBeNull();
  });

  it('GET /customers/:id/balances يعيد المحاسبي والتشغيلي (متساويان قبل التحصيل)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}/balances`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    for (const b of res.body) {
      expect(b.operationalBalance).toBe(b.accountingBalance);
    }
  });

  it('الخط الزمني يشمل الإنشاء من الاستيراد ولقطات الرصيد، مرتبة تنازليًا', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const types = res.body.items.map((e: any) => e.type);
    expect(types).toContain('customer_created');
    expect(types).toContain('balance_snapshot');
    const times = res.body.items.map((e: any) => new Date(e.at).getTime());
    for (let i = 1; i < times.length; i += 1) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
  });

  // ==========================================================================
  // كشف الحساب: رصيد جارٍ (مؤكد بالمحاكاة: 10000 → 15000 → 12000)
  // ==========================================================================
  it('كشف الحساب الكامل: الرصيد الجاري صحيح سطرًا بسطر', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}/statement?currency=YER`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.openingBalance).toBe(10000);
    expect(res.body.items.map((i: any) => i.runningBalance)).toEqual([15000, 12000]);
    expect(
      res.body.periodStartBalance
      + res.body.items.reduce((sum: number, i: any) => sum + i.debit - i.credit, 0),
    ).toBe(res.body.periodEndBalance);
    expect(res.body.periodEndBalance).toBe(12000);
    expect(res.body.equationClosed).toBe(true);
    expect(res.body.currentBalance).toBe(12000);
  });

  it('كشف الحساب بفترة: رصيد بداية الفترة يحتسب الحركات السابقة', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}/statement?currency=YER&fromDate=2026-02-05`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.periodStartBalance).toBe(15000); // مؤكد بالمحاكاة
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].runningBalance).toBe(12000);
  });

  it('كشف حساب بعملة لا يملكها العميل يعيد حالة فارغة بلا 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}/statement?currency=USD`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.periodStartBalance).toBe(0);
    expect(res.body.periodEndBalance).toBe(0);
    expect(res.body.equationClosed).toBe(true);
  });

  // ==========================================================================
  // إنشاء/تعديل + منع التكرار + تنبيه تشابه الاسم
  // ==========================================================================
  it('إنشاء عميل يدويًا، ومنع تكرار الكود، وتنبيه تشابه الاسم', async () => {
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ externalCustomerCode: `M4-${uniq}`, name: 'عميل الاختبار الأول' })
      .expect(201);
    expect(created.body.similarNameAlerts).toBeGreaterThanOrEqual(1); // نفس اسم 90001

    await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ externalCustomerCode: `M4-${uniq}`, name: 'آخر' })
      .expect(409);

    const upd = await request(app.getHttpServer())
      .patch(`/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ region: 'صنعاء', phonePrimary: '777000111' })
      .expect(200);
    expect(upd.body.region).toBe('صنعاء');
  });

  it('حالات التشابه تظهر في /customers/duplicates وتُراجع بلا دمج آلي', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/duplicates')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const pair = res.body[0];
    const reviewed = await request(app.getHttpServer())
      .patch(`/customers/duplicates/${pair.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'rejected_intentional' })
      .expect(200);
    expect(reviewed.body.reviewStatus).toBe('rejected_intentional');
  });

  // ==========================================================================
  // نقل العميل + نطاق رؤية المحصل (يرى المسندين إليه فقط)
  // ==========================================================================
  it('نقل العميل لمحصل، والمحصل يرى عملاءه المسندين فقط', async () => {
    // إنشاء مستخدم محصل + سجل collector + منح دور المحصل
    const userRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `m4collector_${uniq}`, fullName: 'محصل م4', password: 'Test1234pass' })
      .expect(201);
    const collectorRole = await prisma.role.findFirstOrThrow({ where: { name: 'المحصل' } });
    await request(app.getHttpServer())
      .post(`/users/${userRes.body.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [collectorRole.id] })
      .expect(201);
    const collector = await prisma.collector.create({ data: { userId: userRes.body.id } });
    collectorId = collector.id;

    // النقل
    const assign = await request(app.getHttpServer())
      .post(`/customers/${cust90001Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ collectorId, reason: 'اختبار نقل' })
      .expect(201);
    expect(assign.body.collectorName).toBe('محصل م4');

    // النقل لنفس المحصل مرفوض
    await request(app.getHttpServer())
      .post(`/customers/${cust90001Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ collectorId })
      .expect(409);

    // دخول المحصل: يرى العميل المسند فقط
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: `m4collector_${uniq}`, password: 'Test1234pass' })
      .expect(200);
    collectorUserToken = login.body.accessToken;

    const scoped = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${collectorUserToken}`)
      .expect(200);
    expect(scoped.body.total).toBe(1);
    expect(scoped.body.items[0].externalCustomerCode).toBe('90001');

    // ولا يستطيع فتح عميل غير مسند إليه
    const other = await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90002' },
    });
    await request(app.getHttpServer())
      .get(`/customers/${other.id}`)
      .set('Authorization', `Bearer ${collectorUserToken}`)
      .expect(404);
  });

  it('تاريخ الإسناد السابق محفوظ بعد النقل (لا تعديل للتاريخ)', async () => {
    const history = await prisma.customerAssignment.findMany({
      where: { customerId: cust90001Id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.length).toBeGreaterThanOrEqual(1);
    const open = history.filter((h) => h.effectiveTo === null);
    expect(open.length).toBe(1); // إسناد حالي واحد فقط (القيد الجزئي)
    expect(open[0].collectorId).toBe(collectorId);
  });

  // ==========================================================================
  // PR 8 — إسناد/فك إسناد والمهام المفتوحة
  // ==========================================================================
  it('assign يسند المهام المفتوحة غير المسندة فقط ويرجع tasksUpdated', async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90002' } });
    const mk = (taskType: string, status: string, assignedTo: string | null) =>
      prisma.task.create({
        data: {
          customerId: c.id,
          dueDate: new Date('2026-08-10'),
          taskType,
          status,
          assignedTo,
          priorityReason: 'اختبار إسناد',
        },
      });
    const openNull = await mk('high_balance', 'open', null);
    const openOther = await mk('followup_overdue', 'open', otherCollectorId);
    const doneNull = await mk('risk_high', 'done', null);

    const res = await request(app.getHttpServer())
      .post(`/customers/${c.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ collectorId, reason: 'اختبار إسناد' })
      .expect(201);
    expect(res.body.tasksUpdated).toBe(1);

    const after = await prisma.task.findMany({
      where: { id: { in: [openNull.id, openOther.id, doneNull.id] } },
    });
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get(openNull.id)!.assignedTo).toBe(collectorId);
    expect(byId.get(openOther.id)!.assignedTo).toBe(otherCollectorId);
    expect(byId.get(doneNull.id)!.status).toBe('done');
    expect(byId.get(doneNull.id)!.assignedTo).toBeNull();
  });

  it('unassign يغلق الإسناد ويفك فقط مهام المحصل المفتوحة ويرجع tasksUpdated', async () => {
    // 90001 مسند حاليًا إلى collectorId (من اختبار النقل أعلاه)
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90001' } });
    const mk = (taskType: string, status: string, assignedTo: string | null) =>
      prisma.task.create({
        data: {
          customerId: c.id,
          dueDate: new Date('2026-08-10'),
          taskType,
          status,
          assignedTo,
          priorityReason: 'اختبار فك إسناد',
        },
      });
    const o1 = await mk('high_balance', 'open', collectorId);
    const o2 = await mk('followup_overdue', 'open', collectorId);
    const o3 = await mk('risk_high', 'open', otherCollectorId);
    const o4 = await mk('debt_ageing', 'done', collectorId);
    const o5 = await mk('unfollowed', 'open', null);

    const res = await request(app.getHttpServer())
      .post(`/customers/${c.id}/unassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(res.body.unassigned).toBe(true);
    expect(res.body.tasksUpdated).toBe(2);

    const after = await prisma.task.findMany({
      where: { id: { in: [o1.id, o2.id, o3.id, o4.id, o5.id] } },
    });
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get(o1.id)!.assignedTo).toBeNull();
    expect(byId.get(o2.id)!.assignedTo).toBeNull();
    expect(byId.get(o3.id)!.assignedTo).toBe(otherCollectorId);
    expect(byId.get(o4.id)!.status).toBe('done');
    expect(byId.get(o4.id)!.assignedTo).toBe(collectorId);
    expect(byId.get(o5.id)!.assignedTo).toBeNull();

    // الإسناد الحالي أُغلق (لا أحداث مفتوحة) والتاريخ محفوظ
    const openAssign = await prisma.customerAssignment.findFirst({
      where: { customerId: c.id, effectiveTo: null },
    });
    expect(openAssign).toBeNull();
    const history = await prisma.customerAssignment.findMany({ where: { customerId: c.id } });
    expect(history.some((h) => h.effectiveTo !== null)).toBe(true);
  });

  // ==========================================================================
  // PR 9 — إكمال المهمة + تسجيل متابعة + وعد سداد
  // ==========================================================================
  it('POST /tasks/:id/complete بنتيجة ملاحظة: يغلق المهمة ويُسجل متابعة بلا وعد', async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90002' } });
    const task = await prisma.task.create({
      data: {
        customerId: c.id,
        assignedTo: collectorId,
        dueDate: new Date('2026-08-11'),
        taskType: 'high_balance_no_followup',
        status: 'open',
        priorityReason: 'اختبار إكمال — ملاحظة',
        expectedAmount: 5000,
        expectedCurrency: 'YER',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'note', notes: 'تم التوثيق' })
      .expect(201);
    expect(res.body.task.status).toBe('done');
    expect(res.body.followup.result).toBe('ملاحظة');
    expect(res.body.promise).toBeNull();

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.status).toBe('done');
    const f = await prisma.followup.findFirst({
      where: { customerId: c.id, notes: 'تم التوثيق' },
      include: { result: true },
    });
    expect(f).not.toBeNull();
    expect(f!.result.name).toBe('ملاحظة');

    // المهمة خرجت من قائمة المهام المفتوحة
    const open = await prisma.task.findMany({ where: { customerId: c.id, status: 'open' } });
    expect(open.some((t) => t.id === task.id)).toBe(false);
  });

  it('POST /tasks/:id/complete بنتيجة وعد بالسداد: متابعة + وعد + مهمة وعد مفتوحة', async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90002' } });
    const task = await prisma.task.create({
      data: {
        customerId: c.id,
        assignedTo: collectorId,
        dueDate: new Date('2026-08-11'),
        taskType: 'promise_due',
        status: 'open',
        priorityReason: 'وعد سداد مستحق',
        expectedAmount: 5000,
        expectedCurrency: 'YER',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        result: 'promise',
        promiseDueDate: '2026-08-20',
        promiseAmount: 5000,
        promiseCurrency: 'YER',
        notes: 'وعد جديد',
      })
      .expect(201);
    expect(res.body.task.status).toBe('done');
    expect(res.body.followup.result).toBe('وعد بالسداد');
    expect(res.body.promise).not.toBeNull();

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.status).toBe('done');
    const followup = await prisma.followup.findFirst({
      where: { customerId: c.id, notes: 'وعد جديد' },
      include: { result: true },
    });
    expect(followup).not.toBeNull();
    expect(followup!.result.name).toBe('وعد بالسداد');

    const promise = await prisma.paymentPromise.findFirst({
      where: { customerId: c.id, notes: 'وعد جديد' },
    });
    expect(promise).not.toBeNull();
    expect(Number(promise!.expectedAmount)).toBe(5000);
    // الوعد أنشأ مهمة promise_due جديدة مفتوحة — لا وعد بلا مهمة
    const promiseTask = await prisma.task.findFirst({
      where: { sourcePromiseId: promise!.id, taskType: 'promise_due', status: 'open' },
    });
    expect(promiseTask).not.toBeNull();
  });

  it('نتيجة وعد بلا تاريخ استحقاق → 400 والمهمة تبقى مفتوحة', async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90002' } });
    const task = await prisma.task.create({
      data: {
        customerId: c.id,
        assignedTo: collectorId,
        dueDate: new Date('2026-08-11'),
        taskType: 'followup_overdue',
        status: 'open',
        priorityReason: 'اختبار رفض',
      },
    });

    await request(app.getHttpServer())
      .post(`/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'promise' })
      .expect(400);

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.status).toBe('open');
  });

  it('إكمال مهمة غير مفتوحة → 409', async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90002' } });
    const task = await prisma.task.create({
      data: {
        customerId: c.id,
        assignedTo: collectorId,
        dueDate: new Date('2026-08-11'),
        taskType: 'debt_120plus',
        status: 'done',
        priorityReason: 'مكتملة مسبقًا',
      },
    });

    await request(app.getHttpServer())
      .post(`/tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ result: 'note' })
      .expect(409);
  });

  it('المحصل يُكمل مهمته المسندة فقط — مهمة محصل آخر → 404', async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90002' } });
    const ownTask = await prisma.task.create({
      data: {
        customerId: c.id,
        assignedTo: collectorId,
        dueDate: new Date('2026-08-11'),
        taskType: 'high_balance_no_followup',
        status: 'open',
        priorityReason: 'اختبار نطاق محصل',
      },
    });
    await request(app.getHttpServer())
      .post(`/tasks/${ownTask.id}/complete`)
      .set('Authorization', `Bearer ${collectorUserToken}`)
      .send({ result: 'note' })
      .expect(201);

    const other = await prisma.customer.findFirstOrThrow({ where: { externalCustomerCode: '90003' } });
    const otherTask = await prisma.task.create({
      data: {
        customerId: other.id,
        assignedTo: otherCollectorId,
        dueDate: new Date('2026-08-11'),
        taskType: 'risk_high',
        status: 'open',
        priorityReason: 'مهمة محصل آخر',
      },
    });
    await request(app.getHttpServer())
      .post(`/tasks/${otherTask.id}/complete`)
      .set('Authorization', `Bearer ${collectorUserToken}`)
      .send({ result: 'note' })
      .expect(404);
  });

  // ==========================================================================
  // Dashboard
  // ==========================================================================
  it('Dashboard summary يعيد المؤشرات مفصولة بالعملة + مديونية جديدة + أعمار تقديرية', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.customers.total).toBeGreaterThanOrEqual(3);
    expect(res.body.byCurrency.YER).toBeDefined();
    expect(res.body.byCurrency.YER.debtors).toBeGreaterThanOrEqual(2); // 90001 و90003
    expect(res.body.byCurrency.YER.debtTotal).toBeGreaterThanOrEqual(13500);
    expect(res.body.byCurrency.SAR.debtTotal).toBeGreaterThanOrEqual(700);
    expect(res.body.lastImport).not.toBeNull();
    // أعمار الديون معلّمة "تقديرية" دائمًا — قرار موثق (لا دقة زائفة)
    expect(res.body.agingEstimated.estimated).toBe(true);
    expect(res.body.agingEstimated.buckets.YER).toBeDefined();
    // مديونية جديدة (استيراد واحد أو أكثر — الشكل موجود دائمًا)
    expect(res.body.newDebt).not.toBeNull();
  });

  it('Dashboard محمي بصلاحية reports.read — المحصل بدونها يُرفض', async () => {
    await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${collectorUserToken}`)
      .expect(403);
  });
});
