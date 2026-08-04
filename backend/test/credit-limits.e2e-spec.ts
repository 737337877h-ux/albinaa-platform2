import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

describe('Credit limits per currency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let limitedToken: string;
  let customerId: string;
  let unitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const adminLogin = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = adminLogin.body.accessToken;
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const role = await prisma.role.create({ data: { organizationId: admin.organizationId, name: `credit-e2e-${Date.now()}` } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['reservations.create', 'reservations.read'] } } });
    await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
    const user = await prisma.user.create({ data: {
      organizationId: admin.organizationId, username: `credit-user-${Date.now()}`, fullName: 'مستخدم بلا تجاوز',
      passwordHash: await argon2.hash('CreditTest!2026'),
    } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, grantedBy: admin.id } });
    limitedToken = (await request(app.getHttpServer()).post('/auth/login').send({ username: user.username, password: 'CreditTest!2026' }).expect(200)).body.accessToken;
    customerId = (await request(app.getHttpServer()).post('/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ externalCustomerCode: '94091', name: 'عميل سقف متعدد العملات' }).expect(201)).body.id;
    await prisma.customerBalance.create({ data: { customerId, currencyCode: 'YER', accountingBalance: 1_000 } });
    unitId = (await prisma.unit.findFirstOrThrow({ where: { isActive: true } })).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('stores independent limits and returns usage for each currency', async () => {
    await request(app.getHttpServer()).patch(`/customers/${customerId}/credit-limits/YER`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 1500, effectiveFrom: '2026-08-01', reason: 'اعتماد أولي' }).expect(200);
    await request(app.getHttpServer()).patch(`/customers/${customerId}/credit-limits/SAR`)
      .set('Authorization', `Bearer ${adminToken}`).send({ amount: 500, effectiveFrom: '2026-08-01' }).expect(200);
    const customer = await request(app.getHttpServer()).get(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(customer.body.creditLimits).toHaveLength(2);
    expect(customer.body.creditLimits.find((x: any) => x.currencyCode === 'YER')).toMatchObject({ amount: 1500, used: 1000 });
  });

  it('blocks exposure above the limit without permission and requires a reason for an override', async () => {
    const body = { customerId, itemName: 'حديد', quantity: 4, unitId, unitPrice: 100, currencyCode: 'YER' };
    await request(app.getHttpServer()).post('/reservations').set('Authorization', `Bearer ${limitedToken}`).send(body).expect(201);
    await request(app.getHttpServer()).post('/reservations').set('Authorization', `Bearer ${limitedToken}`)
      .send({ ...body, quantity: 2 }).expect(403);
    await request(app.getHttpServer()).post('/reservations').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...body, quantity: 2 }).expect(400);
    const overridden = await request(app.getHttpServer()).post('/reservations').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...body, quantity: 2, overrideReason: 'اعتماد المدير لمشروع عاجل' }).expect(201);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: overridden.body.id, action: 'reservation_created' } });
    expect(audit.reason).toBe('اعتماد المدير لمشروع عاجل');
    expect((audit.newValue as any).creditControl.overrideUsed).toBe(true);
  });
});
