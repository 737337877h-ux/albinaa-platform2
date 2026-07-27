import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const startedAt = Date.now();

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** حالة الـ API — بدون أي أسرار أو تفاصيل بنية تحتية. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'حالة الخدمة' })
  health() {
    return {
      status: 'ok',
      version: process.env.APP_VERSION ?? '0.2.0',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /** حالة قاعدة البيانات مع زمن الاستجابة. */
  @Public()
  @Get('database')
  @ApiOperation({ summary: 'حالة قاعدة البيانات' })
  async database() {
    const t0 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected', latencyMs: Date.now() - t0 };
    } catch {
      // لا نُسرّب رسالة الخطأ الأصلية (قد تحتوي DSN)
      throw new ServiceUnavailableException('قاعدة البيانات غير متاحة');
    }
  }
}
