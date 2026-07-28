import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const ID_KEY = 'test-idem-0001-0000-000000000001';
const uniq = `idem${Date.now().toString(36)}`;

describe('Idempotency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerId: string;
  let typeId: string;
  let resultId: string;
  let methodId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;

    const customers = await request(app.getHttpServer())
      .get('/mobile/customers').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    customerId = customers.body?.[0]?.id;

    const types = await request(app.getHttpServer())
      .get('/followups/types').set('Authorization', `Bearer ${adminToken}`).expect(200);
    typeId = types.body[0]?.id;
    const results = await request(app.getHttpServer())
      .get('/followups/results').set('Authorization', `Bearer ${adminToken}`).expect(200);
    resultId = results.body[0]?.id;
    const methods = await request(app.getHttpServer())
      .get('/collections/methods').set('Authorization', `Bearer ${adminToken}`).catch(() => ({ body: [] }));
    methodId = methods.body[0]?.id || (await prisma.collectionMethod.findFirstOrThrow()).id;

    // Create a collector record for admin and assign customer
    const me = await request(app.getHttpServer())
      .get('/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(200);
    let adminCollector = await prisma.collector.findUnique({ where: { userId: me.body.id } });
    if (!adminCollector) {
      adminCollector = await prisma.collector.create({ data: { userId: me.body.id, active: true } });
    } else if (!adminCollector.active) {
      await prisma.collector.update({ where: { id: adminCollector.id }, data: { active: true } });
    }
    // Ensure customer is assigned to admin's collector
    const existingAssignment = await prisma.customerAssignment.findFirst({
      where: { customerId, collectorId: adminCollector.id, effectiveTo: null },
    });
    if (!existingAssignment) {
      await request(app.getHttpServer())
        .post('/assignments').set('Authorization', `Bearer ${adminToken}`)
        .send({ customerId, collectorId: adminCollector.id, reason: 'Idempotency test' })
        .expect(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('should create a followup with idempotency key and return same on retry', async () => {
    const payload = { customerId, typeId, resultId, notes: 'Idempotency test' };

    const res1 = await request(app.getHttpServer())
      .post('/followups').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', ID_KEY + '-fup').send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body).toHaveProperty('id');
    expect(res1.headers['x-idempotent-replayed']).toBeUndefined();

    const res2 = await request(app.getHttpServer())
      .post('/followups').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', ID_KEY + '-fup').send(payload)
      .expect(201);

    expect(res2.body.id).toBe(res1.body.id);
    expect(res2.headers['x-idempotent-replayed']).toBe('true');
  });

  it('should create a promise with idempotency key and return same on retry', async () => {
    const payload = {
      customerId,
      expectedAmount: 500,
      currencyCode: 'SAR',
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      notes: 'Idempotency test promise',
    };

    const res1 = await request(app.getHttpServer())
      .post('/payment-promises').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', ID_KEY + '-prom').send(payload)
      .expect(201);

    expect(res1.body).toHaveProperty('id');

    const res2 = await request(app.getHttpServer())
      .post('/payment-promises').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', ID_KEY + '-prom').send(payload)
      .expect(201);

    expect(res2.body.id).toBe(res1.body.id);
    expect(res2.headers['x-idempotent-replayed']).toBe('true');
  });

  it('should create a collection with idempotency key and return same on retry', async () => {
    const payload = {
      customerId,
      amount: 250,
      currencyCode: 'SAR',
      methodId,
      notes: 'Idempotency test collection',
    };

    const res1 = await request(app.getHttpServer())
      .post('/collections').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', ID_KEY + '-coll').send(payload)
      .expect(201);

    expect(res1.body).toHaveProperty('id');

    const res2 = await request(app.getHttpServer())
      .post('/collections').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', ID_KEY + '-coll').send(payload)
      .expect(201);

    expect(res2.body.id).toBe(res1.body.id);
    expect(res2.headers['x-idempotent-replayed']).toBe('true');
  });

  it('should handle concurrent requests with same idempotency key gracefully', async () => {
    const payload = { customerId, typeId, resultId, notes: 'Race condition test' };
    const key = ID_KEY + '-race';

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/followups').set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key).send(payload),
      request(app.getHttpServer())
        .post('/followups').set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key).send(payload),
    ]);

    const statuses = [r1.status, r2.status];
    expect(statuses).toContain(201);

    if (r1.status === 201 && r2.status === 201) {
      expect(r2.body.id).toBe(r1.body.id);
    }
  });

  it('should not store idempotency key on failed request', async () => {
    const key = ID_KEY + '-fail';

    await request(app.getHttpServer())
      .post('/followups').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ customerId: '00000000-0000-0000-0000-000000000000' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/followups').set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ customerId: '00000000-0000-0000-0000-000000000000' })
      .expect(400);
  });

  it('should work without idempotency key (backward compatible)', async () => {
    await request(app.getHttpServer())
      .post('/followups').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, typeId, resultId, notes: 'No idempotency key' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.idempotencyKey.deleteMany({
      where: { key: { startsWith: 'POST:/followups:' } },
    }).catch(() => {});
    await prisma.idempotencyKey.deleteMany({
      where: { key: { startsWith: 'POST:/payment-promises:' } },
    }).catch(() => {});
    await prisma.idempotencyKey.deleteMany({
      where: { key: { startsWith: 'POST:/collections:' } },
    }).catch(() => {});
  });
});