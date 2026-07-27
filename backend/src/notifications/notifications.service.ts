import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * إشعارات داخلية (تُحفظ في القاعدة — بلا Push في هذه المرحلة، حسب المتطلب).
 * الأنواع الحالية: followup_due, promise_due, promise_overdue,
 * collection_created, customer_transferred.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notifyUser(userId: string, kind: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.notification.create({ data: { userId, kind, payload: payload as any } });
    } catch (e) {
      // فشل الإشعار لا يُسقط العملية الأصلية
      this.logger.error(`فشل إنشاء إشعار ${kind}`, e instanceof Error ? e.stack : String(e));
    }
  }

  /** إشعار كل مستخدمي المنشأة الحاملين صلاحية معينة (مثل أمين الصندوق cash.receive). */
  async notifyByPermission(orgId: string, permissionCode: string, kind: string, payload: Record<string, unknown>) {
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
