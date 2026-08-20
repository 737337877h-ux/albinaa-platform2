import { ForbiddenException, Injectable, NotFoundException, InternalServerErrorException, StreamableFile } from '@nestjs/common';
import * as fs from 'fs';
import { createReadStream } from 'fs';
import { extname } from 'path';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { orgDateOnly } from '../common/org-time';
import { PrismaService } from '../prisma/prisma.service';
import { GpsPointDto } from './dto/gps-point.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import { UpdateCustomerFieldDto } from './dto/update-customer-field.dto';
import { DashboardService } from '../dashboard/dashboard.service';
import { priorityOfTaskType } from '../tasks/tasks.service';
import { isActionableDebtorBalance } from '../common/debt-followup-policy';
import { hasMobileFeature } from '../common/mobile-feature-permissions';
import { OracleInventoryReadService } from '../oracle-inventory-sync/oracle-inventory-read.service';
import { OracleInventoryItemsQueryDto, OracleInventorySourceQueryDto } from '../oracle-inventory-sync/dto/oracle-inventory-query.dto';

/** Keep task history on the server while showing one actionable card per customer. */
export function collapseMobileTasksByCustomer<T extends {
  id: string;
  customerId?: string | null;
  taskType?: string | null;
  dueDate?: Date | string | null;
  createdAt?: Date | string | null;
}>(tasks: T[]): T[] {
  const selected = new Map<string, T>();
  const timestamp = (value: Date | string | null | undefined) => value ? new Date(value).getTime() : 0;

  for (const task of tasks) {
    if (!task.customerId) continue;
    const current = selected.get(task.customerId);
    if (!current) {
      selected.set(task.customerId, task);
      continue;
    }

    const taskPriority = priorityOfTaskType(task.taskType ?? '');
    const currentPriority = priorityOfTaskType(current.taskType ?? '');
    const taskIsBetter = taskPriority < currentPriority
      || (taskPriority === currentPriority && timestamp(task.dueDate) > timestamp(current.dueDate))
      || (taskPriority === currentPriority
        && timestamp(task.dueDate) === timestamp(current.dueDate)
        && timestamp(task.createdAt) > timestamp(current.createdAt));
    if (taskIsBetter) selected.set(task.customerId, task);
  }

  return [...selected.values()];
}

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard?: DashboardService,
    private readonly oracleInventory?: OracleInventoryReadService,
  ) {}

  private assertMobileInventory(user: AuthUser) {
    if (!user.permissions.includes('mobile.inventory.view')) {
      throw new ForbiddenException('لا تملك صلاحية عرض المخزون في التطبيق');
    }
    if (!this.oracleInventory) throw new InternalServerErrorException('خدمة المخزون غير متاحة');
  }

  mobileInventorySummary(user: AuthUser, query: OracleInventorySourceQueryDto) {
    this.assertMobileInventory(user);
    return this.oracleInventory!.summary(user, query);
  }

  mobileInventoryItems(user: AuthUser, query: OracleInventoryItemsQueryDto) {
    this.assertMobileInventory(user);
    return this.oracleInventory!.items(user, { ...query, limit: Math.min(query.limit ?? 30, 50) });
  }

  mobileInventoryItem(user: AuthUser, code: string, query: OracleInventorySourceQueryDto) {
    this.assertMobileInventory(user);
    return this.oracleInventory!.item(user, code, query);
  }

  async uploadReceipt(user: AuthUser, file: Express.Multer.File, dto: UploadReceiptDto) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: dto.collectionId, collector: { user: { organizationId: user.organizationId } } },
    });
    if (!collection) {
      if (file?.path) fs.unlink(file.path, () => {});
      throw new NotFoundException('التحصيل غير موجود أو خارج نطاق صلاحيتك');
    }
    try {
      const attachment = await this.prisma.attachment.create({
        data: {
          entityTable: 'collections',
          entityId: dto.collectionId,
          fileName: file.originalname,
          storageKey: file.path,
          uploadedBy: user.id,
        },
      });
      return attachment;
    } catch (err) {
      if (file?.path) fs.unlink(file.path, () => {});
      throw new InternalServerErrorException('فشل حفظ السند');
    }
  }

  async downloadReceipt(user: AuthUser, id: string): Promise<StreamableFile> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('السند غير موجود');

    const collection = await this.prisma.collection.findFirst({
      where: {
        id: attachment.entityId,
        collector: { user: { organizationId: user.organizationId } },
      },
    });
    if (!collection) throw new NotFoundException('السند غير موجود أو خارج نطاق صلاحيتك');

    const filePath = attachment.storageKey;
    if (!fs.existsSync(filePath)) throw new NotFoundException('ملف السند غير موجود على الخادم');

    const ext = extname(attachment.fileName);
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.pdf': 'application/pdf',
    };

    return new StreamableFile(createReadStream(filePath), {
      type: mimeMap[ext] || 'application/octet-stream',
      disposition: `inline; filename="${attachment.fileName}"`,
    });
  }

  async saveGps(user: AuthUser, dto: GpsPointDto) {
    return this.prisma.gpsLog.create({
      data: {
        userId: user.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? null,
        entityTable: dto.entityTable ?? null,
        entityId: dto.entityId ?? null,
      },
    });
  }

  async saveGpsBatch(user: AuthUser, dtos: GpsPointDto[]) {
    const data = dtos.map((d) => ({
      userId: user.id,
      latitude: d.latitude,
      longitude: d.longitude,
      accuracy: d.accuracy ?? null,
      entityTable: d.entityTable ?? null,
      entityId: d.entityId ?? null,
    }));
    const result = await this.prisma.gpsLog.createMany({ data });
    return { count: result.count };
  }

  async sync(user: AuthUser, _lastSyncToken?: string) {
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    const collectorId = collector?.id;

    const canReadAll = user.permissions.includes('customers.read_all');
    const canViewDeliveryDirectory = user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const canViewTasks = hasMobileFeature(user.permissions, 'mobile.tasks.view', 'tasks.manage');
    const canViewCustomers = canViewDeliveryDirectory
      || hasMobileFeature(user.permissions, 'mobile.customers.view', 'customers.read');
    const canViewFollowups = hasMobileFeature(user.permissions, 'mobile.followups.view', 'followups.create');
    const canViewPromises = hasMobileFeature(user.permissions, 'mobile.promises.view', 'promises.create');
    const canViewCollections = hasMobileFeature(user.permissions, 'mobile.collections.view', 'collections.create');
    const canViewReservations = hasMobileFeature(user.permissions, 'mobile.reservations.view', 'reservations.read');

    const taskWhere: any = { status: 'open' };
    if (collectorId) taskWhere.assignedTo = collectorId;
    else if (!canReadAll) taskWhere.assignedTo = 'no-access';

    const [
      rawTasks, customers, rawFollowups, rawPromises, rawCollections,
      rawReservations, currencies, collectionMethods, followupTypes, followupResults, reservationUnits, newDebt,
    ] = await Promise.all([
      canViewTasks && (collectorId || canReadAll)
        ? this.prisma.task.findMany({
            where: taskWhere,
            include: {
              customer: { select: { id: true, name: true } },
            },
            orderBy: { dueDate: 'asc' },
            take: 500,
          })
        : Promise.resolve([]),

      canViewCustomers ? this.findCustomers(user) : Promise.resolve([]),

      canViewFollowups ? this.prisma.followup.findMany({
        where: {
          deletedAt: null,
          ...(canReadAll
            ? { customer: { organizationId: user.organizationId } }
            : collectorId ? { userId: user.id } : { id: 'no-access' }),
        },
        include: {
          customer: { select: { id: true, name: true } },
          type: { select: { name: true } },
          result: { select: { name: true } },
        },
        orderBy: { followupAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),

      canViewPromises ? this.prisma.paymentPromise.findMany({
        where: {
          ...(canReadAll
            ? { customer: { organizationId: user.organizationId } }
            : collectorId ? { collectorId } : { id: 'no-access' }),
        },
        include: {
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),

      canViewCollections ? this.prisma.collection.findMany({
        where: {
          ...(canReadAll
            ? { customer: { organizationId: user.organizationId } }
            : collectorId ? { collectorId } : { id: 'no-access' }),
        },
        include: {
          customer: { select: { id: true, name: true } },
          method: { select: { name: true } },
        },
        orderBy: { collectedAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),
      canViewReservations ? this.prisma.reservation.findMany({
        where: {
          customer: {
            organizationId: user.organizationId,
            status: 'active',
            ...(canReadAll
              ? {}
              : collectorId ? { assignments: { some: { collectorId, effectiveTo: null } } } : { id: 'no-access' }),
          },
        },
        include: { customer: { select: { id: true, name: true } }, measureUnit: { select: { nameAr: true, weightKg: true } } },
        orderBy: { reservedAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),
      this.prisma.currency.findMany({
        where: { active: true },
        select: { code: true, sourceCode: true, nameAr: true, decimals: true, active: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.collectionMethod.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.followupType.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.followupResult.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.unit.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameAr: true, weightKg: true },
        orderBy: [{ weightKg: 'desc' }, { nameAr: 'asc' }],
      }),
      this.dashboard?.newDebtBetweenLastTwoImports(user.organizationId) ?? Promise.resolve(null),
    ]);

    const collectionIds = rawCollections.map((collection) => collection.id);
    const [receiptAttachments, collectionGps] = collectionIds.length === 0
      ? [[], []]
      : await Promise.all([
        this.prisma.attachment.findMany({
          where: { entityTable: 'collections', entityId: { in: collectionIds } },
          select: { id: true, entityId: true, fileName: true, uploadedAt: true },
          orderBy: { uploadedAt: 'desc' },
        }),
        this.prisma.gpsLog.findMany({
          where: { entityTable: 'collections', entityId: { in: collectionIds } },
          select: { id: true, entityId: true, latitude: true, longitude: true, accuracy: true, timestamp: true },
          orderBy: { timestamp: 'desc' },
        }),
      ]);
    const receiptByCollection = new Map<string, typeof receiptAttachments[number]>();
    for (const receipt of receiptAttachments) {
      if (!receiptByCollection.has(receipt.entityId)) receiptByCollection.set(receipt.entityId, receipt);
    }
    const gpsByCollection = new Map<string, typeof collectionGps[number]>();
    for (const point of collectionGps) {
      if (point.entityId && !gpsByCollection.has(point.entityId)) gpsByCollection.set(point.entityId, point);
    }

    const syncToken = new Date().toISOString();
    const debtorCustomerIds = new Set(
      customers
        .filter((customer: any) => (customer.balances ?? [])
          .some((balance: any) => isActionableDebtorBalance(
            Number(balance.balance ?? balance.accountingBalance ?? 0),
            balance.currency ?? balance.currencyCode,
          )))
        .map((customer: any) => customer.id),
    );
    const todayKey = orgDateOnly();
    const actionableRawTasks = (rawTasks as any[]).filter((task) =>
      !!task.customerId && debtorCustomerIds.has(task.customerId));
    const taskBucket = (task: any) => {
      const due = String(task.dueDate ?? '').slice(0, 10);
      return due < todayKey ? 'overdue' : due === todayKey ? 'today' : 'upcoming';
    };
    const actionableTasks = ['overdue', 'today', 'upcoming'].flatMap((bucket) =>
      collapseMobileTasksByCustomer(actionableRawTasks.filter((task) => taskBucket(task) === bucket)));

    return {
      serverTime: syncToken,
      syncToken,
      snapshot: 'full',
      schemaVersion: 1,
      mobileCapabilities: user.permissions.filter((code) => code.startsWith('mobile.')),
      references: {
        currencies,
        collectionMethods,
        followupTypes,
        followupResults,
        reservationUnits: reservationUnits.map((unit) => ({
          ...unit,
          weightKg: unit.weightKg === null ? null : Number(unit.weightKg),
        })),
      },
      newDebt,
      tasks: actionableTasks.map((t) => ({
        id: t.id,
        customerId: t.customerId,
        customerName: t.customer?.name ?? null,
        title: t.priorityReason || t.taskType,
        dueDate: t.dueDate,
        priority: t.taskType,
        priorityReason: t.priorityReason,
        expectedAmount: t.expectedAmount == null ? null : Number(t.expectedAmount),
        expectedCurrency: t.expectedCurrency,
        status: t.status,
      })),
      customers,
      followups: rawFollowups.map((f) => ({
        id: f.id,
        customerId: f.customerId,
        customerName: f.customer?.name ?? null,
        typeName: f.type?.name ?? null,
        resultName: f.result?.name ?? null,
        notes: f.notes,
        followupAt: f.followupAt,
      })),
      promises: rawPromises.map((p) => ({
        id: p.id,
        customerId: p.customerId,
        customerName: p.customer?.name ?? null,
        expectedAmount: Number(p.expectedAmount),
        currencyCode: p.currencyCode,
        dueDate: p.dueDate,
        status: p.status,
        notes: p.notes,
      })),
      collections: rawCollections.map((c) => ({
        id: c.id,
        customerId: c.customerId,
        customerName: c.customer?.name ?? null,
        amount: Number(c.amount),
        currencyCode: c.currencyCode,
        methodName: c.method?.name ?? null,
        notes: c.notes,
        collectedAt: c.collectedAt,
        receiptAttachment: receiptByCollection.get(c.id) ?? null,
        location: gpsByCollection.get(c.id) ?? null,
      })),
      reservations: rawReservations.map((r) => {
        const quantity = Number(r.quantity ?? r.remainingQty ?? 0);
        const remainingQty = Number(r.remainingQty ?? r.quantity ?? 0);
        const totalAmount = Number(r.totalAmount ?? r.creditAmount ?? 0);
        const weightKg = r.measureUnit?.weightKg == null ? null : Number(r.measureUnit.weightKg);
        const totalTons = weightKg == null ? null : remainingQty * weightKg / 1000;
        return {
          id: r.id, customerId: r.customerId, customerName: r.customer?.name ?? null,
          itemName: r.itemName, quantity, remainingQty, unitName: r.measureUnit?.nameAr || r.unit,
          totalAmount, currencyCode: r.currencyCode, totalTons,
          averageTonPrice: totalTons && totalTons > 0 ? totalAmount / totalTons : null,
          reservedAt: r.reservedAt, expiresAt: r.expiresAt, status: r.status,
        };
      }),
    };
  }

  async findCustomers(user: AuthUser) {
    const deliveryDirectory = user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const includeBalances = user.permissions.includes('balances.read') || user.permissions.includes('customers.read_all');
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (user.permissions.includes('customers.read_all')) {
      return this.findActiveCustomerSnapshot({ organizationId: user.organizationId }, includeBalances);
    }
    if (deliveryDirectory) {
      return this.findActiveCustomerSnapshot({ organizationId: user.organizationId }, true, collector?.id ?? null);
    }

    if (!collector) return [];

    return this.findActiveCustomerSnapshot({
      organizationId: user.organizationId,
      assignments: { some: { collectorId: collector.id, effectiveTo: null } },
    }, includeBalances);
  }

  async updateCustomerField(user: AuthUser, id: string, dto: UpdateCustomerFieldDto) {
    const deliveryDirectory = user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const where: any = { id, organizationId: user.organizationId, status: 'active' };
    if (!user.permissions.includes('customers.read_all') && !deliveryDirectory) {
      const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
      if (!collector) throw new NotFoundException('العميل غير موجود أو غير مسند إليك');
      where.assignments = { some: { collectorId: collector.id, effectiveTo: null } };
    }
    const customer = await this.prisma.customer.findFirst({ where, select: { id: true } });
    if (!customer) throw new NotFoundException('العميل غير موجود أو غير مسند إليك');

    const data: Record<string, string | number> = {};
    const allowedFields = deliveryDirectory && !user.permissions.includes('customers.read_all')
      ? ['geoLat', 'geoLng'] as const
      : ['phonePrimary', 'phoneSecondary', 'whatsapp', 'geoLat', 'geoLng'] as const;
    for (const key of allowedFields) {
      if (dto[key] !== undefined) data[key] = dto[key] as string | number;
    }
    if (Object.keys(data).length === 0) return { id, updated: false };
    await this.prisma.customer.update({ where: { id }, data });
    return { id, updated: true };
  }

  private async findActiveCustomerSnapshot(where: any, includeBalances = true, balanceScopeCollectorId?: string | null) {
    const customers = await this.prisma.customer.findMany({
      where: { ...where, status: 'active' },
      include: {
        balances: includeBalances ? {
          select: {
            currencyCode: true,
            accountingBalance: true,
            lastImportJob: { select: { importedAt: true } },
          },
        } : false,
        assignments: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          include: { collector: { include: { user: { select: { fullName: true } } } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (customers.length === 0) return [];

    const balanceCutoffs = new Map<string, number>();
    for (const customer of customers) {
      for (const balance of (customer.balances ?? []) as Array<{
        currencyCode: string;
        lastImportJob?: { importedAt: Date } | null;
      }>) {
        const key = `${customer.id}:${balance.currencyCode}`;
        balanceCutoffs.set(key, balance.lastImportJob?.importedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
      }
    }

    const ledgerEntries = includeBalances ? await this.prisma.operationalLedger.findMany({
      where: { customerId: { in: customers.map((customer) => customer.id) } },
      select: {
        customerId: true,
        currencyCode: true,
        amountSigned: true,
        createdAt: true,
      },
    }) : [];
    const ledgerDeltas = new Map<string, number>();
    for (const entry of ledgerEntries) {
      const key = `${entry.customerId}:${entry.currencyCode}`;
      const cutoff = balanceCutoffs.get(key);
      if (cutoff == null || entry.createdAt.getTime() <= cutoff) continue;
      ledgerDeltas.set(key, (ledgerDeltas.get(key) ?? 0) + Number(entry.amountSigned));
    }

    const canSeeCustomerBalance = (customer: any) => includeBalances && (balanceScopeCollectorId === undefined
      || customer.assignments?.some((assignment: any) => assignment.collectorId === balanceScopeCollectorId));
    const shaped = customers.map((customer) => this.shapeCustomer(customer, ledgerDeltas, canSeeCustomerBalance(customer)));
    if (!includeBalances) return shaped;
    const groupSummaries = await this.mobileAccountGroupSummaries(
      customers[0]?.organizationId,
      customers.filter(canSeeCustomerBalance).map((customer) => customer.id),
    );
    return shaped.map((customer) => ({ ...customer, ...(groupSummaries.get(customer.id) ?? {}) }));
  }

  private async mobileAccountGroupSummaries(organizationId: string | undefined, visibleCustomerIds: string[]) {
    const result = new Map<string, {
      accountGroupRole: 'primary' | 'child';
      groupBalances: { currency: string; balance: number }[];
      childBalances: { currency: string; balance: number }[];
    }>();
    if (!organizationId || visibleCustomerIds.length === 0) return result;
    const touching = await this.prisma.customerAccountLink.findMany({
      where: {
        organizationId,
        OR: [
          { primaryCustomerId: { in: visibleCustomerIds } },
          { childCustomerId: { in: visibleCustomerIds } },
        ],
      },
      select: { primaryCustomerId: true, childCustomerId: true },
    });
    const primaryIds = [...new Set(touching.map((link) => link.primaryCustomerId))];
    if (primaryIds.length === 0) return result;
    const links = await this.prisma.customerAccountLink.findMany({
      where: { organizationId, primaryCustomerId: { in: primaryIds } },
      select: { primaryCustomerId: true, childCustomerId: true },
    });
    const memberIds = [...new Set([...primaryIds, ...links.map((link) => link.childCustomerId)])];
    const balances = await this.prisma.customerBalance.findMany({
      where: { customerId: { in: memberIds } },
      select: {
        customerId: true,
        currencyCode: true,
        accountingBalance: true,
        lastImportJob: { select: { importedAt: true } },
      },
    });
    const ledger = await this.prisma.operationalLedger.findMany({
      where: { customerId: { in: memberIds } },
      select: { customerId: true, currencyCode: true, amountSigned: true, createdAt: true },
    });
    const delta = new Map<string, number>();
    const cutoff = new Map(balances.map((balance) => [
      `${balance.customerId}|${balance.currencyCode}`,
      balance.lastImportJob?.importedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    ]));
    for (const entry of ledger) {
      const key = `${entry.customerId}|${entry.currencyCode}`;
      if (entry.createdAt.getTime() <= (cutoff.get(key) ?? Number.NEGATIVE_INFINITY)) continue;
      delta.set(key, (delta.get(key) ?? 0) + Number(entry.amountSigned));
    }
    const balanceByMember = new Map<string, Map<string, number>>();
    for (const balance of balances) {
      const byCurrency = balanceByMember.get(balance.customerId) ?? new Map<string, number>();
      const key = `${balance.customerId}|${balance.currencyCode}`;
      byCurrency.set(balance.currencyCode, Number(balance.accountingBalance) + (delta.get(key) ?? 0));
      balanceByMember.set(balance.customerId, byCurrency);
    }
    for (const primaryId of primaryIds) {
      const childIds = links.filter((link) => link.primaryCustomerId === primaryId).map((link) => link.childCustomerId);
      const groupTotals = new Map<string, number>();
      const childTotals = new Map<string, number>();
      for (const memberId of [primaryId, ...childIds]) {
        for (const [currency, balance] of balanceByMember.get(memberId) ?? []) {
          groupTotals.set(currency, (groupTotals.get(currency) ?? 0) + balance);
          if (memberId !== primaryId) childTotals.set(currency, (childTotals.get(currency) ?? 0) + balance);
        }
      }
      const toRows = (values: Map<string, number>) => [...values.entries()]
        .map(([currency, balance]) => ({ currency, balance }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
      const common = { groupBalances: toRows(groupTotals), childBalances: toRows(childTotals) };
      result.set(primaryId, { accountGroupRole: 'primary', ...common });
      for (const childId of childIds) result.set(childId, { accountGroupRole: 'child', ...common });
    }
    return result;
  }

  private shapeCustomer(c: any, ledgerDeltas: Map<string, number> = new Map(), includeBalances = true) {
    return {
      id: c.id,
      fullName: c.name,
      accountNumber: c.accountNumber,
      externalCustomerCode: c.externalCustomerCode,
      customerType: c.customerType,
      phonePrimary: c.phonePrimary,
      phoneSecondary: c.phoneSecondary,
      whatsapp: c.whatsapp,
      address: c.address,
      geoLat: c.geoLat == null ? null : Number(c.geoLat),
      geoLng: c.geoLng == null ? null : Number(c.geoLng),
      assignedCollectorName: c.assignments?.[0]?.collector?.user?.fullName ?? null,
      balanceHidden: !includeBalances,
      balances: includeBalances ? (c.balances ?? []).map((b: any) => ({
        currency: b.currencyCode,
        balance: Number(b.accountingBalance) + (ledgerDeltas.get(`${c.id}:${b.currencyCode}`) ?? 0),
      })) : [],
    };
  }

  async findCustomer360(user: AuthUser, id: string) {
    const deliveryDirectory = user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    const where: any = { id, organizationId: user.organizationId };

    if (!user.permissions.includes('customers.read_all') && !deliveryDirectory) {
      if (!collector) throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');
      where.assignments = { some: { collectorId: collector.id, effectiveTo: null } };
    }

    const customer = await this.prisma.customer.findFirst({
      where,
      include: {
        balances: true,
        assignments: { where: { effectiveTo: null }, select: { collectorId: true } },
      },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');
    const assignedToCurrentUser = !!collector && customer.assignments.some((assignment) => assignment.collectorId === collector.id);
    const includeBalances = user.permissions.includes('balances.read') || user.permissions.includes('customers.read_all')
      || (deliveryDirectory && assignedToCurrentUser);

    const [followups, promises, collections, timeline] = await Promise.all([
      this.prisma.followup.findMany({
        where: { customerId: id, deletedAt: null },
        include: {
          type: { select: { name: true } },
          result: { select: { name: true } },
        },
        orderBy: { followupAt: 'desc' },
        take: 5,
      }),
      this.prisma.paymentPromise.findMany({
        where: { customerId: id },
        include: {
          collector: { include: { user: { select: { fullName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.collection.findMany({
        where: { customerId: id },
        include: {
          method: { select: { name: true } },
          collector: { include: { user: { select: { fullName: true } } } },
        },
        orderBy: { collectedAt: 'desc' },
        take: 5,
      }),
      this.buildTimeline(id),
    ]);

    return {
      id: customer.id,
      fullName: customer.name,
      phonePrimary: customer.phonePrimary,
      address: customer.address,
      geoLat: customer.geoLat === null ? null : Number(customer.geoLat),
      geoLng: customer.geoLng === null ? null : Number(customer.geoLng),
      balanceHidden: !includeBalances,
      balances: includeBalances
        ? await Promise.all((customer.balances ?? []).map(async (b: any) => {
        // Compute operational balance = accounting + ledger delta since last import
        const lastJob = await this.prisma.importJob.findFirst({
          where: { organizationId: customer.organizationId, status: 'completed' },
          orderBy: { importedAt: 'desc' },
          select: { importedAt: true },
        });
        let ledgerDelta = 0;
        if (lastJob) {
          const agg = await this.prisma.operationalLedger.aggregate({
            _sum: { amountSigned: true },
            where: {
              customerId: id,
              currencyCode: b.currencyCode,
              createdAt: { gt: lastJob.importedAt },
            },
          });
          ledgerDelta = Number(agg._sum.amountSigned ?? 0);
        }
        return {
          currency: b.currencyCode,
          accountingBalance: Number(b.accountingBalance),
          operationalBalance: Number(b.accountingBalance) + ledgerDelta,
        };
          }))
        : [],
      timeline,
      recentFollowups: followups,
      recentPromises: promises,
      recentCollections: collections,
    };
  }

  private async buildTimeline(customerId: string) {
    const [followups, promises, collections] = await Promise.all([
      this.prisma.followup.findMany({
        where: { customerId, deletedAt: null },
        include: {
          type: { select: { name: true } },
          result: { select: { name: true } },
          user: { select: { fullName: true } },
        },
        take: 20,
      }),
      this.prisma.paymentPromise.findMany({
        where: { customerId },
        include: {
          collector: { include: { user: { select: { fullName: true } } } },
        },
        take: 20,
      }),
      this.prisma.collection.findMany({
        where: { customerId },
        include: {
          method: { select: { name: true } },
          collector: { include: { user: { select: { fullName: true } } } },
        },
        take: 20,
      }),
    ]);

    const events: { at: Date; type: string; title: string }[] = [];

    for (const f of followups) {
      events.push({
        at: f.followupAt,
        type: 'followup',
        title: `متابعة (${f.type.name}) — ${f.result.name}`,
      });
    }
    for (const p of promises) {
      events.push({
        at: p.createdAt,
        type: 'payment_promise',
        title: `وعد سداد ${Number(p.expectedAmount).toLocaleString('en-US')} ${p.currencyCode}`,
      });
    }
    for (const col of collections) {
      events.push({
        at: col.collectedAt,
        type: 'collection',
        title: `تحصيل ${Number(col.amount).toLocaleString('en-US')} ${col.currencyCode}`,
      });
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return events.slice(0, 20);
  }
}
