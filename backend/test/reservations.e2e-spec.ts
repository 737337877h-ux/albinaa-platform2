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

  it('uses normalized units and returns one-query currency-safe summary', async () => {
    const units = await request(app.getHttpServer())
      .get('/reservations/units')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ton = units.body.find((unit: any) => unit.code === 'TON');
    const piece = units.body.find((unit: any) => unit.code === 'PCS');
    expect(ton.weightKg).toBe(1000);
    expect(piece.weightKg).toBeNull();

    const create = (body: Record<string, unknown>) => request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, itemName: 'صنف تجريبي', ...body });

    const activeTon = await create({
      quantity: 2, unitId: ton.id, unitPrice: 100, currencyCode: 'YER', expiresAt: dateOffset(5),
    }).expect(201);
    await create({
      quantity: 3, unitId: piece.id, unitPrice: 50, currencyCode: 'SAR', expiresAt: dateOffset(10),
    }).expect(201);
    await create({
      quantity: 9, unitId: ton.id, unitPrice: 999, currencyCode: 'YER', expiresAt: dateOffset(-1),
    }).expect(201);

    const summary = await request(app.getHttpServer())
      .get('/reservations/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(summary.body.activeCount).toBe(2);
    expect(summary.body.customerCount).toBe(1);
    expect(summary.body.totalTons).toBe(2);
    expect(summary.body.expiringIn7Days).toBe(1);
    expect(summary.body.totalsByCurrency).toEqual([
      { currency: 'SAR', amount: 150 },
      { currency: 'YER', amount: 200 },
    ]);
    expect(summary.body.unweightedUnits).toEqual([{ unitName: 'حبة', qty: 3 }]);

    await request(app.getHttpServer())
      .post(`/reservations/${activeTon.body.id}/issue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 0.5 })
      .expect(201);
    const afterIssue = await request(app.getHttpServer())
      .get('/reservations/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterIssue.body.totalTons).toBe(1.5);
    expect(afterIssue.body.totalsByCurrency).toContainEqual({ currency: 'YER', amount: 150 });
  });
});
