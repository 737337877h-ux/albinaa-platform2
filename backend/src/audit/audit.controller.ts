import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditDto } from './dto/query-audit.dto';

@ApiTags('Audit Log')
@ApiBearerAuth('access-token')
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'سجل التدقيق مع Pagination والتصفية حسب الفعل والكيان والمستخدم والفترة' })
  async findAll(@Query() q: QueryAuditDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (q.action) where.action = q.action;
    if (q.entityTable) where.entityTable = q.entityTable;
    if (q.entityId) where.entityId = q.entityId;
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
