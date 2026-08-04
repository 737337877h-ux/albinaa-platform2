import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const uniq = `recon${Date.now().toString(36)}`;

describe('Collection handover reconciliation and maker-checker reversal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let cashierToken: string;
  let cashierUserId: string;
  let customerId: string;
  let collectorId: string;
  let branchId: string;
  let methodId: string;
  const collectionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = (await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200)).body.accessToken;

    const customer = await request(app.getHttpServer()).post('/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ externalCustomerCode: '93992', name: 'عميل مطابقة الصندوق' }).expect(201);
    customerId = customer.body.id;
    branchId = (await prisma.branch.findFirstOrThrow()).id;
    methodId = (await prisma.collectionMethod.findFirstOrThrow({ where: { name: 'نقدي' } })).id;

    const collectorUser = await request(app.getHttpServer()).post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `collector_${uniq}`, fullName: 'محصل قسيمة الصندوق', password: 'Test1234pass' }).expect(201);
    const collectorRole = await prisma.role.findFirstOrThrow({ where: { name: 'المحصل' } });
    await request(app.getHttpServer()).post(`/users/${collectorUser.body.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`).send({ roleIds: [collectorRole.id] }).expect(201);
    collectorId = (await prisma.collector.create({ data: { userId: collectorUser.body.id, branchId } })).id;
    await request(app.getHttpServer()).post('/assignments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, collectorId, reason: 'اختبار مطابقة الصندوق' }).expect(201);

    const cashier = await request(app.getHttpServer()).post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `cashier_${uniq}`, fullName: 'أمين صندوق ثانٍ', password: 'Test1234pass', branchId }).expect(201);
    cashierUserId = cashier.body.id;
    const cashierRole = await prisma.role.findFirstOrThrow({ where: { name: 'أمين الصندوق' } });
    await request(app.getHttpServer()).post(`/users/${cashierUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`).send({ roleIds: [cashierRole.id] }).expect(201);
    cashierToken = (await request(app.getHttpServer()).post('/auth/login')
      .send({ username: `cashier_${uniq}`, password: 'Test1234pass' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('numbers branch receipts and creates one-currency handover voucher', async () => {
    for (const amount of [1500, 2500]) {
      const response = await request(app.getHttpServer()).post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerId, collectorId, branchId, currencyCode: 'YER', amount, methodId }).expect(201);
      collectionIds.push(response.body.id);
    }
    const rows = await prisma.collection.findMany({ where: { id: { in: collectionIds } }, orderBy: { createdAt: 'asc' } });
    expect(rows[0].receiptNumber).toMatch(/^R-\d{4}-\d{6}$/);
    expect(Number(rows[1].receiptNumber!.slice(-6))).toBe(Number(rows[0].receiptNumber!.slice(-6)) + 1);

    const voucher = await request(app.getHttpServer()).post('/collections/reconciliation/vouchers')
      .set('Authorization', `Bearer ${adminToken}`).send({ collectionIds }).expect(201);
    expect(voucher.body.serialNumber).toMatch(/^H-\d{4}-\d{6}$/);
    expect(Number(voucher.body.totalAmount)).toBe(4000);
    expect((await prisma.collection.findMany({ where: { id: { in: collectionIds } } }))
      .every((collection) => collection.status === 'handed_to_cashier')).toBe(true);

    await request(app.getHttpServer()).post(`/collections/reconciliation/vouchers/${voucher.body.id}/match`)
      .set('Authorization', `Bearer ${cashierToken}`).expect(200);
    await request(app.getHttpServer()).post(`/collections/reconciliation/vouchers/${voucher.body.id}/lock`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect((await prisma.collection.findMany({ where: { id: { in: collectionIds } } }))
      .every((collection) => collection.status === 'approved')).toBe(true);
    expect((await prisma.collectionHandoverVoucher.findUniqueOrThrow({ where: { id: voucher.body.id } })).status).toBe('locked');
  });

  it('keeps collection unchanged until a second user approves reversal and notifies finance', async () => {
    const requested = await request(app.getHttpServer()).post(`/collections/${collectionIds[0]}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'إيصال مسجل على عميل غير صحيح' }).expect(200);
    expect(requested.body.status).toBe('pending');
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionIds[0] } })).status).toBe('approved');

    await request(app.getHttpServer()).post(`/collections/reconciliation/reversal-requests/${requested.body.requestId}/review`)
      .set('Authorization', `Bearer ${adminToken}`).send({ approve: true }).expect(403);
    const approved = await request(app.getHttpServer()).post(`/collections/reconciliation/reversal-requests/${requested.body.requestId}/review`)
      .set('Authorization', `Bearer ${cashierToken}`).send({ approve: true, note: 'تمت مراجعة الإيصال' }).expect(200);
    expect(approved.body.reversal).toBeDefined();
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionIds[0] } })).status).toBe('reversed');
    expect(await prisma.notification.count({ where: { userId: cashierUserId, kind: 'collection_reversal_requested' } })).toBe(1);
  });
});
