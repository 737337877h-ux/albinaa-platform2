import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const CURRENCY = 'KPI';

describe('Collection KPI report (e2e)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let collectorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
    prisma = app.get(PrismaService);
    token = (await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200)).body.accessToken;
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    collectorId = (await prisma.collector.upsert({
      where: { userId: admin.id },
      update: {},
      create: { userId: admin.id },
    })).id;
    await prisma.currency.upsert({
      where: { code: CURRENCY }, update: { active: true },
      create: { code: CURRENCY, sourceCode: CURRENCY, nameAr: 'عملة اختبار المؤشرات', decimals: 2 },
    });
    const customer = await prisma.customer.create({ data: { organizationId: admin.organizationId, externalCustomerCode: '95091', name: 'عميل KPI', nameNormalized: 'عميل kpi' } });
    const documentType = await prisma.documentType.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
    const job = await prisma.importJob.create({ data: { organizationId: admin.organizationId, fileName: 'kpi.xlsx', fileHash: `kpi-${Date.now()}`, uploadedBy: admin.id } });
    await prisma.customerBalance.create({ data: { customerId: customer.id, currencyCode: CURRENCY, accountingBalance: 1200, lastImportJobId: job.id } });
    await prisma.importedTransaction.createMany({ data: [
      { customerId: customer.id, currencyCode: CURRENCY, documentTypeId: documentType.id, txDate: new Date('2026-07-05'), debit: 1000, credit: 0, lineHash: 'kpi-jul-sale', importJobId: job.id },
      { customerId: customer.id, currencyCode: CURRENCY, documentTypeId: documentType.id, txDate: new Date('2026-07-20'), debit: 0, credit: 200, lineHash: 'kpi-jul-pay', importJobId: job.id },
      { customerId: customer.id, currencyCode: CURRENCY, documentTypeId: documentType.id, txDate: new Date('2026-08-02'), debit: 500, credit: 0, lineHash: 'kpi-aug-sale', importJobId: job.id },
      { customerId: customer.id, currencyCode: CURRENCY, documentTypeId: documentType.id, txDate: new Date('2026-08-03'), debit: 0, credit: 100, lineHash: 'kpi-aug-pay', importJobId: job.id },
    ] });
    await prisma.agingSnapshot.createMany({ data: [
      { organizationId: admin.organizationId, customerId: customer.id, currencyCode: CURRENCY, asOf: new Date('2026-07-31'), bucket_0_30: 300, bucket_61_90: 500, totalDue: 800, provisionAmount: 50 },
      { organizationId: admin.organizationId, customerId: customer.id, currencyCode: CURRENCY, asOf: new Date('2026-08-04'), bucket_0_30: 500, bucket_61_90: 700, totalDue: 1200, provisionAmount: 70 },
    ] });
    const method = await prisma.collectionMethod.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
    await prisma.collection.create({ data: { customerId: customer.id, collectorId, currencyCode: CURRENCY, amount: 200, collectedAt: new Date('2026-08-04T08:00:00Z'), methodId: method.id } });
    await prisma.paymentPromise.createMany({ data: [
      { customerId: customer.id, collectorId, promiseDate: new Date('2026-08-01'), dueDate: new Date('2026-08-03'), expectedAmount: 100, fulfilledAmount: 100, currencyCode: CURRENCY, status: 'fulfilled' },
      { customerId: customer.id, collectorId, promiseDate: new Date('2026-08-01'), dueDate: new Date('2026-08-03'), expectedAmount: 100, currencyCode: CURRENCY, status: 'unfulfilled' },
    ] });
  });

  afterAll(async () => { if (app) await app.close(); });

  it('stores a monthly target and returns auditable 12-month KPIs', async () => {
    await request(app.getHttpServer()).patch(`/reports/kpi/targets/${collectorId}/${CURRENCY}`).set('Authorization', `Bearer ${token}`).send({ month: '2026-08-01', targetAmount: 400 }).expect(200);
    const response = await request(app.getHttpServer()).get('/reports/kpi').set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body.trend.filter((x: any) => x.currency === CURRENCY)).toHaveLength(12);
    expect(response.body.latestByCurrency[CURRENCY].cei).toBeCloseTo(12.5, 4);
    expect(response.body.latestByCurrency[CURRENCY].averageDebtAge).toBeCloseTo(50, 0);
    const collector = response.body.collectors.find((x: any) => x.collectorId === collectorId && x.currency === CURRENCY);
    expect(collector).toMatchObject({ monthlyAmount: 200, target: 400, attainment: 50, promisesFulfilled: 1, promisesTotal: 2, promiseRate: 50 });
    expect(response.body.leaderboard.find((x: any) => x.collectorId === collectorId && x.currency === CURRENCY)?.rank).toBe(1);
  });
});
