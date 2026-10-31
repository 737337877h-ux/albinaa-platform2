import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('Reservation units and summary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let customerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const customer = await prisma.customer.create({
      data: {
        organizationId: admin.organizationId,
        externalCustomerCode: `RES-${Date.now()}`,
        name: 'عميل اختبار الحجوزات',
        nameNormalized: 'عميل اختبار الحجوزات',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (prisma && customerId) {
      await prisma.reservation.deleteMany({ where: { customerId } });
      await prisma.customer.delete({ where: { id: customerId } });
    }
    if (app) await app.close();
  });

  it('creates one reservation for concurrent submissions and offline retries of the same operation', async () => {
    const operationId = `reservation-retry-${Date.now()}`;
    const body = { customerId, totalTons: 4.5, unitPrice: 380000, currencyCode: 'YER' };
    const submit = (data = body, key = operationId) => request(app.getHttpServer()).post('/reservations')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(data);
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    const retry = await submit().expect(201);
    expect(retry.body.id).toBe(responses[0].body.id);
    expect(await prisma.reservation.count({ where: { id: retry.body.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: retry.body.id, action: 'reservation_created' } })).toBe(1);
    await submit({ ...body, totalTons: 5 }).expect(409);
    const separate = await submit(body, `${operationId}-new-order`).expect(201);
    expect(separate.body.id).not.toBe(retry.body.id);
    // The summary baseline below must not include this test's orders.
    await prisma.reservation.deleteMany({ where: { id: { in: [retry.body.id, separate.body.id] } } });
  });

  it('uses normalized units and returns one-query currency-safe summary', async () => {
    const units = await request(app.getHttpServer())
      .get('/reservations/units')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ton = units.body.find((unit: any) => unit.code === 'TON');
    const piece = units.body.find((unit: any) => unit.code === 'PCS');
    expect(ton.weightKg).toBe(1000);
    expect(piece.weightKg).toBeNull();

    const baseline = (await request(app.getHttpServer())
      .get('/reservations/summary').set('Authorization', `Bearer ${token}`).expect(200)).body;
    const amount = (summary: any, currency: string) => Number(
      summary.totalsByCurrency.find((row: any) => row.currency === currency)?.amount ?? 0,
    );
    const unweightedQty = (summary: any, unitName: string) => Number(
      summary.unweightedUnits.find((row: any) => row.unitName === unitName)?.qty ?? 0,
    );

    const create = (body: Record<string, unknown>) => request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, itemName: 'صنف تجريبي', ...body });

    const activeTon = await create({
      totalTons: 2, unitId: ton.id, unitPrice: 100, currencyCode: 'YER', expiresAt: dateOffset(5),
    }).expect(201);
    await create({
      totalTons: 3, unitId: piece.id, unitPrice: 50, currencyCode: 'SAR', expiresAt: dateOffset(10),
    }).expect(201);
    await create({
      totalTons: 9, unitId: ton.id, unitPrice: 999, currencyCode: 'YER', expiresAt: dateOffset(-1),
    }).expect(201);

    const summary = await request(app.getHttpServer())
      .get('/reservations/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(summary.body.activeCount).toBe(baseline.activeCount + 2);
    expect(summary.body.customerCount).toBe(baseline.customerCount + 1);
    expect(summary.body.totalTons).toBeCloseTo(baseline.totalTons + 5, 6);
    expect(summary.body.expiringIn7Days).toBe(baseline.expiringIn7Days + 1);
    expect(amount(summary.body, 'SAR')).toBeCloseTo(amount(baseline, 'SAR') + 150, 6);
    expect(amount(summary.body, 'YER')).toBeCloseTo(amount(baseline, 'YER') + 200, 6);
    expect(unweightedQty(summary.body, 'حبة')).toBeCloseTo(unweightedQty(baseline, 'حبة') + 3, 6);

    await request(app.getHttpServer())
      .post(`/reservations/${activeTon.body.id}/issue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 0.5 })
      .expect(201);
    const afterIssue = await request(app.getHttpServer())
      .get('/reservations/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterIssue.body.totalTons).toBeCloseTo(baseline.totalTons + 4.5, 6);
    expect(amount(afterIssue.body, 'YER')).toBeCloseTo(amount(baseline, 'YER') + 150, 6);
  });
});
