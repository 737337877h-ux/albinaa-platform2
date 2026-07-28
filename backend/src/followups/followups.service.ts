import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFollowupDto } from './dto/create-followup.dto';
import { QueryFollowupsDto } from './dto/query-followups.dto';
import { UpdateFollowupDto } from './dto/update-followup.dto';

@Injectable()
export class FollowupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** نطاق الرؤية: بلا customers.read_all → متابعات عملائه المسندين فقط. */
  private async scope(user: AuthUser): Promise<Prisma.FollowupWhereInput> {
    const base: Prisma.FollowupWhereInput = {
      deletedAt: null,
      customer: { organizationId: user.organizationId },
    };
    if (user.permissions.includes('customers.read_all')) return base;
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (!collector) return { ...base, id: 'no-access' };
    return {
      ...base,
      customer: {
        organizationId: user.organizationId,
        assignments: { some: { collectorId: collector.id, effectiveTo: null } },
      },
    };
  }

  private async assertCustomerInScope(user: AuthUser, customerId: string) {
    const where: Prisma.CustomerWhereInput = { id: customerId, organizationId: user.organizationId };
    if (!user.permissions.includes('customers.read_all')) {
      const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
      if (!collector) throw new ForbiddenException('خارج نطاق صلاحيتك');
      where.assignments = { some: { collectorId: collector.id, effectiveTo: null } };
    }
    const c = await this.prisma.customer.findFirst({ where });
    if (!c) throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');
    return c;
  }

  async create(actor: AuthUser, dto: CreateFollowupDto, req?: Request) {
    await this.assertCustomerInScope(actor, dto.customerId);
    if (dto.expectedAmount && !dto.expectedCurrency) {
      throw new BadRequestException('المبلغ المتوقع يتطلب تحديد العملة');
    }
    const [type, result] = await Promise.all([
      this.prisma.followupType.findFirst({
        where: { id: dto.typeId, organizationId: actor.organizationId, active: true },
      }),
      this.prisma.followupResult.findFirst({
        where: { id: dto.resultId, organizationId: actor.organizationId, active: true },
      }),
    ]);
    if (!type) throw new BadRequestException('نوع المتابعة غير موجود أو معطل');
    if (!result) throw new BadRequestException('نتيجة المتابعة غير موجودة أو معطلة');

    const followup = await this.prisma.followup.create({
      data: {
        customerId: dto.customerId,
        userId: actor.id,
        typeId: dto.typeId,
        resultId: dto.resultId,
        followupAt: dto.followupAt ? new Date(dto.followupAt) : new Date(),
        notes: dto.notes,
        nextFollowupDate: dto.nextFollowupDate ? new Date(dto.nextFollowupDate) : null,
        expectedAmount: dto.expectedAmount,
        expectedCurrency: dto.expectedCurrency,
        visitLat: dto.visitLat,
        visitLng: dto.visitLng,
      },
      include: { type: true, result: true },
    });

    await this.audit.log({
      userId: actor.id, action: 'followup_created', entityTable: 'followups', entityId: followup.id,
      newValue: { customerId: dto.customerId, type: type.name, result: result.name }, req,
    });
    return followup;
  }

  async findAll(user: AuthUser, q: QueryFollowupsDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const where = await this.scope(user);
    if (q.customerId) (where.customer as any) = { ...(where.customer as any), id: q.customerId };
    if (q.collectorUserId) where.userId = q.collectorUserId;
    if (q.fromDate || q.toDate) {
      where.followupAt = {};
      if (q.fromDate) (where.followupAt as any).gte = new Date(q.fromDate);
      if (q.toDate) (where.followupAt as any).lte = new Date(q.toDate);
    }
    const [total, items] = await Promise.all([
      this.prisma.followup.count({ where }),
      this.prisma.followup.findMany({
        where,
        include: {
          type: { select: { name: true } },
          result: { select: { name: true } },
          user: { select: { fullName: true } },
          customer: { select: { id: true, name: true, externalCustomerCode: true } },
        },
        orderBy: { followupAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { page, limit, total, totalPages: Math.ceil(total / limit), items };
  }

  async findOne(user: AuthUser, id: string) {
    const where = await this.scope(user);
    const f = await this.prisma.followup.findFirst({
      where: { ...where, id },
      include: { type: true, result: true, user: { select: { fullName: true } }, customer: true },
    });
    if (!f) throw new NotFoundException('المتابعة غير موجودة أو خارج نطاق صلاحيتك');
    return f;
  }

  /** التعديل: منفذ المتابعة نفسه، أو من يملك users.manage (إجراء إداري مسجَّل). */
  private assertCanMutate(actor: AuthUser, ownerId: string) {
    if (ownerId !== actor.id && !actor.permissions.includes('users.manage')) {
      throw new ForbiddenException('تعديل متابعة الغير يتطلب صلاحية إدارية');
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateFollowupDto, req?: Request) {
    const before = await this.findOne(actor, id);
    this.assertCanMutate(actor, before.userId);
    if (dto.expectedAmount && !dto.expectedCurrency && !before.expectedCurrency) {
      throw new BadRequestException('المبلغ المتوقع يتطلب تحديد العملة');
    }
    const updated = await this.prisma.followup.update({
      where: { id },
      data: {
        typeId: dto.typeId,
        resultId: dto.resultId,
        followupAt: dto.followupAt ? new Date(dto.followupAt) : undefined,
        notes: dto.notes,
        nextFollowupDate: dto.nextFollowupDate ? new Date(dto.nextFollowupDate) : undefined,
        expectedAmount: dto.expectedAmount,
        expectedCurrency: dto.expectedCurrency,
        visitLat: dto.visitLat,
        visitLng: dto.visitLng,
      },
      include: { type: true, result: true },
    });
    await this.audit.log({
      userId: actor.id, action: 'followup_updated', entityTable: 'followups', entityId: id,
      oldValue: { notes: before.notes, nextFollowupDate: before.nextFollowupDate },
      newValue: dto, req,
    });
    return updated;
  }

  /** حذف ناعم فقط — السجل يبقى للتدقيق (لا حذف فعلي أبدًا). */
  async softDelete(actor: AuthUser, id: string, req?: Request) {
    const before = await this.findOne(actor, id);
    this.assertCanMutate(actor, before.userId);
    await this.prisma.followup.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: actor.id },
    });
    await this.audit.log({
      userId: actor.id, action: 'followup_soft_deleted', entityTable: 'followups', entityId: id, req,
    });
    return { message: 'حُذفت المتابعة (حذف ناعم — السجل محفوظ للتدقيق)' };
  }

  // --------------------------------------------------------------------------
  // أنواع ونتائج المتابعات — قائمة منسدلة
  // --------------------------------------------------------------------------

  async listTypes(user: AuthUser) {
    return this.prisma.followupType.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async listResults(user: AuthUser) {
    return this.prisma.followupResult.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
