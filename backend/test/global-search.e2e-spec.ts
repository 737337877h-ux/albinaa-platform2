import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

describe('Global command palette search (e2e)', () => {
  let app: INestApplication; let prisma: PrismaService; let adminToken: string; let customerId: string; let hiddenCustomerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
    prisma = app.get(PrismaService);
    adminToken = (await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200)).body.accessToken;
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const customer = await prisma.customer.create({ data: {
      organizationId: admin.organizationId, externalCustomerCode: 'CMD-9001', name: 'عميل لوحة الأوامر',
      nameNormalized: 'عميل لوحه الاوامر', phonePrimary: '777123456',
    } });
    customerId = customer.id;
    hiddenCustomerId = (await prisma.customer.create({ data: {
      organizationId: admin.organizationId, externalCustomerCode: 'SCOPE-HIDDEN-99', name: 'عميل مخفي عن المحصل',
      nameNormalized: 'عميل مخفي عن المحصل',
    } })).id;
    const documentType = await prisma.documentType.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
    const job = await prisma.importJob.create({ data: {
      organizationId: admin.organizationId, fileName: 'command-search.xlsx', fileHash: `command-${Date.now()}`, uploadedBy: admin.id,
    } });
    await prisma.importedTransaction.create({ data: {
      customerId, currencyCode: 'YER', documentTypeId: documentType.id, txDate: new Date('2026-08-02'),
      documentNumber: 'CMD-INV-777', debit: 2000, credit: 0, lineHash: `cmd-doc-${Date.now()}`, importJobId: job.id,
    } });
    const collectorId = (await prisma.collector.create({ data: { userId: admin.id } })).id;
    const method = await prisma.collectionMethod.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
    await prisma.collection.create({ data: {
      customerId, collectorId, currencyCode: 'YER', amount: 500, methodId: method.id,
      receiptNumber: 'R-2026-654321', referenceNumber: 'REF-CMD-1',
    } });
    await prisma.reservation.create({ data: {
      customerId, currencyCode: 'YER', creditAmount: 750, itemName: 'حديد بحث شامل',
      totalAmount: 750, documentNumber: 'RSV-CMD-88', status: 'open',
    } });
  });

  afterAll(async () => { if (app) await app.close(); });

  it('finds customers, receipts, document numbers, and reservations', async () => {
    const cases = [
      ['777123456', 'customer'], ['R-2026-654321', 'receipt'],
      ['CMD-INV-777', 'document'], ['RSV-CMD-88', 'reservation'],
    ];
    for (const [query, type] of cases) {
      const response = await request(app.getHttpServer()).get(`/search?q=${encodeURIComponent(query)}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(response.body.items.some((item: any) => item.type === type)).toBe(true);
      expect(response.body.items.every((item: any) => item.href.startsWith('/'))).toBe(true);
    }
    await request(app.getHttpServer()).get('/search?q=x').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });

  it('never leaks unassigned customers to a collector', async () => {
    const user = await request(app.getHttpServer()).post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'cmd_collector', fullName: 'محصل البحث', password: 'Test1234pass' }).expect(201);
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'المحصل' } });
    await request(app.getHttpServer()).post(`/users/${user.body.id}/roles`).set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [role.id] }).expect(201);
    const collector = await prisma.collector.create({ data: { userId: user.body.id } });
    await prisma.customerAssignment.create({ data: { customerId, collectorId: collector.id } });
    const token = (await request(app.getHttpServer()).post('/auth/login')
      .send({ username: 'cmd_collector', password: 'Test1234pass' }).expect(200)).body.accessToken;
    const visible = await request(app.getHttpServer()).get('/search?q=CMD-9001').set('Authorization', `Bearer ${token}`).expect(200);
    expect(visible.body.items.some((item: any) => item.type === 'customer' && item.id === customerId)).toBe(true);
    const hidden = await request(app.getHttpServer()).get('/search?q=SCOPE-HIDDEN-99').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hidden.body.items.some((item: any) => item.id === hiddenCustomerId)).toBe(false);
  });
});
