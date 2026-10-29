import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };

describe('Message tracking and automatic debt escalation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let actorId: string;
  let organizationId: string;
  let customerId: string;
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
    actorId = actor.id;
    organizationId = actor.organizationId;

    const created = await request(app.getHttpServer()).post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ externalCustomerCode: '93991', name: 'عميل التصعيد والرسائل', phonePrimary: '777123456' })
      .expect(201);
    customerId = created.body.id;
    const job = await prisma.importJob.create({
      data: {
        organizationId, fileName: 'messaging-escalation-e2e.xlsx',
        fileHash: `messaging-escalation-${Date.now()}`, uploadedBy: actorId,
      },
    });
    importJobId = job.id;
    await prisma.customerBalance.create({
      data: { customerId, currencyCode: 'YER', accountingBalance: 250000, lastImportJobId: importJobId },
    });
    await prisma.debtAgingSummary.create({
      data: {
        importJobId, customerId, customerCode: '93991', currencyCode: 'YER',
        bucket_120_plus: 250000, totalDue: 250000, sourceRowNumber: 1,
        lineHash: `messaging-escalation-aging-${Date.now()}`,
      },
    });
    await prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId, key: 'smartTasks.enabled' } },
      update: { value: true }, create: { organizationId, key: 'smartTasks.enabled', value: true },
    });
  });

  afterAll(async () => {
    if (prisma && customerId) {
      await prisma.followup.deleteMany({ where: { customerId } });
      await prisma.task.deleteMany({ where: { customerId } });
      await prisma.debtAgingSummary.deleteMany({ where: { customerId } });
      await prisma.customerBalance.deleteMany({ where: { customerId } });
      await prisma.customer.delete({ where: { id: customerId } });
      await prisma.importJob.delete({ where: { id: importJobId } });
    }
    if (app) await app.close();
  });

  it('registers opening WhatsApp as an auditable customer follow-up', async () => {
    const response = await request(app.getHttpServer()).post('/followups/contact-event')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `whatsapp-${Date.now()}`)
      .send({
        customerId, channel: 'whatsapp', templateId: 'friendly-reminder',
        message: 'مرحبًا، نذكّركم بالسداد.',
      })
      .expect(201);
    expect(response.body.type.name).toBe('رسالة واتساب');
    expect(response.body.result.name).toBe('تم فتح تطبيق الإرسال');
    expect(response.body.notes).toContain('friendly-reminder');
    expect(await prisma.auditLog.count({
      where: { action: 'contact_app_opened', entityId: response.body.id },
    })).toBe(1);
  });

  it('creates the highest +120 legal escalation in Today Work without duplicates', async () => {
    const first = await request(app.getHttpServer()).post('/tasks/generate-today')
      .set('Authorization', `Bearer ${token}`).expect(201);
    expect(first.body.byTaskType.escalation_legal_120).toBe(1);

    const task = await prisma.task.findFirstOrThrow({ where: { customerId, status: 'open' } });
    expect(task.taskType).toBe('escalation_legal_120');
    expect(task.priorityReason).toContain('إنذار قانوني');

    await request(app.getHttpServer()).post('/tasks/generate-today')
      .set('Authorization', `Bearer ${token}`).expect(201);
    expect(await prisma.task.count({
      where: { customerId, taskType: 'escalation_legal_120', status: 'open' },
    })).toBe(1);
  });
});
