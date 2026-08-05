import { Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { validateBrandingSetting } from '../common/branding';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(orgId: string) {
    return this.prisma.systemSetting.findMany({
      where: { organizationId: orgId },
    });
  }

  async upsert(actor: AuthUser, key: string, value: any, req?: Request) {
    validateBrandingSetting(key, value);
    const before = await this.prisma.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key } },
    });

    const setting = await this.prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: actor.organizationId, key } },
      create: { organizationId: actor.organizationId, key, value },
      update: { value },
    });

    await this.audit.log({
      userId: actor.id,
      action: before ? 'setting_updated' : 'setting_created',
      entityTable: 'system_settings',
      entityId: key,
      oldValue: before ? { value: before.value } : undefined,
      newValue: { value },
      req,
    });

    return setting;
  }

  async remove(actor: AuthUser, key: string, req?: Request) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key } },
    });
    if (!setting) throw new NotFoundException('الإعداد غير موجود');

    await this.prisma.systemSetting.delete({
      where: { organizationId_key: { organizationId: actor.organizationId, key } },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'setting_deleted',
      entityTable: 'system_settings',
      entityId: key,
      oldValue: { value: setting.value },
      req,
    });
  }
}
