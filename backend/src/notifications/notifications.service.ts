import {pushMessage} from './push-message';
import {notificationApplicationScope} from './application-scope';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PushTokenDto } from './dto/push-token.dto';

/**
 * الإشعار الداخلي هو السجل المعتمد، ويمكن توصيل نسخة خارجية للهاتف عند تفعيل Push.
 * الأنواع الحالية: followup_due, promise_due, promise_overdue,
 * collection_created, customer_transferred.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerPushToken(user: AuthUser, input: PushTokenDto) {
    const item = await this.prisma.devicePushToken.upsert({
      where: { token: input.token },
      create: {
        userId: user.id,
        token: input.token,
        platform: input.platform,
        applicationId: input.applicationId ?? 'com.albinaa.collector',
        notificationChannelId: input.notificationChannelId ?? null,
        deviceName: input.deviceName?.trim() || null,
      },
      update: {
        userId: user.id,
        platform: input.platform,
        applicationId: input.applicationId ?? 'com.albinaa.collector',
        notificationChannelId: input.notificationChannelId ?? null,
        deviceName: input.deviceName?.trim() || null,
        lastSeenAt: new Date(),
      },
      select: { id: true, platform: true, lastSeenAt: true },
    });
    return { registered: true, device: item };
  }

  async unregisterPushToken(user: AuthUser, token: string) {
    const result = await this.prisma.devicePushToken.deleteMany({
      where: { userId: user.id, token },
    });
    return { removed: result.count > 0 };
  }

  async notifyUser(userId: string, kind: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.$transaction(async tx => {
        const notification = await tx.notification.create({ data: { userId, kind, payload: payload as any } });
        const content = pushMessage(kind, payload);
        await tx.hrPushDelivery.create({ data: { id: notification.id, userId, kind, payload: { ...payload, title: content.title, message: content.body } as any } });
      });
    } catch (e) {
      // فشل الإشعار لا يُسقط العملية الأصلية
      this.logger.error(`فشل إنشاء إشعار ${kind}`, e instanceof Error ? e.stack : String(e));
    }
  }

  /** إشعار كل مستخدمي المنشأة الحاملين صلاحية معينة (مثل أمين الصندوق cash.receive). */
  async notifyByPermission(orgId: string, permissionCode: string, kind: string, payload: Record<string, unknown>) {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          organizationId: orgId,
          isActive: true,
          userRoles: {
            some: { role: { rolePermissions: { some: { permission: { code: permissionCode } } } } },
          },
        },
        select: { id: true },
      });
      await Promise.all(users.map((u) => this.notifyUser(u.id, kind, payload)));
    } catch (e) {
      this.logger.error(`فشل تحديد مستلمي إشعار ${kind}`, e instanceof Error ? e.stack : String(e));
    }
  }

  /** Notify each matching user once when any of the supplied permissions is granted. */
  async notifyByPermissions(orgId: string, permissionCodes: string[], kind: string, payload: Record<string, unknown>) {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          organizationId: orgId,
          isActive: true,
          userRoles: {
            some: { role: { rolePermissions: { some: { permission: { code: { in: permissionCodes } } } } } },
          },
        },
        select: { id: true },
      });
      await Promise.all(users.map((u) => this.notifyUser(u.id, kind, payload)));
    } catch (e) {
      this.logger.error(`فشل تحديد مستلمي إشعار ${kind}`, e instanceof Error ? e.stack : String(e));
    }
  }

  async notifyFinance(
    orgId: string,
    event: 'collection_reversed' | 'manual_balance_adjustment' | 'credit_limit_overridden' | 'customer_merged' | 'import_reversed',
    payload: Record<string, unknown>,
  ) {
    await this.notifyByPermission(orgId, 'finance.alerts.receive', 'finance_alert', {
      event,
      severity: 'critical',
      occurredAt: new Date().toISOString(),
      ...payload,
    });
  }

  async listMine(user: AuthUser, unreadOnly = false, page = 1, limit = 25, application?:string) {
    const baseWhere = {userId:user.id,...notificationApplicationScope(application)};
    const where = { ...baseWhere, ...(unreadOnly ? { readAt: null } : {}) };
    const [total, unread, items] = await Promise.all([
      this.prisma.notification.count({ where: baseWhere }),
      this.prisma.notification.count({ where: { ...baseWhere, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { page, limit, total, unread, items };
  }

  async markRead(user: AuthUser, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId: user.id } });
    if (!n) throw new NotFoundException('الإشعار غير موجود');
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(user: AuthUser, application?:string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null, ...notificationApplicationScope(application) },
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }
}
