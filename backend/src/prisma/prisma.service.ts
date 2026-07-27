import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * خدمة Prisma الموحدة:
 * - فحص الاتصال عند الإقلاع (يفشل التشغيل مبكرًا إذا كانت القاعدة غير متاحة).
 * - إغلاق الاتصال بأمان عند إيقاف الخدمة.
 * - كل الوصول للقاعدة يمر من هنا — Prisma يستخدم استعلامات مُعاملة تمنع SQL Injection.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    await this.$queryRaw`SELECT 1`;
    this.logger.log('✅ اتصال قاعدة البيانات سليم');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('تم إغلاق اتصال قاعدة البيانات بأمان');
  }
}
