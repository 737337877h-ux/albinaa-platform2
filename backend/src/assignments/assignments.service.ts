import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(
    user: AuthUser,
    f: { collectorId?: string; customerId?: string; currentOnly?: boolean },
  ) {
    const where: Prisma.CustomerAssignmentWhereInput = {
      customer: { organizationId: user.organizationId },
    };
    if (f.collectorId) where.collectorId = f.collectorId;
    if (f.customerId) where.customerId = f.customerId;
    if (f.currentOnly) where.effectiveTo = null;
    return this.prisma.customerAssignment.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        collector: { include: { user: { select: { fullName: true } } } },
        assigner: { select: { fullName: true } },
      },
      orderBy: [{ customerId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /** إعادة استخدام منطق النقل الموحد من CustomersService (قاعدة إسناد حالي واحد + حفظ التاريخ). */
  async create(actor: AuthUser, dto: CreateAssignmentDto, req?: Request) {
    const result = await this.customers.assignCollector(
      actor, dto.customerId,
      { collectorId: dto.collectorId, effectiveFrom: dto.effectiveFrom, reason: dto.reason },
      req,
    );
    // إشعار المحصل الجديد بنقل العميل إليه
    const collector = await this.prisma.collector.findUniqueOrThrow({
      where: { id: dto.collectorId },
    });
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: dto.customerId }, select: { name: true, externalCustomerCode: true },
    });
    await this.notifications.notifyUser(collector.userId, 'customer_transferred', {
      customerId: dto.customerId,
      customerName: customer.name,
      customerCode: customer.externalCustomerCode,
      reason: dto.reason ?? null,
    });
    return result;
  }

  async end(actor: AuthUser, id: string, req?: Request) {
    const assignment = await this.prisma.customerAssignment.findFirst({
      where: { id, effectiveTo: null, customer: { organizationId: actor.organizationId } },
    });
    if (!assignment) throw new NotFoundException('الإسناد الحالي غير موجود (أو أُنهي مسبقًا)');
    const ended = await this.prisma.customerAssignment.update({
      where: { id },
      data: { effectiveTo: new Date() },
    });
    await this.audit.log({
      userId: actor.id, action: 'assignment_ended', entityTable: 'customers',
      entityId: assignment.customerId,
      oldValue: { collectorId: assignment.collectorId }, req,
    });
    return ended;
  }
}
