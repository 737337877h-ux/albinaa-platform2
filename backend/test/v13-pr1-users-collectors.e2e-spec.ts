import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

/**
 * PR-A (v1.3) — إصلاحات إدارة المستخدمين والمحصلين:
 *  - إعادة تعيين كلمة المرور تقبل password (UI) و newPassword (API)
 *  - تغيير اسم المستخدم (فريد ضمن المنشأة، مُدقَّق)
 *  - إعادة ربط المحصل بمستخدم آخر (حارس فريد، مُدقَّق)
 */
describe('PR-A — Users & Collectors Administration fixes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const ts = Date.now().toString(36);
  const usernames = {
    a: `v13a_${ts}`,
    b: `v13b_${ts}`,
    c: `v13c_${ts}`,
    d: `v13d_${ts}`,
    dup: `v13dup_${ts}`,
    renamed: `v13a_renamed_${ts}`,
  };
  const ids: Record<string, string> = {};
  let collectorId: string;
  let collector2Id: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /auth/login كمدير', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = res.body.accessToken;
  });

  const createUser = async (key: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ username: usernames[key], fullName, password: 'Test1234pass' })
      .expect(201);
    ids[key] = res.body.id;
  };

  it('إنشاء المستخدمين اللازمين للاختبار', async () => {
    await createUser('a', 'مستخدم أ');
    await createUser('b', 'مستخدم ب');
    await createUser('c', 'مستخدم ج');
    await createUser('d', 'مستخدم د');
    await createUser('dup', 'مستخدم مكرر');
  });

  // -----------------------------------------------------------------------
  // إعادة تعيين كلمة المرور — العقد الجديد (newPassword) والعقد القديم (password)
  // -----------------------------------------------------------------------
  it('POST /users/:id/reset-password — newPassword (عقد API)', async () => {
    await request(app.getHttpServer())
      .post(`/users/${ids.a}/reset-password`).set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'NewPass123' })
      .expect(201);
  });

  it('POST /users/:id/reset-password — password (حقل الـ Admin UI) ويعمل فعليًا', async () => {
    await request(app.getHttpServer())
      .post(`/users/${ids.a}/reset-password`).set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'LegacyPass123' })
      .expect(201);

    // إثبات أن الحقل legacy طبّق كلمة المرور فعلًا
    await request(app.getHttpServer())
      .post('/auth/login').send({ username: usernames.a, password: 'LegacyPass123' })
      .expect(200);
  });

  it('POST /users/:id/reset-password — بدون كلمة مرور يعيد 400', async () => {
    await request(app.getHttpServer())
      .post(`/users/${ids.a}/reset-password`).set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });

  it('POST /users/:id/reset-password — لمستخدم غير موجود يعيد 404', async () => {
    await request(app.getHttpServer())
      .post(`/users/00000000-0000-0000-0000-000000000000/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'NewPass123' })
      .expect(404);
  });

  // -----------------------------------------------------------------------
  // تغيير اسم المستخدم
  // -----------------------------------------------------------------------
  it('PATCH /users/:id/username — تغيير ناجح', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/users/${ids.a}/username`).set('Authorization', `Bearer ${adminToken}`)
      .send({ username: usernames.renamed })
      .expect(200);
    expect(res.body.username).toBe(usernames.renamed);
  });

  it('تسجيل الدخول باسم المستخدم الجديد بعد التغيير', async () => {
    await request(app.getHttpServer())
      .post('/auth/login').send({ username: usernames.renamed, password: 'LegacyPass123' })
      .expect(200);
  });

  it('PATCH /users/:id/username — اسم مكرر يعيد 409', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${ids.a}/username`).set('Authorization', `Bearer ${adminToken}`)
      .send({ username: usernames.dup })
      .expect(409);
  });

  it('PATCH /users/:id/username — لمستخدم غير موجود يعيد 404', async () => {
    await request(app.getHttpServer())
      .patch(`/users/00000000-0000-0000-0000-000000000000/username`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'whatever' })
      .expect(404);
  });

  it('PATCH /users/:id/username — صيغة غير صالحة يعيد 400', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${ids.b}/username`).set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'bad name!' })
      .expect(400);
  });

  // -----------------------------------------------------------------------
  // إعادة ربط المحصل بمستخدم آخر
  // -----------------------------------------------------------------------
  it('POST /collectors — إنشاء محصل من المستخدم ب', async () => {
    const res = await request(app.getHttpServer())
      .post('/collectors').set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: ids.b })
      .expect(201);
    expect(res.body.userId).toBe(ids.b);
    collectorId = res.body.id;
  });

  it('PATCH /collectors/:id — إعادة الربط إلى مستخدم ج (نجاح)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/collectors/${collectorId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: ids.c })
      .expect(200);
    expect(res.body.userId).toBe(ids.c);
  });

  it('POST /collectors — إنشاء محصل ثانٍ من المستخدم د', async () => {
    const res = await request(app.getHttpServer())
      .post('/collectors').set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: ids.d })
      .expect(201);
    collector2Id = res.body.id;
  });

  it('PATCH /collectors/:id — ربط مستخدم مرتبط بمحصل آخر يعيد 409', async () => {
    await request(app.getHttpServer())
      .patch(`/collectors/${collectorId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: ids.d })
      .expect(409);
  });

  it('PATCH /collectors/:id — ربط مستخدم من منشأة أخرى/غير موجود يعيد 404', async () => {
    await request(app.getHttpServer())
      .patch(`/collectors/${collectorId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });

  it('PATCH /collectors/:id — نفس المستخدم الحالي لا يعتبر تعارضًا', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/collectors/${collectorId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: ids.c })
      .expect(200);
    expect(res.body.userId).toBe(ids.c);
  });

  it('PATCH /collectors/:id — يمنع تكرار المحصل عند الإنشاء (409)', async () => {
    await request(app.getHttpServer())
      .post('/collectors').set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: ids.c })
      .expect(409);
  });

  // -----------------------------------------------------------------------
  // سجل التدقيق
  // -----------------------------------------------------------------------
  it('GET /audit — يسجل تغيير اسم المستخدم', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?action=user_username_changed').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = res.body.items.find((i: any) => i.entityId === ids.a);
    expect(entry).toBeDefined();
    expect(entry.entityTable).toBe('users');
    expect(entry.oldValue.username).toBe(usernames.a);
    expect(entry.newValue.username).toBe(usernames.renamed);
  });

  it('GET /audit — يسجل إعادة ربط المحصل', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?action=collector_updated').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = res.body.items.find(
      (i: any) => i.entityId === collectorId && i.oldValue?.userId === ids.b && i.newValue?.userId === ids.c,
    );
    expect(entry).toBeDefined();
    expect(entry.oldValue.userId).toBe(ids.b);
    expect(entry.newValue.userId).toBe(ids.c);
  });

  it('GET /audit — يسجل إعادة تعيين كلمة المرور بدون تسريبها', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit?action=user_password_reset').set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = res.body.items.find((i: any) => i.entityId === ids.a);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry.newValue ?? entry.oldValue ?? {})).not.toContain('LegacyPass123');
  });
});
