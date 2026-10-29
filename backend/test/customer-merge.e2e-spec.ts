import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reversible customer merge (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('moves records, consolidates by currency, preserves aliases, and reverses within 24 hours', async () => {
    const org = await prisma.organization.findFirstOrThrow();
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const [master, source] = await Promise.all([
      prisma.customer.create({
        data: {
          organizationId: org.id, externalCustomerCode: 'MERGE-MASTER',
          name: 'شركة الدمج', nameNormalized: 'شركة الدمج', phonePrimary: '777111111',
        },
      }),
      prisma.customer.create({
        data: {
          organizationId: org.id, externalCustomerCode: 'MERGE-SOURCE',
          name: 'شركه الدمج', nameNormalized: 'شركه الدمج', phonePrimary: '777222222',
        },
      }),
    ]);
    await prisma.customerBalance.createMany({
      data: [
        { customerId: master.id, currencyCode: 'YER', accountingBalance: 100, openingDebit: 100 },
        { customerId: source.id, currencyCode: 'YER', accountingBalance: 200, openingDebit: 200 },
        { customerId: source.id, currencyCode: 'SAR', accountingBalance: 50, openingDebit: 50 },
      ],
    });
    const task = await prisma.task.create({
      data: { customerId: source.id, taskType: 'merge_test', dueDate: new Date('2026-08-10') },
    });
    const immutableLedger = await prisma.operationalLedger.create({
      data: {
        customerId: source.id, currencyCode: 'YER', entryType: 'manual_adjustment_documented', amountSigned: -10,
        sourceTable: 'merge_test', sourceId: task.id, createdBy: admin.id,
      },
    });
    const pair = await prisma.potentialDuplicateCustomer.create({
      data: { customerAId: master.id, customerBId: source.id, matchReason: 'اختبار دمج قابل للتراجع' },
    });

    const merged = await request(app.getHttpServer())
      .post(`/customers/duplicates/${pair.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `merge-${pair.id}`)
      .send({ masterCustomerId: master.id, confirmText: 'دمج' })
      .expect(201);

    const [masterAfter, sourceAfter, movedTask] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: master.id }, include: { balances: true } }),
      prisma.customer.findUniqueOrThrow({ where: { id: source.id } }),
      prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
    ]);
    expect(sourceAfter.status).toBe('merged');
    expect(sourceAfter.mergedIntoId).toBe(master.id);
    expect(movedTask.customerId).toBe(master.id);
    expect((await prisma.operationalLedger.findUniqueOrThrow({ where: { id: immutableLedger.id } })).customerId).toBe(source.id);
    expect(Number(masterAfter.balances.find((b) => b.currencyCode === 'YER')?.accountingBalance)).toBe(300);
    expect(Number(masterAfter.balances.find((b) => b.currencyCode === 'SAR')?.accountingBalance)).toBe(50);

    const aliasSearch = await request(app.getHttpServer())
      .get('/customers?search=MERGE-SOURCE')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(aliasSearch.body.items.map((item: any) => item.id)).toContain(master.id);
    expect(aliasSearch.body.items.map((item: any) => item.id)).not.toContain(source.id);

    await request(app.getHttpServer())
      .post(`/customers/duplicates/merges/${merged.body.mergeId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `reverse-${merged.body.mergeId}`)
      .send({ confirmText: 'تراجع' })
      .expect(201);

    const [masterRestored, sourceRestored, restoredTask, restoredPair] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: master.id }, include: { balances: true } }),
      prisma.customer.findUniqueOrThrow({ where: { id: source.id }, include: { balances: true } }),
      prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
      prisma.potentialDuplicateCustomer.findUniqueOrThrow({ where: { id: pair.id } }),
    ]);
    expect(sourceRestored.status).toBe('active');
    expect(sourceRestored.mergedIntoId).toBeNull();
    expect(restoredTask.customerId).toBe(source.id);
    expect((await prisma.operationalLedger.findUniqueOrThrow({ where: { id: immutableLedger.id } })).customerId).toBe(source.id);
    expect(Number(masterRestored.balances.find((b) => b.currencyCode === 'YER')?.accountingBalance)).toBe(100);
    expect(Number(sourceRestored.balances.find((b) => b.currencyCode === 'YER')?.accountingBalance)).toBe(200);
    expect(Number(sourceRestored.balances.find((b) => b.currencyCode === 'SAR')?.accountingBalance)).toBe(50);
    expect(restoredPair.reviewStatus).toBe('pending');
    expect(await prisma.customerAlias.count({ where: { mergeId: merged.body.mergeId } })).toBe(0);
  });
});
