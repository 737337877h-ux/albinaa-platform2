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
        deviceName: input.deviceName?.trim() || null,
      },
      update: {
        userId: user.id,
        platform: input.platform,
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
      await this.prisma.notification.create({ data: { userId, kind, payload: payload as any } });
    } catch (e) {
      // فشل الإشعار لا يُسقط العملية الأصلية
      this.logger.error(`فشل إنشاء إشعار ${kind}`, e instanceof Error ? e.stack : String(e));
    }
    await this.sendExternalPush(userId, kind, payload);
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

  private pushMessage(kind: string, payload: Record<string, unknown>) {
    const customerName = typeof payload.customerName === 'string' ? payload.customerName : '';
    const messages: Record<string, [string, string]> = {
      followup_due: ['متابعة مستحقة', customerName ? `حان موعد متابعة ${customerName}` : 'لديك متابعة مستحقة'],
      promise_due: ['وعد سداد مستحق', customerName ? `حان موعد وعد السداد للعميل ${customerName}` : 'لديك وعد سداد مستحق'],
      promise_overdue: ['وعد سداد متأخر', customerName ? `تأخر وعد السداد للعميل ${customerName}` : 'لديك وعد سداد متأخر'],
      customer_transferred: ['إسناد عميل جديد', customerName ? `تم إسناد ${customerName} إليك` : 'تم إسناد عميل جديد إليك'],
      finance_alert: ['تنبيه مالي مهم', 'يوجد إجراء مالي يتطلب المراجعة'],
    };
    const [title, body] = messages[kind] ?? ['تنبيه من الراقي', 'لديك تحديث جديد في نظام التحصيل'];
    return { title, body };
  }

  private async sendExternalPush(userId: string, kind: string, payload: Record<string, unknown>) {
    if (process.env.PUSH_ENABLED !== 'true') return;
    try {
      const devices = await this.prisma.devicePushToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (devices.length === 0) return;
      const content = this.pushMessage(kind, payload);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (process.env.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      }
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(devices.map(({ token }) => ({
          to: token,
          sound: 'default',
          channelId: 'albinaa-reminders',
          ...content,
          data: { kind, ...payload },
        }))),
      });
      if (!response.ok) throw new Error(`Expo Push HTTP ${response.status}`);
      const result = await response.json() as { data?: Array<{ details?: { error?: string } }> };
      const invalid = devices.filter((_, index) => result.data?.[index]?.details?.error === 'DeviceNotRegistered');
      if (invalid.length > 0) {
        await this.prisma.devicePushToken.deleteMany({
          where: { token: { in: invalid.map(({ token }) => token) } },
        });
      }
    } catch (e) {
      // External delivery is best-effort; the in-app notification remains authoritative.
      this.logger.error(`فشل إرسال Push للإشعار ${kind}`, e instanceof Error ? e.stack : String(e));
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

  async listMine(user: AuthUser, unreadOnly = false, page = 1, limit = 25) {
    const where = { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) };
    const [total, unread, items] = await Promise.all([
      this.prisma.notification.count({ where: { userId: user.id } }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
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

  async markAllRead(user: AuthUser) {
    const res = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }
}
