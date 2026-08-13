import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const CODES = ['93091', '93092'];

describe('Debt aging report (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let ids: string[] = [];
  let importJobId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
    const actor = await prisma.user.findFirstOrThrow({ where: { username: ADMIN.username } });
    const old = await prisma.customer.findMany({ where: { externalCustomerCode: { in: CODES } } });
    if (old.length) {
      const oldIds = old.map((x) => x.id);
      await prisma.agingSnapshot.deleteMany({ where: { customerId: { in: oldIds } } });
      await prisma.importedTransaction.deleteMany({ where: { customerId: { in: oldIds } } });
      await prisma.customerBalance.deleteMany({ where: { customerId: { in: oldIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: oldIds } } });
    }
    for (const [index, code] of CODES.entries()) {
      const response = await request(app.getHttpServer()).post('/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ externalCustomerCode: code, name: `عميل أعمار ${index + 1}` }).expect(201);
      ids.push(response.body.id);
    }
    const documentType = await prisma.documentType.findFirstOrThrow({ where: { organizationId: actor.organizationId } });
    const job = await prisma.importJob.create({
      data: { organizationId: actor.organizationId, fileName: 'aging-e2e.xlsx', fileHash: `aging-e2e-${Date.now()}`, uploadedBy: actor.id },
    });
    importJobId = job.id;
    await prisma.customerBalance.createMany({ data: [
      { customerId: ids[0], currencyCode: 'YER', accountingBalance: 150, lastImportJobId: job.id },
      { customerId: ids[1], currencyCode: 'YER', accountingBalance: 500, lastImportJobId: job.id },
    ] });
    await prisma.importedTransaction.createMany({ data: [
      { customerId: ids[0], currencyCode: 'YER', documentTypeId: documentType.id, txDate: new Date('2026-03-01'), debit: 100, credit: 0, lineHash: `aging-old-${Date.now()}`, importJobId: job.id },
      { customerId: ids[0], currencyCode: 'YER', documentTypeId: documentType.id, txDate: new Date('2026-07-20'), debit: 200, credit: 0, lineHash: `aging-new-${Date.now()}`, importJobId: job.id },
      { customerId: ids[0], currencyCode: 'YER', documentTypeId: documentType.id, txDate: new Date('2026-08-01'), debit: 0, credit: 150, lineHash: `aging-pay-${Date.now()}`, importJobId: job.id },
    ] });
  });

  afterAll(async () => {
    if (prisma && ids.length) {
      await prisma.agingSnapshot.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.importedTransaction.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.customerBalance.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
      await prisma.importJob.delete({ where: { id: importJobId } });
    }
    if (app) await app.close();
  });

  it('applies FIFO and keeps balances without dated movements in undated', async () => {
    const response = await request(app.getHttpServer()).get('/reports/aging')
      .set('Authorization', `Bearer ${token}`).expect(200);
    const fifo = response.body.customers.find((x: any) => x.customerId === ids[0]);
    const undated = response.body.customers.find((x: any) => x.customerId === ids[1]);
    expect(fifo.buckets.bucket_120_plus).toBe(0);
    expect(fifo.buckets.bucket_0_30).toBe(150);
    expect(undated.buckets.undated).toBe(500);
    expect(undated.buckets.bucket_0_30).toBe(0);
  });

  it('creates and reproduces an immutable dated snapshot through the API', async () => {
    const created = await request(app.getHttpServer()).post('/reports/aging/snapshots')
      .set('Authorization', `Bearer ${token}`).expect(201);
    const snapshot = await request(app.getHttpServer()).get(`/reports/aging?asOf=${created.body.asOf}`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(snapshot.body.snapshot).toBe(true);
    // اللقطة على مستوى المنشأة وقد تحتوي fixtures من ملفات E2E أخرى؛
    // تحقق من صفوف هذا السيناريو فقط حتى يبقى الاختبار مستقلاً عن ترتيب الملفات.
    expect(snapshot.body.customers.filter((row: any) => ids.includes(row.customerId))).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'aging_snapshot_created', entityId: created.body.asOf } })).toBeGreaterThan(0);
  });
});
