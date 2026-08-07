import { Injectable, NotFoundException, InternalServerErrorException, StreamableFile } from '@nestjs/common';
import * as fs from 'fs';
import { createReadStream } from 'fs';
import { extname } from 'path';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GpsPointDto } from './dto/gps-point.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';

@Injectable()
export class MobileService {
  constructor(private readonly prisma: PrismaService) {}

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

    const taskWhere: any = {
      status: 'open',
    };
    if (collectorId) taskWhere.assignedTo = collectorId;
    else if (!canReadAll) taskWhere.assignedTo = 'no-access';

    const [
      rawTasks, customers, rawFollowups, rawPromises, rawCollections,
      currencies, collectionMethods, followupTypes, followupResults,
    ] = await Promise.all([
      collectorId || canReadAll
        ? this.prisma.task.findMany({
            where: taskWhere,
            include: {
              customer: { select: { id: true, name: true } },
            },
            orderBy: { dueDate: 'asc' },
            take: 500,
          })
        : Promise.resolve([]),

      this.findCustomers(user),

      this.prisma.followup.findMany({
        where: {
          deletedAt: null,
          ...(collectorId && !canReadAll ? { userId: user.id } : { customer: { organizationId: user.organizationId } }),
        },
        include: {
          customer: { select: { id: true, name: true } },
          type: { select: { name: true } },
          result: { select: { name: true } },
        },
        orderBy: { followupAt: 'desc' },
        take: 500,
      }),

      this.prisma.paymentPromise.findMany({
        where: {
          ...(collectorId && !canReadAll
            ? { collectorId }
            : { customer: { organizationId: user.organizationId } }),
        },
        include: {
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),

      this.prisma.collection.findMany({
        where: {
          ...(collectorId && !canReadAll
            ? { collectorId }
            : { customer: { organizationId: user.organizationId } }),
        },
        include: {
          customer: { select: { id: true, name: true } },
          method: { select: { name: true } },
        },
        orderBy: { collectedAt: 'desc' },
        take: 500,
      }),
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
    ]);

    const syncToken = new Date().toISOString();

    return {
      serverTime: syncToken,
      syncToken,
      snapshot: 'full',
      schemaVersion: 1,
      references: {
        currencies,
        collectionMethods,
        followupTypes,
        followupResults,
      },
      tasks: rawTasks.map((t) => ({
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
      })),
    };
  }

  async findCustomers(user: AuthUser) {
    if (user.permissions.includes('customers.read_all')) {
      return this.findActiveCustomerSnapshot({ organizationId: user.organizationId });
    }

    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (!collector) return [];

    return this.findActiveCustomerSnapshot({
      organizationId: user.organizationId,
      assignments: { some: { collectorId: collector.id, effectiveTo: null } },
    });
  }

  private async findActiveCustomerSnapshot(where: any) {
    const customers = await this.prisma.customer.findMany({
      where: { ...where, status: 'active' },
      include: {
        balances: {
          select: {
            currencyCode: true,
            accountingBalance: true,
            lastImportJob: { select: { importedAt: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (customers.length === 0) return [];

    const balanceCutoffs = new Map<string, number>();
    for (const customer of customers) {
      for (const balance of customer.balances) {
        const key = `${customer.id}:${balance.currencyCode}`;
        balanceCutoffs.set(key, balance.lastImportJob?.importedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
      }
    }

    const ledgerEntries = await this.prisma.operationalLedger.findMany({
      where: { customerId: { in: customers.map((customer) => customer.id) } },
      select: {
        customerId: true,
        currencyCode: true,
        amountSigned: true,
        createdAt: true,
      },
    });
    const ledgerDeltas = new Map<string, number>();
    for (const entry of ledgerEntries) {
      const key = `${entry.customerId}:${entry.currencyCode}`;
      const cutoff = balanceCutoffs.get(key);
      if (cutoff == null || entry.createdAt.getTime() <= cutoff) continue;
      ledgerDeltas.set(key, (ledgerDeltas.get(key) ?? 0) + Number(entry.amountSigned));
    }

    return customers.map((customer) => this.shapeCustomer(customer, ledgerDeltas));
  }

  private shapeCustomer(c: any, ledgerDeltas: Map<string, number> = new Map()) {
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
      balances: c.balances.map((b: any) => ({
        currency: b.currencyCode,
        balance: Number(b.accountingBalance) + (ledgerDeltas.get(`${c.id}:${b.currencyCode}`) ?? 0),
      })),
    };
  }

  async findCustomer360(user: AuthUser, id: string) {
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    const where: any = { id, organizationId: user.organizationId };

    if (!user.permissions.includes('customers.read_all')) {
      if (!collector) throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');
      where.assignments = { some: { collectorId: collector.id, effectiveTo: null } };
    }

    const customer = await this.prisma.customer.findFirst({
      where,
      include: {
        balances: true,
      },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');

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
      balances: await Promise.all(customer.balances.map(async (b: any) => {
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
      })),
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
