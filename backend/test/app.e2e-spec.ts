/**
 * اختبارات E2E — Milestone 2
 * المتطلب: قاعدة بيانات مهاجرة ومزروعة (npm run setup في جذر المشروع أولاً).
 * تغطي الـ13 سيناريو المطلوبة في معايير القبول.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

describe('AlBinaa API — Milestone 2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshToken: string;
  let createdUserId: string;
  const uniq = Date.now().toString(36);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // حماية من خطأ ثانوي يُخفي السبب الجذري إن فشلت تهيئة التطبيق (مثل رفض
    // env.validation لأسرار JWT التجريبية) قبل أن يُسنَد app أصلاً.
    if (app) {
      await app.close();
    }
  });

  // 11) Health Check
  it('GET /health يعيد حالة الخدمة بدون أسرار', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeDefined();
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');
  });

  // 12) اتصال قاعدة البيانات
  it('GET /health/database يؤكد الاتصال', async () => {
    const res = await request(app.getHttpServer()).get('/health/database').expect(200);
    expect(res.body.database).toBe('connected');
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // 2) Login بكلمة مرور خاطئة
  it('POST /auth/login يرفض كلمة مرور خاطئة برسالة موحدة', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: ADMIN.username, password: 'wrong-password-123' })
      .expect(401);
    expect(res.body.message).toContain('غير صحيحة');
    expect(JSON.stringify(res.body)).not.toContain('hash');
  });

  // 1 + 4) Login ناجح مع Access و Refresh Tokens
  it('POST /auth/login ينجح بمستخدم Seed ويصدر التوكنين', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN)
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.passwordHash).toBeUndefined(); // لا hash في أي استجابة
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  // 6) الوصول إلى Endpoint محمي
  it('GET /auth/me يعمل بالتوكن ويعيد الأدوار والصلاحيات', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.roles).toContain('مدير النظام');
    expect(res.body.permissions).toContain('users.manage');
  });

  it('GET /users بدون توكن يُرفض 401', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  // 5) Refresh Token صالح (مع تدوير)
  it('POST /auth/refresh يصدر توكنات جديدة ويبطل القديم', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    const oldRefresh = refreshToken;
    refreshToken = res.body.refreshToken;
    accessToken = res.body.accessToken;
    // القديم أصبح غير صالح (تدوير)
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);
  });

  // 5) Refresh Token غير صالح
  it('POST /auth/refresh يرفض توكنًا مزيفًا', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'fake-token-value-1234567890' })
      .expect(401);
  });

  // 9) إنشاء مستخدم
  it('POST /users ينشئ مستخدمًا جديدًا (بصلاحية users.manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username: `collector_${uniq}`,
        fullName: 'محصل تجريبي',
        password: 'Test1234pass',
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.passwordHash).toBeUndefined();
    createdUserId = res.body.id;
  });

  // 10) منع تكرار اسم المستخدم
  it('POST /users يرفض اسم مستخدم مكررًا', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ username: `collector_${uniq}`, fullName: 'مكرر', password: 'Test1234pass' })
      .expect(409);
  });

  // Mass assignment: حقل دخيل يُرفض
  it('POST /users يرفض الحقول الدخيلة (forbidNonWhitelisted)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username: `x_${uniq}`, fullName: 'x', password: 'Test1234pass',
        isActive: true, organizationId: 'hacked', // حقول غير مسموح بها في DTO
      })
      .expect(400);
  });

  // 7 + 8) الصلاحيات: مستخدم بلا صلاحية يُرفض، وبصلاحية ينجح
  it('مستخدم بدون users.manage يُرفض 403، والمدير ينجح', async () => {
    // دخول بالمستخدم الجديد (بلا أدوار)
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: `collector_${uniq}`, password: 'Test1234pass' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403); // يملك حسابًا صالحًا لكن بلا صلاحية

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200); // المدير يملك الصلاحية
  });

  // 3) منع المستخدم المعطل
  it('المستخدم المعطل لا يستطيع تسجيل الدخول وجلساته تُبطل', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: `collector_${uniq}`, password: 'Test1234pass' })
      .expect(401);
    // نفس رسالة الفشل الموحدة — لا كشف لسبب الرفض
    expect(res.body.message).toContain('غير صحيحة');
  });

  it('يمنع تعطيل آخر مدير نظام نشط', async () => {
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    await request(app.getHttpServer())
      .patch(`/users/${me.body.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false })
      .expect(400);
  });

  // Audit log فعلي في القاعدة
  it('Audit Log سجّل عمليات الدخول وإنشاء المستخدم', async () => {
    const loginLogs = await prisma.auditLog.count({ where: { action: 'login_success' } });
    const failedLogs = await prisma.auditLog.count({ where: { action: 'login_failed' } });
    const createdLogs = await prisma.auditLog.count({ where: { action: 'user_created' } });
    expect(loginLogs).toBeGreaterThan(0);
    expect(failedLogs).toBeGreaterThan(0);
    expect(createdLogs).toBeGreaterThan(0);
  });

  // Logout يبطل الجلسة
  it('POST /auth/logout يبطل Refresh Token', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});
