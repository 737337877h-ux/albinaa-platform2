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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;

    // ضمان وجود بيانات الـ fixture (idempotent — إن سبق استيرادها فلن تتكرر)
    const existing = await prisma.customer.findFirst({
      where: { externalCustomerCode: '90001' },
    });
    if (!existing) {
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
    }
    const c = await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90001' },
    });
    cust90001Id = c.id;
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
    expect(byName.body.items.length).toBeGreaterThanOrEqual(3);
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

  it('كشف حساب بعملة لا يملكها العميل → 404', async () => {
    await request(app.getHttpServer())
      .get(`/customers/${cust90001Id}/statement?currency=USD`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
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
