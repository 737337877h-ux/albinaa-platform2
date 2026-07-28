import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCollectorDto } from './dto/create-collector.dto';
import { UpdateCollectorDto } from './dto/update-collector.dto';

@Injectable()
export class CollectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(orgId: string) {
    return this.prisma.collector.findMany({
      where: { user: { organizationId: orgId } },
      include: {
        user: { select: { username: true, fullName: true, phone: true, isActive: true } },
        branch: { select: { name: true } },
      },
      orderBy: { user: { fullName: 'asc' } },
    });
  }

  async findOne(orgId: string, id: string) {
    const collector = await this.prisma.collector.findFirst({
      where: { id, user: { organizationId: orgId } },
      include: {
        user: { select: { username: true, fullName: true, phone: true, isActive: true } },
        branch: { select: { name: true } },
      },
    });
    if (!collector) throw new NotFoundException('المحصل غير موجود');
    return collector;
  }

  async create(actor: AuthUser, dto: CreateCollectorDto, req?: Request) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId: actor.organizationId },
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود في المنشأة');

    const existing = await this.prisma.collector.findUnique({
      where: { userId: dto.userId },
    });
    if (existing) throw new ConflictException('هذا المستخدم مضاف مسبقاً كمحصل');

    const collector = await this.prisma.collector.create({
      data: { userId: dto.userId, branchId: dto.branchId ?? null },
    });
    await this.audit.log({
      userId: actor.id, action: 'collector_created', entityTable: 'collectors', entityId: collector.id,
      newValue: { userId: dto.userId, branchId: dto.branchId }, req,
    });
    return collector;
  }

  async update(actor: AuthUser, id: string, dto: UpdateCollectorDto, req?: Request) {
    const before = await this.findOne(actor.organizationId, id);
    const data: Record<string, unknown> = {};
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
    if (dto.active !== undefined) data.active = dto.active;
    const collector = await this.prisma.collector.update({ where: { id }, data });
    await this.audit.log({
      userId: actor.id, action: 'collector_updated', entityTable: 'collectors', entityId: id,
      oldValue: { branchId: before.branch?.name, active: before.active },
      newValue: { branchId: dto.branchId, active: dto.active }, req,
    });
    return collector;
  }
}
