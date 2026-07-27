import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ---- الأمان -------------------------------------------------------------
  app.use(helmet());
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: true });

  // requestId لكل طلب (يُستخدم في الأخطاء الموحدة وسجل التدقيق)
  app.use(new RequestIdMiddleware().use);

  // ---- التحقق من المدخلات: يمنع Mass Assignment ---------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // يحذف أي حقل غير معرّف في DTO
      forbidNonWhitelisted: true, // ويرفض الطلب إذا احتوى حقولًا دخيلة
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // ---- Swagger ------------------------------------------------------------
  const swaggerCfg = new DocumentBuilder()
    .setTitle('AlBinaa Credit & Collection API')
    .setDescription('منصة البناء الراقي لإدارة المديونية والتحصيل — Milestone 2: API Foundation')
    .setVersion(process.env.APP_VERSION ?? '0.2.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access Token' },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // لا تُسجَّل أسرار أو Tokens في السجلات أبدًا
  console.log(`✅ AlBinaa API يعمل على المنفذ ${port} — Swagger: /docs — البيئة: ${process.env.NODE_ENV}`);
}
bootstrap();
