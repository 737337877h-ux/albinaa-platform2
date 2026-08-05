/**
 * اختبارات E2E — Milestone 3: محرك استيراد Excel
 * تغطي السيناريوهات الستة المطلوبة في متطلبات المرحلة:
 *   1) استيراد الملف لأول مرة
 *   2) إعادة استيراد نفس الملف
 *   3) عدم تكرار البيانات (عملاء وحركات)
 *   4) مطابقة الأرصدة مع الملف (المحسوب == المعلن)
 *   5) دعم العملات المتعددة
 *   6) التعامل مع الصفوف التالفة (تُسجَّل ويستمر الاستيراد)
 *
 * المتطلب: قاعدة مهاجرة ومزروعة + python3 و openpyxl (نفس صورة الإنتاج).
 * الملف المستخدم: fixture.xlsx (مولّد ببنية الملف الحقيقي نفسها + حالات حدّية).
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

describe('Import Engine — Milestone 3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let firstJobId: string;
  let firstReport: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // تنظيف بيانات عملاء الاختبار من تشغيلات سابقة (fixture codes: 9000x)
    await cleanupTestCustomers(prisma);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;

    // طلب تدفئة للتأكد من استقرار الاتصال بعد ALTER TABLE في cleanupTestCustomers
    await request(app.getHttpServer()).get('/imports').set('Authorization', `Bearer ${token}`).expect(200);
  });

  afterAll(async () => {
    // حماية من خطأ ثانوي يُخفي السبب الجذري إن فشلت تهيئة التطبيق (مثل رفض
    // env.validation لأسرار JWT التجريبية) قبل أن يُسنَد app أصلاً.
    if (app) {
      await app.close();
    }
  });

  it('يرفض الرفع بدون صلاحية imports.run', async () => {
    try {
      const res = await request(app.getHttpServer())
        .post('/imports/upload')
        .attach('file', FIXTURE);
      expect([401, 403]).toContain(res.status);
    } catch (e: any) {
      // On Windows multer may reset connection before auth guard responds
      expect(e.message).toMatch(/ECONNRESET|EPIPE/);
    }
  });

  // ===== السيناريو 1: الاستيراد لأول مرة =====
  it('رفع الملف يعيد معاينة صحيحة (dry-run بدون كتابة مالية)', async () => {
    const res = await request(app.getHttpServer())
      .post('/imports/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FIXTURE)
      .expect(201);

    firstJobId = res.body.jobId;
    expect(res.body.status).toBe('dry_run');
    expect(res.body.preview.accountsInFile).toBe(5);
    expect(res.body.preview.customersInFile).toBe(4);
    expect(res.body.preview.transactionsInFile).toBe(8);
    expect(res.body.preview.fragmentedAccountsMerged).toBe(1);   // كتلة 90002 المجزأة
    expect(res.body.preview.parserErrors).toBe(2);               // الصفان التالفان
    expect(res.body.preview.ruleErrors).toBe(1);                 // العملة المجهولة XX
    expect(res.body.preview.importableAccounts).toBe(4);         // 5 - حساب العملة المجهولة

    // dry-run: لا عملاء كُتبوا بعد
    const count = await prisma.customer.count({
      where: { externalCustomerCode: { startsWith: '900' } },
    });
    expect(count).toBe(0);
  });

  it('تنفيذ الاستيراد الأول يكتب البيانات ويعيد التقرير الكامل', async () => {
    const res = await request(app.getHttpServer())
      .post(`/imports/${firstJobId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    firstReport = res.body;
    expect(res.body.status).toBe('completed');
    expect(res.body.customersNew).toBe(3);        // 90001, 90002, 90003 (90004 مستبعد بعملة مجهولة)
    expect(res.body.customersUpdated).toBe(0);
    expect(res.body.transactionsNew).toBe(7);     // 8 سليمة - 1 لحساب العملة المجهولة المستبعد
    expect(res.body.transactionsDuplicate).toBe(0);
    expect(res.body.durationMs).toBeGreaterThanOrEqual(0);
    // كل العدادات التسعة موجودة
    for (const k of ['rowsRead','rowsImported','rowsIgnored','errorsCount','customersNew',
                     'customersUpdated','transactionsNew','transactionsDuplicate','durationMs']) {
      expect(res.body[k]).toBeDefined();
    }
    const importedCustomer = await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90001' },
    });
    expect(await prisma.customerScore.count({ where: { customerId: importedCustomer.id } })).toBe(1);
    const riskAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'risk_recalculated' }, orderBy: { createdAt: 'desc' },
    });
    expect((riskAudit.newValue as any).source).toBe('import_completed');
    expect((riskAudit.newValue as any).targetedCustomerIds).toContain(importedCustomer.id);
  });

  // ===== السيناريو 5: العملات المتعددة =====
  it('العميل 90001 له رصيدان منفصلان بعملتين', async () => {
    const cust = await prisma.customer.findFirstOrThrow({
      where: { externalCustomerCode: '90001' },
      include: { balances: true },
    });
    const byCcy = Object.fromEntries(
      cust.balances.map((b) => [b.currencyCode, Number(b.accountingBalance)]),
    );
    expect(byCcy.YER).toBe(12000);
    expect(byCcy.SAR).toBe(700);
  });

  // ===== السيناريو 4: مطابقة الأرصدة مع الملف =====
  it('كل رصيد محسوب يطابق الرصيد المعلن في الملف', async () => {
    const balances = await prisma.customerBalance.findMany({
      where: { customer: { externalCustomerCode: { startsWith: '900' } } },
    });
    expect(balances.length).toBe(4); // 90001×2 + 90002 + 90003
    for (const b of balances) {
      expect(b.declaredBalance).not.toBeNull();
      expect(Number(b.accountingBalance)).toBe(Number(b.declaredBalance));
    }
    // دمج الكتل المجزأة: رصيد 90002 = صفر تمامًا كما أعلن الملف
    const c2 = balances.find((b) => Number(b.accountingBalance) === 0);
    expect(c2).toBeDefined();
  });

  it('الحركتان المتطابقتان المشروعتان (occ=n) دخلتا معًا ولم تُعتبرا تكرارًا', async () => {
    const twins = await prisma.importedTransaction.count({
      where: {
        customer: { externalCustomerCode: '90002' },
        documentNumber: '302',
      },
    });
    expect(twins).toBe(2);
  });

  // ===== السيناريو 6: الصفوف التالفة =====
  it('الصفوف التالفة سُجلت في تقرير الأخطاء ولم توقف الاستيراد', async () => {
    const res = await request(app.getHttpServer())
      .get(`/imports/${firstJobId}/errors`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const messages = res.body.parserErrors.map((e: any) => e.message).join(' | ');
    expect(messages).toContain('مدين ودائن');
    expect(messages).toContain('سالب');
    const ruleMessages = res.body.ruleErrors.map((e: any) => e.message).join(' | ');
    expect(ruleMessages).toContain('عملة غير معروفة');
    // ورغم الأخطاء: العميل 90003 استورد بصفه السليم
    const c3 = await prisma.customerBalance.findFirst({
      where: { customer: { externalCustomerCode: '90003' } },
    });
    expect(Number(c3?.accountingBalance)).toBe(1500);
  });

  // ===== السيناريوهات 2+3: إعادة الاستيراد وعدم التكرار =====
  it('إعادة رفع نفس الملف تحذر بأنه استورد سابقًا', async () => {
    const res = await request(app.getHttpServer())
      .post('/imports/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FIXTURE)
      .expect(201);
    expect(res.body.previouslyImported).not.toBeNull();
    firstJobId = res.body.jobId; // العملية الجديدة

    // التنفيذ بدون force يُرفض بتحذير واضح
    await request(app.getHttpServer())
      .post(`/imports/${firstJobId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
  });

  it('التنفيذ بـ force ينجح بصفر عملاء جدد وصفر حركات جديدة (كلها مكررة)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/imports/${firstJobId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({ force: true })
      .expect(200);

    expect(res.body.customersNew).toBe(0);
    expect(res.body.customersUpdated).toBe(3);       // حُدّثوا (لا إنشاء)
    expect(res.body.transactionsNew).toBe(0);        // لا حركة واحدة مكررة
    expect(res.body.transactionsDuplicate).toBe(7);  // كلها رُصدت كمكررة وتُجوهلت

    // عدد العملاء والحركات لم يتغير بين الاستيرادين
    const customers = await prisma.customer.count({
      where: { externalCustomerCode: { startsWith: '900' } },
    });
    expect(customers).toBe(3);
    const txns = await prisma.importedTransaction.count({
      where: { customer: { externalCustomerCode: { startsWith: '900' } } },
    });
    expect(txns).toBe(7);
    // والأرصدة لم تتضاعف
    const b = await prisma.customerBalance.findFirst({
      where: { customer: { externalCustomerCode: '90001' }, currencyCode: 'YER' },
    });
    expect(Number(b?.accountingBalance)).toBe(12000);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'import_executed', entityId: firstJobId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.newValue as any)?.forcedDuplicateImport).toBe(true);
    expect((audit?.newValue as any)?.previousImportJobId).toEqual(expect.any(String));
  });

  it('Snapshot جديد أُنشئ لكل استيراد (تاريخ أرصدة كامل)', async () => {
    const snaps = await prisma.balanceSnapshot.count({
      where: { customer: { externalCustomerCode: '90001' }, currencyCode: 'YER' },
    });
    expect(snaps).toBe(2); // استيرادان = لقطتان
  });

  it('GET /imports يسرد العمليتين و GET /imports/:id/report يعيد التقرير', async () => {
    const list = await request(app.getHttpServer())
      .get('/imports')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);

    const report = await request(app.getHttpServer())
      .get(`/imports/${firstJobId}/report`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(report.body.transactionsDuplicate).toBe(7);
  });

  it('يتراجع عن أحدث دفعة أولًا ويحفظ سجلاتها دون حذف', async () => {
    const reverseKey = `reverse-import-${firstJobId}`;
    const res = await request(app.getHttpServer())
      .post(`/imports/${firstJobId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', reverseKey)
      .send({ reason: 'اختبار التراجع الآمن للدفعة المكررة' })
      .expect(200);
    expect(res.body.status).toBe('reversed');

    // نفس المفتاح يعيد النتيجة نفسها ولا ينشئ عكسًا ثانيًا.
    await request(app.getHttpServer())
      .post(`/imports/${firstJobId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', reverseKey)
      .send({ reason: 'اختبار التراجع الآمن للدفعة المكررة' })
      .expect(200);

    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: firstJobId } });
    expect(job.status).toBe('reversed');
    expect(job.reversalReason).toContain('اختبار التراجع');
    const audit = await prisma.auditLog.count({
      where: { entityId: firstJobId, action: 'import_reversed' },
    });
    expect(audit).toBe(1);
  });

  it('يتراجع بعد ذلك عن الدفعة الأصلية ويؤرشف العملاء ويعكس الحركات', async () => {
    const latest = await prisma.importJob.findFirstOrThrow({
      where: { status: 'completed', fileName: { contains: 'fixture' } },
      orderBy: { importedAt: 'desc' },
    });
    await request(app.getHttpServer())
      .post(`/imports/${latest.id}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `reverse-import-${latest.id}`)
      .send({ reason: 'اختبار استعادة الحالة قبل أول استيراد' })
      .expect(200);

    expect(await prisma.importedTransaction.count({
      where: { importJobId: latest.id, reversedAt: null },
    })).toBe(0);
    expect(await prisma.importedTransaction.count({
      where: { importJobId: latest.id, reversedAt: { not: null } },
    })).toBe(7);
    expect(await prisma.customerBalance.count({
      where: { customer: { externalCustomerCode: { startsWith: '900' } } },
    })).toBe(0);
    expect(await prisma.customer.count({
      where: { externalCustomerCode: { startsWith: '900' }, status: 'import_reversed' },
    })).toBe(3);
  });

  it('يمكن إعادة استيراد الملف بعد التراجع دون فقد الحركات التاريخية', async () => {
    const uploaded = await request(app.getHttpServer())
      .post('/imports/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FIXTURE)
      .expect(201);
    expect(uploaded.body.previouslyImported).toBeNull();

    const executed = await request(app.getHttpServer())
      .post(`/imports/${uploaded.body.jobId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    expect(executed.body.transactionsNew).toBe(7);
    expect(await prisma.importedTransaction.count({
      where: { customer: { externalCustomerCode: { startsWith: '900' } } },
    })).toBe(14); // 7 تاريخية معكوسة + 7 فعالة جديدة
    expect(await prisma.customer.count({
      where: { externalCustomerCode: { startsWith: '900' }, status: 'active' },
    })).toBe(3);
  });
});
