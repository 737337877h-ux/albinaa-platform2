import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GpsPointDto } from './dto/gps-point.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';

@Injectable()
export class MobileService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadReceipt(user: AuthUser, file: Express.Multer.File, dto: UploadReceiptDto) {
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

  async sync(user: AuthUser, lastSyncToken?: string) {
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    const collectorId = collector?.id;

    const since = lastSyncToken ? new Date(lastSyncToken) : undefined;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [tasks, customers, followups, promises, collections] = await Promise.all([
      collectorId
        ? this.prisma.task.findMany({
            where: {
              assignedTo: collectorId,
              dueDate: { gte: todayStart },
              ...(since ? { createdAt: { gte: since } } : {}),
            },
            include: {
              customer: { select: { id: true, name: true } },
            },
            orderBy: { dueDate: 'asc' },
          })
        : [],

      this.findCustomers(user),

      collectorId
        ? this.prisma.followup.findMany({
            where: {
              userId: user.id,
              deletedAt: null,
              ...(since ? { followupAt: { gte: since } } : {}),
            },
            include: {
              customer: { select: { id: true, name: true } },
              type: { select: { name: true } },
              result: { select: { name: true } },
            },
            orderBy: { followupAt: 'desc' },
            take: 50,
          })
        : [],

      collectorId
        ? this.prisma.paymentPromise.findMany({
            where: {
              collectorId,
              ...(since ? { createdAt: { gte: since } } : {}),
            },
            include: {
              customer: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : [],

      collectorId
        ? this.prisma.collection.findMany({
            where: {
              collectorId,
              ...(since ? { collectedAt: { gte: since } } : {}),
            },
            include: {
              customer: { select: { id: true, name: true } },
              method: { select: { name: true } },
            },
            orderBy: { collectedAt: 'desc' },
            take: 50,
          })
        : [],
    ]);

    const syncToken = new Date().toISOString();

    return {
      serverTime: syncToken,
      syncToken,
      tasks,
      customers,
      followups,
      promises,
      collections,
    };
  }

  async findCustomers(user: AuthUser) {
    if (user.permissions.includes('customers.read_all')) {
      const customers = await this.prisma.customer.findMany({
        where: { organizationId: user.organizationId },
        include: {
          balances: { select: { currencyCode: true, accountingBalance: true } },
        },
        orderBy: { name: 'asc' },
      });
      return customers.map((c) => this.shapeCustomer(c));
    }

    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (!collector) return [];

    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: user.organizationId,
        assignments: { some: { collectorId: collector.id, effectiveTo: null } },
      },
      include: {
        balances: { select: { currencyCode: true, accountingBalance: true } },
      },
      orderBy: { name: 'asc' },
    });
    return customers.map((c) => this.shapeCustomer(c));
  }

  private shapeCustomer(c: any) {
    return {
      id: c.id,
      fullName: c.name,
      phonePrimary: c.phonePrimary,
      address: c.address,
      balances: c.balances.map((b: any) => ({
        currency: b.currencyCode,
        balance: Number(b.accountingBalance),
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
      balances: customer.balances.map((b: any) => ({
        currency: b.currencyCode,
        accountingBalance: Number(b.accountingBalance),
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
