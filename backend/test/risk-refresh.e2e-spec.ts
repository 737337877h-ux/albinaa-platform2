import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const CODES = ['92091', '92092'];

describe('Immediate risk refresh (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let firstId: string;
  let secondId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const old = await prisma.customer.findMany({
      where: { externalCustomerCode: { in: CODES } }, select: { id: true },
    });
    const oldIds = old.map((customer) => customer.id);
    if (oldIds.length) {
      await prisma.customerScore.deleteMany({ where: { customerId: { in: oldIds } } });
      await prisma.customerCreditPolicy.deleteMany({ where: { customerId: { in: oldIds } } });
      await prisma.customerBalance.deleteMany({ where: { customerId: { in: oldIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: oldIds } } });
    }
    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
    const first = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ externalCustomerCode: CODES[0], name: 'عميل حد الائتمان' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ externalCustomerCode: CODES[1], name: 'عميل المقارنة' })
      .expect(201);
    firstId = first.body.id;
    secondId = second.body.id;
    await prisma.customerBalance.createMany({
      data: [
        { customerId: firstId, currencyCode: 'YER', accountingBalance: 1_000 },
        { customerId: secondId, currencyCode: 'YER', accountingBalance: 500 },
      ],
    });
    await request(app.getHttpServer())
      .post('/risk/recalculate')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.customerScore.deleteMany({ where: { customerId: { in: [firstId, secondId] } } });
      await prisma.customerCreditPolicy.deleteMany({ where: { customerId: { in: [firstId, secondId] } } });
      await prisma.customerBalance.deleteMany({ where: { customerId: { in: [firstId, secondId] } } });
      await prisma.customer.deleteMany({ where: { id: { in: [firstId, secondId] } } });
    }
    if (app) await app.close();
  });

  it('updates only the affected customer and gives full balance points when over the credit limit', async () => {
    const secondBefore = await prisma.customerScore.findFirstOrThrow({ where: { customerId: secondId } });
    const response = await request(app.getHttpServer())
      .patch(`/customers/${firstId}/credit-policy`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        allowCreditSale: true,
        creditLimitAmount: 600,
        creditLimitCurrency: 'YER',
        creditStatus: 'open',
      })
      .expect(200);
    expect(Number(response.body.creditLimitAmount)).toBe(600);

    const risk = await request(app.getHttpServer())
      .get(`/customers/${firstId}/risk`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(risk.body.reasons.factors.balanceAmount.points).toBe(20);
    expect(risk.body.reasons.factors.balanceAmount.text).toContain('يتجاوز حد الائتمان');

    const secondAfter = await prisma.customerScore.findFirstOrThrow({ where: { customerId: secondId } });
    expect(secondAfter.id).toBe(secondBefore.id);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'risk_recalculated' }, orderBy: { createdAt: 'desc' },
    });
    expect((audit.newValue as any).source).toBe('credit_policy_changed');
    expect((audit.newValue as any).targetedCustomerIds).toEqual([firstId]);
  });
});
