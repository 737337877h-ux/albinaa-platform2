import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { BulkAssignmentDto } from './dto/bulk-assignment.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { SmartAssignmentDto } from './dto/smart-assignment.dto';

// Customer row shape used by bulk assignment planning: current (effectiveTo: null) assignment included.
type CustomerWithCurrentAssignment = Prisma.CustomerGetPayload<{ include: { assignments: true } }>;

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

  /** Active collectors in the org, usable as bulk assignment targets (no users.manage needed). */
  async listActiveCollectors(user: AuthUser) {
    const collectors = await this.prisma.collector.findMany({
      where: { active: true, user: { organizationId: user.organizationId } },
      include: { user: { select: { fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return collectors.map((c) => ({ id: c.id, name: c.user.fullName }));
  }

  // -------------------------------------------------------------------------
  // Bulk assignment: assign/transfer many customers to one target collector.
  // Same "close current + open new" rule as the single-customer assignCollector,
  // and only touches tasks with status 'open' (closed/done/cancelled are left untouched).
  // -------------------------------------------------------------------------
  private async loadBulkContext(actor: AuthUser, dto: BulkAssignmentDto) {
    const collector = await this.prisma.collector.findFirst({
      where: { id: dto.collectorId, active: true, user: { organizationId: actor.organizationId } },
      include: { user: { select: { fullName: true } } },
    });
    if (!collector) throw new BadRequestException('Target collector not found or inactive');

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: dto.customerIds }, organizationId: actor.organizationId },
      include: { assignments: { where: { effectiveTo: null } } },
    });
    return { collector, customers };
  }

  private planBulkAssign(dto: BulkAssignmentDto, customers: CustomerWithCurrentAssignment[]) {
    const skippedMissing = dto.customerIds.length - customers.length;
    let assignmentsClosed = 0;
    let assignmentsCreated = 0;
    let skippedAlready = 0;
    const changingIds: string[] = [];

    for (const c of customers) {
      const current = c.assignments[0] ?? null;
      if (current?.collectorId === dto.collectorId) {
        skippedAlready += 1;
        continue;
      }
      if (current) assignmentsClosed += 1;
      assignmentsCreated += 1;
      changingIds.push(c.id);
    }

    return {
      assignmentsClosed,
      assignmentsCreated,
      skipped: skippedMissing + skippedAlready,
      changingIds,
    };
  }

  /** Preview-only: computes what a bulk assign/transfer would do, without writing anything. */
  async previewBulkAssign(actor: AuthUser, dto: BulkAssignmentDto) {
    const { collector, customers } = await this.loadBulkContext(actor, dto);
    const plan = this.planBulkAssign(dto, customers);
    const tasksUpdated = plan.changingIds.length
      ? await this.prisma.task.count({
          where: { customerId: { in: plan.changingIds }, status: 'open' },
        })
      : 0;

    return {
      customersSelected: dto.customerIds.length,
      assignmentsClosed: plan.assignmentsClosed,
      assignmentsCreated: plan.assignmentsCreated,
      tasksUpdated,
      skipped: plan.skipped,
      targetCollector: collector.user.fullName,
    };
  }

  /** Executes a bulk assign/transfer of the selected customers to one target collector. */
  async executeBulkAssign(actor: AuthUser, dto: BulkAssignmentDto, req?: Request) {
    const { collector, customers } = await this.loadBulkContext(actor, dto);
    const plan = this.planBulkAssign(dto, customers);
    const now = new Date();

    let tasksUpdated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const c of customers) {
        const current = c.assignments[0] ?? null;
        if (current?.collectorId === dto.collectorId) continue;
        if (current) {
          await tx.customerAssignment.update({
            where: { id: current.id },
            data: { effectiveTo: now },
          });
        }
        await tx.customerAssignment.create({
          data: {
            customerId: c.id,
            collectorId: dto.collectorId,
            effectiveFrom: now,
            reason: dto.reason,
            assignedBy: actor.id,
          },
        });
      }
      if (plan.changingIds.length) {
        const updated = await tx.task.updateMany({
          where: { customerId: { in: plan.changingIds }, status: 'open' },
          data: { assignedTo: dto.collectorId },
        });
        tasksUpdated = updated.count;
      }
    });

    const newlyAssigned = plan.assignmentsCreated - plan.assignmentsClosed;
    const summary = {
      customersSelected: dto.customerIds.length,
      assignmentsClosed: plan.assignmentsClosed,
      assignmentsCreated: plan.assignmentsCreated,
      tasksUpdated,
      skipped: plan.skipped,
      targetCollector: collector.user.fullName,
    };

    if (newlyAssigned > 0) {
      await this.audit.log({
        userId: actor.id, action: 'bulk_assignment_created', entityTable: 'customer_assignments',
        newValue: { collectorId: dto.collectorId, count: newlyAssigned, customerIds: plan.changingIds },
        reason: dto.reason, req,
      });
    }
    if (plan.assignmentsClosed > 0) {
      await this.audit.log({
        userId: actor.id, action: 'customers_transferred', entityTable: 'customer_assignments',
        newValue: { collectorId: dto.collectorId, count: plan.assignmentsClosed, customerIds: plan.changingIds },
        reason: dto.reason, req,
      });
    }
    if (tasksUpdated > 0) {
      await this.audit.log({
        userId: actor.id, action: 'tasks_reassigned', entityTable: 'tasks',
        newValue: { collectorId: dto.collectorId, count: tasksUpdated, customerIds: plan.changingIds },
        req,
      });
    }

    return summary;
  }

  private async smartPlan(actor: AuthUser, dto: SmartAssignmentDto) {
    const [collectors, customers, openTaskCounts] = await Promise.all([
      this.prisma.collector.findMany({
        where: { active: true, user: { organizationId: actor.organizationId } },
        include: {
          user: { select: { fullName: true } },
          assignments: { where: { effectiveTo: null }, include: { customer: { select: { region: true } } } },
        },
        orderBy: { user: { fullName: 'asc' } },
      }),
      this.prisma.customer.findMany({
        where: { id: { in: dto.customerIds }, organizationId: actor.organizationId, status: 'active' },
        select: { id: true, name: true, region: true, assignments: { where: { effectiveTo: null }, take: 1 } },
      }),
      this.prisma.task.groupBy({
        by: ['assignedTo'], where: { status: 'open', customer: { organizationId: actor.organizationId }, assignedTo: { not: null } }, _count: true,
      }),
    ]);
    if (!collectors.length) throw new BadRequestException('لا يوجد محصلون نشطون للتوزيع');
    const taskLoad = new Map(openTaskCounts.map((row) => [row.assignedTo!, row._count]));
    const states = collectors.map((collector) => {
      const regionCounts = new Map<string, number>();
      for (const assignment of collector.assignments) if (assignment.customer.region) {
        regionCounts.set(assignment.customer.region, (regionCounts.get(assignment.customer.region) ?? 0) + 1);
      }
      return {
        id: collector.id, name: collector.user.fullName,
        currentCustomers: collector.assignments.length, currentTasks: taskLoad.get(collector.id) ?? 0,
        planned: 0, regionCounts,
      };
    });
    const rows = [...customers]
      .sort((a, b) => Number(!!a.assignments[0]) - Number(!!b.assignments[0]) || (a.region ?? '').localeCompare(b.region ?? ''))
      .map((customer) => {
        const ranked = states.map((state) => {
          const affinity = customer.region ? (state.regionCounts.get(customer.region) ?? 0) : 0;
          const load = state.currentCustomers + state.currentTasks * 0.35 + state.planned;
          return { state, score: load - Math.min(affinity, 20) * 0.12 };
        }).sort((a, b) => a.score - b.score || a.state.name.localeCompare(b.state.name));
        const target = ranked[0].state;
        target.planned += 1;
        if (customer.region) target.regionCounts.set(customer.region, (target.regionCounts.get(customer.region) ?? 0) + 1);
        return {
          customerId: customer.id, customerName: customer.name, region: customer.region,
          currentCollectorId: customer.assignments[0]?.collectorId ?? null,
          collectorId: target.id, collectorName: target.name,
        };
      });
    return {
      selected: dto.customerIds.length, matched: rows.length, missing: dto.customerIds.length - rows.length,
      changes: rows.filter((row) => row.currentCollectorId !== row.collectorId),
      unchanged: rows.filter((row) => row.currentCollectorId === row.collectorId).length,
      distribution: states.map((state) => ({
        collectorId: state.id, collectorName: state.name, currentCustomers: state.currentCustomers,
        currentTasks: state.currentTasks, planned: state.planned, projectedCustomers: state.currentCustomers + state.planned,
      })),
    };
  }

  async previewSmartAssign(actor: AuthUser, dto: SmartAssignmentDto) {
    return this.smartPlan(actor, dto);
  }

  async executeSmartAssign(actor: AuthUser, dto: SmartAssignmentDto, req?: Request) {
    const plan = await this.smartPlan(actor, dto);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const change of plan.changes) {
        await tx.customerAssignment.updateMany({
          where: { customerId: change.customerId, effectiveTo: null }, data: { effectiveTo: now },
        });
        await tx.customerAssignment.create({
          data: {
            customerId: change.customerId, collectorId: change.collectorId, effectiveFrom: now,
            reason: dto.reason ?? 'إسناد جماعي ذكي حسب الحمل والمنطقة', assignedBy: actor.id,
          },
        });
        await tx.task.updateMany({
          where: { customerId: change.customerId, status: 'open' }, data: { assignedTo: change.collectorId },
        });
      }
    });
    await this.audit.log({
      userId: actor.id, action: 'smart_bulk_assignment_executed', entityTable: 'customer_assignments',
      newValue: { changes: plan.changes, distribution: plan.distribution }, reason: dto.reason, req,
    });
    return { ...plan, executed: plan.changes.length };
  }
}
