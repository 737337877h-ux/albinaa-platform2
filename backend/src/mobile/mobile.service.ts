import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, InternalServerErrorException, StreamableFile } from '@nestjs/common';
import * as fs from 'fs';
import { mobileReservationValue } from './mobile-reservation-value';
import { resolveReceiptAudit } from '../common/oracle-receipt-binding';
import { oracleReceiptActivity } from '../common/oracle-receipt-activity';
import { reconcileReceiptRequests, countableReceiptRequest, ReceiptRequestState, recordedLocalReceiptFinals } from '../common/oracle-receipt-reconciliation';
import { createReadStream } from 'fs';
import { extname } from 'path';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { orgDateOnly } from '../common/org-time';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceHeartbeatDto } from './dto/device-heartbeat.dto';
import { GpsPointDto } from './dto/gps-point.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import { UploadOracleRequestReceiptDto } from './dto/upload-oracle-request-receipt.dto';
import { UpdateCustomerFieldDto } from './dto/update-customer-field.dto';
import { DashboardService } from '../dashboard/dashboard.service';
import { priorityOfTaskType, REFRESHED_DAILY_TASK_TYPES } from '../tasks/tasks.service';
import { isActionableDebtorBalance, isSignificantBalance, normalizedCurrencyCode } from '../common/debt-followup-policy';
import { hasMobileFeature } from '../common/mobile-feature-permissions';
import { OracleInventoryReadService } from '../oracle-inventory-sync/oracle-inventory-read.service';
import { OracleInventoryItemsQueryDto, OracleInventorySourceQueryDto } from '../oracle-inventory-sync/dto/oracle-inventory-query.dto';
import { OracleTestRequestsService } from '../oracle-test-requests/oracle-test-requests.service';
import { randomUUID } from 'crypto';
import { durableOracleRequest } from '../common/oracle-request-audit';
import { NotificationsService } from '../notifications/notifications.service';
import { inventoryCostAccess } from './inventory-cost-access';

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

export function mobileInventorySummaryReference(
  liveSummary: Record<string, unknown> | null | undefined,
  catalogSummary: Record<string, unknown> | null | undefined,
) {
  const source = liveSummary ?? catalogSummary;
  return source ? [{ id: 'current', name: 'ملخص المخزون المحلي', ...source }] : [];
}

export function mobileTaskBucket(
  dueDate: Date | string | null | undefined,
  todayKey: string,
): 'overdue' | 'today' | 'upcoming' {
  const due = dueDate instanceof Date
    ? dueDate.toISOString().slice(0, 10)
    : String(dueDate ?? '').slice(0, 10);
  return due < todayKey ? 'overdue' : due === todayKey ? 'today' : 'upcoming';
}

function oracleCurrencyToPlatform(code: unknown): string {
  const normalized = normalizedCurrencyCode(String(code ?? ''));
  return normalized === 'YR' ? 'YER' : normalized === 'SR' ? 'SAR' : normalized;
}

export function mobileOracleReceiptCollection(
  activity: { id?: string; entityId?: string | null; newValue?: unknown; createdAt: Date | string },
  customerNameById: Map<string, string>,
  currentState?: ReceiptRequestState,
) {
  const request = currentState ?? durableOracleRequest(activity as any);
  if (request?.kind !== 'receipt' || request.amount === null || !request.currencyCode) return null;
  if (currentState && !countableReceiptRequest(currentState)) return null;

  const customerId = request.platformCustomerId ? String(request.platformCustomerId) : null;
  const customerName = (customerId ? customerNameById.get(customerId) : null)
    || String(request.recipientName ?? request.platformCustomerCode ?? 'عميل');
  return {
    id: `oracle-receipt:${request.requestSerial}`,
    customerId,
    customerName,
    amount: request.amount,
    currencyCode: request.currencyCode,
    methodName: 'طلب سند قبض Oracle',
    notes: `رقم طلب Oracle ${String(request.requestNo ?? request.requestSerial)} — ${currentState?.statusLabel ?? 'تعذر التحقق من حالة الطلب'}`,
    status: currentState?.status ?? 'unknown', source: 'oracle_receipt_request',
    statusVerified: currentState?.statusVerified ?? false,
    collectedAt: activity.createdAt,
    receiptAttachment: null,
    location: null,
  };
}

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard?: DashboardService,
    private readonly oracleInventory?: OracleInventoryReadService,
    private readonly oracleRequests?: OracleTestRequestsService,
    private readonly notifications?: NotificationsService,
  ) {}

  async deviceHeartbeat(user: AuthUser, dto: DeviceHeartbeatDto) {
    const now = new Date();
    const row = await this.prisma.mobileDeviceSession.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: dto.deviceId.trim() } },
      create: {
        userId: user.id,
        deviceId: dto.deviceId.trim(),
        deviceName: dto.deviceName?.trim() || null,
        platform: dto.platform.trim(),
        appVersion: dto.appVersion?.trim() || null,
        lastConnectedAt: now,
        lastSyncedAt: dto.lastSyncedAt ? new Date(dto.lastSyncedAt) : null,
        lastResponseMs: dto.responseMs ?? null,
      },
      update: {
        deviceName: dto.deviceName?.trim() || null,
        platform: dto.platform.trim(),
        appVersion: dto.appVersion?.trim() || null,
        lastConnectedAt: now,
        ...(dto.lastSyncedAt ? { lastSyncedAt: new Date(dto.lastSyncedAt) } : {}),
        ...(dto.responseMs !== undefined ? { lastResponseMs: dto.responseMs } : {}),
      },
    });
    return { ok: true, serverTime: now, deviceId: row.deviceId };
  }

  async deviceSessions(user: AuthUser) {
    const items = await this.prisma.mobileDeviceSession.findMany({
      where: { user: { organizationId: user.organizationId } },
      include: { user: { select: { id: true, fullName: true, username: true, isActive: true } } },
      orderBy: { lastConnectedAt: 'desc' },
    });
    const now = Date.now();
    return {
      serverTime: new Date(),
      items: items.map((item) => ({
        ...item,
        online: now - item.lastConnectedAt.getTime() <= 5 * 60_000,
      })),
    };
  }

  private assertMobileInventory(user: AuthUser) {
    if (!user.permissions.includes('mobile.inventory.view')) {
      throw new ForbiddenException('لا تملك صلاحية عرض المخزون في التطبيق');
    }
    if (!this.oracleInventory) throw new InternalServerErrorException('خدمة المخزون غير متاحة');
  }

  async mobileInventorySummary(user: AuthUser, query: OracleInventorySourceQueryDto) {
    this.assertMobileInventory(user);
    return inventoryCostAccess(await this.oracleInventory!.summary(user, query), user.permissions);
  }

  async mobileInventoryItems(user: AuthUser, query: OracleInventoryItemsQueryDto) {
    this.assertMobileInventory(user);
    return inventoryCostAccess(await this.oracleInventory!.items(user, { ...query, limit: Math.min(query.limit ?? 30, 50) }), user.permissions);
  }

  async mobileInventoryItem(user: AuthUser, code: string, query: OracleInventorySourceQueryDto) {
    this.assertMobileInventory(user);
    return inventoryCostAccess(await this.oracleInventory!.item(user, code, query), user.permissions);
  }

  async uploadReceipt(user: AuthUser, file: Express.Multer.File, dto: UploadReceiptDto) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: dto.collectionId, collector: { user: { organizationId: user.organizationId } } },
      include: {
        customer: { select: { name: true } },
        collector: { include: { user: { select: { fullName: true } } } },
      },
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
      await this.notifications?.notifyByPermissions(
        user.organizationId,
        ['cash.receive', 'collections.approve', 'finance.alerts.receive', 'settings.manage'],
        'receipt_uploaded',
        {
          collectionId: collection.id,
          customerId: collection.customerId,
          customerName: collection.customer.name,
          collectorName: collection.collector.user.fullName,
          attachmentId: attachment.id,
          href: `/collections?collectionId=${collection.id}`,
        },
      );
      return attachment;
    } catch (err) {
      if (file?.path) fs.unlink(file.path, () => {});
      throw new InternalServerErrorException('فشل حفظ السند');
    }
  }

  async uploadOracleRequestReceipt(user: AuthUser, file: Express.Multer.File, dto: UploadOracleRequestReceiptDto) {
    const required = dto.kind === 'receipt'
      ? 'oracle_test_requests.receipt.create'
      : 'oracle_test_requests.payment.create';
    if (!user.permissions.includes(required)) {
      if (file?.path) fs.unlink(file.path, () => {});
      throw new ForbiddenException('لا تملك صلاحية رفع صورة هذا السند');
    }
    if (!file) throw new NotFoundException('صورة الإيصال مطلوبة');
    const auditRows = await this.prisma.auditLog.findMany({
      where: { action: 'oracle_test_request_created', entityTable: 'IAS20261',
        userId: user.id, user: { organizationId: user.organizationId },
        AND: [
          { newValue: { path: ['requestNo'], equals: dto.requestNo.trim() } },
          ...(dto.externalReference?.trim() ? [{ newValue: {
            path: ['externalReference'], equals: dto.externalReference.trim(),
          } }] : []),
        ],
      },
      select: { id: true, entityId: true, createdAt: true, newValue: true },
    });
    const requestAudit = resolveReceiptAudit({ kind: dto.kind, requestNo: dto.requestNo,
      externalReference: dto.externalReference }, auditRows);
    if (!requestAudit) {
      fs.unlink(file.path, () => {});
      throw new BadRequestException('تعذر إثبات ربط الصورة بطلبك؛ يلزم مرجع عملية الطلب الصحيح');
    }
    const entityTable = `oracle_request:${dto.kind}:audit`;
    try {
      const attachment = await this.prisma.attachment.create({
        data: {
          entityTable,
          entityId: requestAudit.id,
          fileName: file.originalname,
          storageKey: file.path,
          uploadedBy: user.id,
        },
      });
      await this.notifications?.notifyByPermissions(
        user.organizationId,
        ['cash.receive', 'collections.approve', 'finance.alerts.receive', 'settings.manage'],
        'receipt_uploaded',
        {
          requestKind: dto.kind,
          requestNo: dto.requestNo.trim(),
          externalReference: dto.externalReference?.trim() || null,
          attachmentId: attachment.id,
          href: dto.kind === 'receipt' ? '/collections' : '/admin/oracle-test-requests',
        },
      );
      return attachment;
    } catch (error) {
      if (file?.path) fs.unlink(file.path, () => {});
      throw new InternalServerErrorException('فشل حفظ صورة إيصال السند');
    }
  }

  async downloadReceipt(user: AuthUser, id: string): Promise<StreamableFile> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('السند غير موجود');

    const isOracleRequestReceipt = attachment.entityTable.startsWith('oracle_request:');
    const collection = isOracleRequestReceipt ? null : await this.prisma.collection.findFirst({
      where: {
        id: attachment.entityId,
        collector: { user: { organizationId: user.organizationId } },
      },
    });
    if (!collection && !isOracleRequestReceipt) throw new NotFoundException('السند غير موجود أو خارج نطاق صلاحيتك');
    if (isOracleRequestReceipt) {
      const uploader = attachment.uploadedBy ? await this.prisma.user.findFirst({
        where: { id: attachment.uploadedBy, organizationId: user.organizationId }, select: { id: true },
      }) : null;
      if (!uploader) throw new NotFoundException('السند غير موجود أو خارج نطاق صلاحيتك');
      const canReview = user.permissions.some(code =>
        ['collections.approve', 'cash.receive', 'finance.alerts.receive', 'settings.manage'].includes(code));
      if (attachment.uploadedBy !== user.id && !canReview) {
        throw new ForbiddenException('لا تملك صلاحية عرض إيصال محصل آخر');
      }
      const kind = attachment.entityTable.split(':')[1];
      const reviewPermissions = ['mobile.receipts.view', 'collections.approve', 'cash.receive', 'finance.alerts.receive', 'settings.manage'];
      const allowed = user.permissions.some((code) => reviewPermissions.includes(code)) || (kind === 'receipt'
        ? user.permissions.some((code) => ['oracle_test_requests.receipt.read', 'oracle_test_requests.receipt.create'].includes(code))
        : user.permissions.some((code) => ['oracle_test_requests.payment.read', 'oracle_test_requests.payment.create'].includes(code)));
      if (!allowed) throw new ForbiddenException('لا تملك صلاحية عرض صورة هذا السند');
    }

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
    return this.prisma.gpsLog.create({ data: await this.prepareGpsPoint(user, dto) });
  }

  async saveGpsBatch(user: AuthUser, dtos: GpsPointDto[]) {
    if (!Array.isArray(dtos)) throw new BadRequestException('قائمة نقاط المواقع مطلوبة');
    // Resolve all references before writing: an unfinished operation must stay
    // queued on the phone, never be acknowledged with its location discarded.
    const data = await Promise.all(dtos.map((dto) => this.prepareGpsPoint(user, dto)));
    if (data.length === 0) return { count: 0 };
    const result = await this.prisma.gpsLog.createMany({ data });
    return { count: result.count };
  }

  private async prepareGpsPoint(user: AuthUser, d: GpsPointDto) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!d || !Number.isFinite(d.latitude) || Math.abs(d.latitude) > 90
      || !Number.isFinite(d.longitude) || Math.abs(d.longitude) > 180
      || (d.accuracy != null && (!Number.isFinite(d.accuracy) || d.accuracy < 0))) {
      throw new BadRequestException('إحداثيات الموقع غير صالحة');
    }
    let entityId = d.entityId || null;
    if (entityId?.startsWith('local:')) {
      const endpoint = d.entityTable === 'collections' ? '/collections'
        : d.entityTable === 'payment_promises' ? '/payment-promises' : null;
      if (!endpoint) throw new BadRequestException('نوع مرجع الموقع المحلي غير مدعوم');
      const saved = await this.prisma.idempotencyKey.findUnique({
        where: { key: `POST:${endpoint}:${entityId.slice(6)}` },
        select: { response: true },
      });
      const resolved = (saved?.response as { id?: string } | null)?.id;
      if (typeof resolved !== 'string' || !uuid.test(resolved)) {
        throw new ConflictException('الموقع محفوظ محليًا؛ يلزم اكتمال مزامنة التحصيل أو وعد السداد أولًا');
      }
      const where = {
        id: resolved,
        customer: { organizationId: user.organizationId },
        collector: { userId: user.id },
      };
      const owned = endpoint === '/collections'
        ? await this.prisma.collection.findFirst({ where, select: { id: true } })
        : await this.prisma.paymentPromise.findFirst({ where, select: { id: true } });
      if (!owned) throw new ForbiddenException('مرجع الموقع لا يخص عملية المستخدم');
      entityId = resolved;
    } else if (entityId && !uuid.test(entityId)) {
      throw new BadRequestException('رقم السجل المرتبط بالموقع غير صالح');
    }
    const timestamp = d.recordedAt ? new Date(d.recordedAt) : undefined;
    if (timestamp && !Number.isFinite(timestamp.getTime())) {
      throw new BadRequestException('تاريخ تسجيل الموقع غير صالح');
    }
    return {
      userId: user.id,
      latitude: d.latitude,
      longitude: d.longitude,
      accuracy: d.accuracy ?? null,
      entityTable: d.entityTable ?? null,
      entityId,
      ...(timestamp ? { timestamp } : {}),
    };
  }

  private async operationsCustomerDirectory(user: AuthUser, collectorId?: string) {
    const canUseCustomers = user.permissions.some(p => ['sales_order_drafts.read', 'sales_order_drafts.manage', 'reservations.read', 'reservations.create'].includes(p));
    if (!canUseCustomers) return [];
    const all = user.permissions.includes('customers.read_all') || user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const rows = await this.prisma.customer.findMany({
      where: {
        organizationId: user.organizationId, status: 'active',
        OR: [{ customerType: null }, { customerType: { not: 'advance' } }],
        ...(all ? {} : collectorId ? { assignments: { some: { collectorId, effectiveTo: null } } } : { id: { in: [] } }),
      },
      // Explicit allowlist, so later additions to Customer cannot expose balances.
      select: { id: true, name: true, accountNumber: true, externalCustomerCode: true, phonePrimary: true, phoneSecondary: true, whatsapp: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ name, ...row }) => ({ ...row, fullName: name }));
  }

  async sync(user: AuthUser, lastSyncToken?: string, operationsOnly = false, collectionOnly = false) {
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    const collectorId = collector?.id;

    const canReadAll = user.permissions.includes('customers.read_all');
    const canViewDeliveryDirectory = user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const canViewTasks = !operationsOnly && hasMobileFeature(user.permissions, 'mobile.tasks.view', 'tasks.manage');
    const canViewCustomers = canViewDeliveryDirectory
      || hasMobileFeature(user.permissions, 'mobile.customers.view', 'customers.read');
    const canViewFollowups = !operationsOnly && hasMobileFeature(user.permissions, 'mobile.followups.view', 'followups.create');
    const canViewPromises = !operationsOnly && hasMobileFeature(user.permissions, 'mobile.promises.view', 'promises.create');
    const canViewCollections = !operationsOnly && hasMobileFeature(user.permissions, 'mobile.collections.view', 'collections.create');
    const canViewReservations = hasMobileFeature(user.permissions, 'mobile.reservations.view', 'reservations.read');
    const canViewInventory = !collectionOnly && hasMobileFeature(user.permissions, 'mobile.inventory.view', 'reports.read');

    const taskWhere: any = {
      status: 'open',
      // Keep generated recommendations out of past/future buckets; today's
      // query below includes them for the offline daily work board.
      taskType: { notIn: [...REFRESHED_DAILY_TASK_TYPES] },
      customer: { organizationId: user.organizationId },
    };
    // An administrator may also have a collector profile. customers.read_all
    // must still expose the organization's task board; ordinary collectors
    // remain strictly scoped to their own assignments.
    if (!canReadAll) {
      taskWhere.assignedTo = collectorId ?? { in: [] };
    }
    const todayKey = orgDateOnly();
    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    const taskInclude = {
      customer: { select: { id: true, name: true } },
    } as const;
    // Keep independent limits per time bucket. A large overdue backlog must
    // never consume the shared limit and hide today's or upcoming tasks from
    // the phone's offline database.
    const rawTasksPromise = canViewTasks && (collectorId || canReadAll)
      ? Promise.all([
          this.prisma.task.findMany({
            where: { ...taskWhere, dueDate: { lt: todayStart } },
            include: taskInclude,
            orderBy: { dueDate: 'desc' },
            take: 500,
          }),
          this.prisma.task.findMany({
            where: { ...taskWhere, taskType: undefined, dueDate: { gte: todayStart, lt: tomorrowStart } },
            include: taskInclude,
            orderBy: { dueDate: 'asc' },
          }),
          this.prisma.task.findMany({
            where: { ...taskWhere, dueDate: { gte: tomorrowStart } },
            include: taskInclude,
            orderBy: { dueDate: 'asc' },
            take: 500,
          }),
        ]).then((groups) => groups.flat())
      : Promise.resolve([]);

    const [
      rawTasks, customers, rawFollowups, rawPromises, rawCollections, rawOracleReceiptActivities,
      rawReservations, currencies, collectionMethods, followupTypes, followupResults, reservationUnits, newDebt,
      oracleCurrencies, receiptCatalog, paymentCatalog, offlineInventoryCatalog, offlineInventorySummary, directOracleReceipts,
    ] = await Promise.all([
      rawTasksPromise,

      // The phone keeps the complete scoped balance snapshot so dashboard
      // totals match the web. Customer/advance work lists still apply the
      // materiality policy locally and through GET /mobile/customers.
      operationsOnly ? this.operationsCustomerDirectory(user, collectorId) : canViewCustomers ? this.findCustomers(user, false) : Promise.resolve([]),

      canViewFollowups ? this.prisma.followup.findMany({
        where: {
          deletedAt: null,
          ...(canReadAll
            ? { customer: { organizationId: user.organizationId } }
            : collectorId ? { userId: user.id } : { id: { in: [] } }),
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
            : collectorId ? { collectorId } : { id: { in: [] } }),
        },
        include: {
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),

      canViewCollections ? this.prisma.collection.findMany({
        where: {
          status: { not: 'reversed' },
          ...(canReadAll
            ? { customer: { organizationId: user.organizationId } }
            : collectorId ? { collectorId } : { id: { in: [] } }),
        },
        include: {
          customer: { select: { id: true, name: true, externalCustomerCode: true } },
          method: { select: { name: true } },
        },
        orderBy: { collectedAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),
      canViewCollections ? this.prisma.auditLog.findMany({
        where: {
          action: 'oracle_test_request_created',
          entityTable: 'IAS20261',
          user: { organizationId: user.organizationId },
          ...(canReadAll ? {} : { userId: user.id }),
        },
        select: { id: true, entityId: true, newValue: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }) : Promise.resolve([]),
      canViewReservations ? this.prisma.reservation.findMany({
        where: {
          customer: {
            organizationId: user.organizationId,
            status: 'active',
            ...(canReadAll
              ? {}
              : collectorId ? { assignments: { some: { collectorId, effectiveTo: null } } } : { id: { in: [] } }),
          },
        },
        include: { customer: { select: { id: true, name: true } }, measureUnit: { select: { nameAr: true, weightKg: true } } },
        orderBy: { reservedAt: 'desc' },
      }) : Promise.resolve([]),
      this.prisma.currency.findMany({
        where: { active: true },
        select: { code: true, sourceCode: true, nameAr: true, decimals: true, active: true },
        orderBy: { code: 'asc' },
      }),
      operationsOnly ? Promise.resolve([]) : this.prisma.collectionMethod.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      operationsOnly ? Promise.resolve([]) : this.prisma.followupType.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      operationsOnly ? Promise.resolve([]) : this.prisma.followupResult.findMany({
        where: { organizationId: user.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.unit.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameAr: true, weightKg: true },
        orderBy: [{ weightKg: 'desc' }, { nameAr: 'asc' }],
      }),
      operationsOnly ? Promise.resolve(null) : this.dashboard?.debtChangeLast24Hours(user) ?? Promise.resolve(null),
      this.oracleRequests?.currencies().catch(() => null) ?? Promise.resolve(null),
      operationsOnly ? Promise.resolve(null) : this.oracleRequests?.catalog('receipt').catch(() => null) ?? Promise.resolve(null),
      operationsOnly ? Promise.resolve(null) : this.oracleRequests?.catalog('payment').catch(() => null) ?? Promise.resolve(null),
      (!lastSyncToken || !Number.isFinite(new Date(lastSyncToken).getTime())
        || Date.now() - new Date(lastSyncToken).getTime() > 24 * 60 * 60 * 1000)
        ? canViewInventory ? this.oracleInventory?.offlineReferenceCatalog(user, 'IAS20261').catch(() => null) ?? Promise.resolve(null) : Promise.resolve(null)
        : Promise.resolve(null),
      canViewInventory
        ? this.oracleInventory?.summary(user, { sourceSchema: 'IAS20261' }).catch(() => null) ?? Promise.resolve(null)
        : Promise.resolve(null),
      canViewCollections ? oracleReceiptActivity(this.prisma, user) : Promise.resolve([]),
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
    const actionableRawTasks = (rawTasks as any[]).filter((task) =>
      !!task.customerId && debtorCustomerIds.has(task.customerId));
    const actionableTasks = ['overdue', 'today', 'upcoming'].flatMap((bucket) =>
      [true, false].flatMap((priority) => collapseMobileTasksByCustomer(actionableRawTasks.filter((task) =>
        mobileTaskBucket(task.dueDate, todayKey) === bucket
        && REFRESHED_DAILY_TASK_TYPES.includes(task.taskType) === priority))));
    const customerNameById = new Map<string, string>(customers.map((customer: any) => [String(customer.id), String(customer.fullName ?? customer.name ?? '')] as [string, string]));
    const currentReceiptStates = reconcileReceiptRequests(rawOracleReceiptActivities as any[],
      [...directOracleReceipts, ...recordedLocalReceiptFinals(rawCollections)],
      canViewCollections ? await this.oracleRequests?.receiptStatuses?.().catch(()=>[]) ?? [] : []);
    const stateByAudit = new Map(currentReceiptStates.map(request=>[request.auditId,request]));
    const customerByCode = new Map<string,any>(customers.map((customer:any)=>[customer.externalCustomerCode,customer] as [string,any]));
    const oracleReceiptCollections = (rawOracleReceiptActivities as any[]).flatMap((activity) => {
      const request = stateByAudit.get(activity.id);
      if (request && !request.platformCustomerId && request.platformCustomerCode) request.platformCustomerId = (customerByCode.get(request.platformCustomerCode) as any)?.id ?? null;
      const collection = mobileOracleReceiptCollection(activity, customerNameById, request);
      return collection ? [collection] : [];
    });
    const directReceiptCollections = directOracleReceipts.map(receipt => ({
      id: receipt.id, customerId: receipt.customerId, customerName: receipt.customer.name,
      amount: receipt.amount, currencyCode: receipt.currencyCode, methodName: receipt.method.name,
      status: 'recorded', source: 'oracle_direct_receipt', statusVerified: true,
      notes: `سند قبض Oracle رقم ${receipt.receiptNumber ?? receipt.referenceNumber}${receipt.notes ? ` — ${receipt.notes}` : ''}`,
      collectedAt: receipt.collectedAt, receiptAttachment: null, location: null,
    }));
    const customerAlertsSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const alertCustomers = (customers as any[]).filter((customer) => customer.customerType !== 'advance');
    const customerAlerts = !operationsOnly && canReadAll ? {
      unassigned: alertCustomers.filter((customer) => !customer.assignedCollectorName).length,
      newCustomers: alertCustomers.filter((customer) => String(customer.createdAt ?? '') >= customerAlertsSince).length,
      since: customerAlertsSince,
    } : null;

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
        ...(Array.isArray((oracleCurrencies as any)?.currencies) ? {
          oracleCurrencies: (oracleCurrencies as any).currencies,
        } : {}),
        ...(receiptCatalog ? { oracleReceiptCatalog: [{
          id: 'receipt', name: 'دليل سندات القبض', ...(receiptCatalog as Record<string, unknown>),
        }] } : {}),
        ...(paymentCatalog ? { oraclePaymentCatalog: [{
          id: 'payment', name: 'دليل سندات الصرف والقيود', ...(paymentCatalog as Record<string, unknown>),
        }] } : {}),
        ...((offlineInventoryCatalog as any)?.warehouses ? {
          oracleWarehouses: (offlineInventoryCatalog as any).warehouses,
          oracleItems: inventoryCostAccess((offlineInventoryCatalog as any).items ?? [], user.permissions),
        } : {}),
        ...((offlineInventorySummary || (offlineInventoryCatalog as any)?.summary) ? {
          oracleInventorySummary: inventoryCostAccess(mobileInventorySummaryReference(
            offlineInventorySummary as Record<string, unknown> | null,
            (offlineInventoryCatalog as any)?.summary,
          ), user.permissions),
        } : {}),
      },
      newDebt,
      customerAlerts,
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
        fulfilledAmount: p.fulfilledAmount == null ? null : Number(p.fulfilledAmount),
        currencyCode: p.currencyCode,
        dueDate: p.dueDate,
        status: p.status,
        settlementDate: p.settlementDate,
        settledLate: p.settledLate,
        missedDueDate: p.missedDueDate,
        notes: p.notes,
      })),
      collections: [...rawCollections.map((c) => ({
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
        status: c.status, source: 'platform_collection', statusVerified: true,
      })), ...oracleReceiptCollections, ...directReceiptCollections],
      reservations: rawReservations.map((r) => {
        const { quantity, remainingQty, totalAmount, totalTons, averageTonPrice } = mobileReservationValue(r);
        return {
          id: r.id, customerId: r.customerId, customerName: r.customer?.name ?? null,
          itemName: r.itemName, quantity, remainingQty, unitName: r.measureUnit?.nameAr || r.unit,
          totalAmount, currencyCode: r.currencyCode, totalTons,
          averageTonPrice,
          reservedAt: r.reservedAt, expiresAt: r.expiresAt, status: r.status,
        };
      }),
    };
  }

  async findCustomers(user: AuthUser, filterActionable = true) {
    const deliveryDirectory = user.permissions.includes('mobile.delivery.customers.view_all_no_balance');
    const includeBalances = user.permissions.includes('balances.read') || user.permissions.includes('customers.read_all');
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (user.permissions.includes('customers.read_all')) {
      return this.findActiveCustomerSnapshot({ organizationId: user.organizationId }, includeBalances, undefined, filterActionable);
    }
    if (deliveryDirectory) {
      return this.findActiveCustomerSnapshot({ organizationId: user.organizationId }, true, collector?.id ?? null, filterActionable);
    }

    if (!collector) return [];

    return this.findActiveCustomerSnapshot({
      organizationId: user.organizationId,
      assignments: { some: { collectorId: collector.id, effectiveTo: null } },
    }, includeBalances, undefined, filterActionable);
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

  private async findActiveCustomerSnapshot(
    where: any,
    includeBalances = true,
    balanceScopeCollectorId?: string | null,
    filterActionable = true,
  ) {
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
    const { engagement, recordedFollowups } = await this.mobileCustomerEngagementSummaries(
      customers[0]?.organizationId,
      shaped.map((customer) => customer.id),
    );
    const shapedWithEngagement = shaped.map((customer) => ({
      ...customer,
      hasRecordedEngagement: engagement.has(customer.id),
      hasRecordedFollowup: recordedFollowups.has(customer.id),
      lastEngagementAt: engagement.get(customer.id)?.toISOString() ?? null,
    }));
    if (!includeBalances) return shapedWithEngagement;
    // Collection directories must never carry settled or immaterial accounts.
    // Customer work remains debtor-only; advances retain both significant
    // debtor and creditor sides. Balance-hidden delivery contacts are kept
    // because their financial state is intentionally unavailable to the app.
    const visible = filterActionable ? shapedWithEngagement.filter((customer) => {
      if (customer.balanceHidden) return true;
      const balances = customer.balances ?? [];
      if (customer.customerType === 'advance') {
        return balances.some((balance: any) => isSignificantBalance(
          Number(balance.balance ?? 0),
          balance.currency,
        ));
      }
      return balances.some((balance: any) => isActionableDebtorBalance(
        Number(balance.balance ?? 0),
        balance.currency,
      ));
    }) : shapedWithEngagement;
    const groupSummaries = await this.mobileAccountGroupSummaries(
      customers[0]?.organizationId,
      visible.filter((customer) => !customer.balanceHidden).map((customer) => customer.id),
    );
    return visible.map((customer) => ({ ...customer, ...(groupSummaries.get(customer.id) ?? {}) }));
  }

  /**
   * A customer leaves the "never contacted" queue after any durable business
   * interaction. This summary is intentionally independent from the capped
   * timeline arrays sent to SQLite, otherwise an older interaction can fall
   * outside the latest 500 rows and incorrectly reappear as "never followed".
   */
  private async mobileCustomerEngagementSummaries(organizationId: string | undefined, customerIds: string[]) {
    const result = new Map<string, Date>();
    const recordedFollowups = new Set<string>();
    if (!organizationId || customerIds.length === 0) return {engagement: result, recordedFollowups};
    const [followups, promises, collections, receiptRequests] = await Promise.all([
      this.prisma.followup.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, deletedAt: null },
        _max: { followupAt: true },
      }),
      this.prisma.paymentPromise.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _max: { createdAt: true },
      }),
      this.prisma.collection.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, reversedById: null },
        _max: { collectedAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: 'oracle_test_request_created',
          entityTable: 'IAS20261',
          user: { organizationId },
        },
        select: { id: true, entityId: true, newValue: true, createdAt: true },
      }),
    ]);
    const remember = (customerId: unknown, at: unknown) => {
      const id = String(customerId ?? '');
      const date = at instanceof Date ? at : new Date(String(at ?? ''));
      if (!id || !customerIds.includes(id) || !Number.isFinite(date.getTime())) return;
      const previous = result.get(id);
      if (!previous || date > previous) result.set(id, date);
    };
    for (const row of followups) {
      recordedFollowups.add(row.customerId);
      remember(row.customerId, row._max.followupAt);
    }
    for (const row of promises) remember(row.customerId, row._max.createdAt);
    for (const row of collections) remember(row.customerId, row._max.collectedAt);
    for (const activity of receiptRequests) {
      const request = durableOracleRequest(activity);
      if (request?.kind === 'receipt') remember(request.platformCustomerId, activity.createdAt);
    }
    return {engagement: result, recordedFollowups};
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
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
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
