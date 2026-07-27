import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;              // login_success / user_created / role_granted ...
  entityTable: string;         // users / branches / roles / auth ...
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  req?: Request;               // لاستخراج IP و User-Agent
}

/**
 * تسجيل مركزي في audit_logs (جدول Append-Only محمي بـ Trigger في القاعدة).
 * قاعدة صارمة: لا تُمرَّر كلمات مرور أو Hashes أو Tokens في oldValue/newValue أبدًا.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private static readonly FORBIDDEN_KEYS = [
    'password', 'passwordHash', 'password_hash', 'token', 'refreshToken', 'accessToken', 'secret',
  ];

  constructor(private readonly prisma: PrismaService) {}

  private sanitize(value: unknown): unknown {
    if (value == null || typeof value !== 'object') return value;
    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const k of Object.keys(clone)) {
      if (AuditService.FORBIDDEN_KEYS.some((f) => k.toLowerCase().includes(f.toLowerCase()))) {
        clone[k] = '[REDACTED]';
      }
    }
    return clone;
  }

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityTable: entry.entityTable,
          entityId: entry.entityId ?? null,
          oldValue: entry.oldValue === undefined ? undefined : (this.sanitize(entry.oldValue) as any),
          newValue: entry.newValue === undefined ? undefined : (this.sanitize(entry.newValue) as any),
          reason: entry.reason ?? null,
          ipAddress: entry.req?.ip ?? null,
          userAgent: (entry.req?.headers['user-agent'] as string) ?? null,
        },
      });
    } catch (e) {
      // فشل التدقيق لا يجب أن يسقط العملية الأصلية — لكنه يُسجَّل كتحذير جاد
      this.logger.error(`فشل تسجيل التدقيق: ${entry.action}`, e instanceof Error ? e.stack : String(e));
    }
  }
}
