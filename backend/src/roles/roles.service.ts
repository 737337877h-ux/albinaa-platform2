import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/** الأدوار النظامية الحساسة — تعديل صلاحياتها يتطلب تحققًا إضافيًا (settings.manage). */
const SENSITIVE_SYSTEM_ROLES = ['مدير النظام'];

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAllRoles(orgId: string) {
    return this.prisma.role.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, isSystem: true,
        _count: { select: { userRoles: true, rolePermissions: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  findAllPermissions() {
    return this.prisma.permission.findMany({
      select: { id: true, code: true, descriptionAr: true },
      orderBy: { code: 'asc' },
    });
  }

  async findRolePermissions(orgId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId: orgId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('الدور غير موجود');
    return {
      id: role.id, name: role.name, isSystem: role.isSystem,
      permissions: role.rolePermissions.map((rp) => rp.permission),
    };
  }

  /** تعديل الأدوار النظامية الحساسة يتطلب صلاحية settings.manage إضافةً إلى users.manage. */
  private assertCanModify(actor: AuthUser, role: { name: string; isSystem: boolean }) {
    if (role.isSystem && SENSITIVE_SYSTEM_ROLES.includes(role.name)) {
      if (!actor.permissions.includes('settings.manage')) {
        throw new ForbiddenException(
          'تعديل الدور النظامي الحساس يتطلب صلاحية settings.manage (تحقق إضافي)',
        );
      }
    }
  }

  async grantPermissions(actor: AuthUser, roleId: string, permissionIds: string[], req?: Request) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId: actor.organizationId },
    });
    if (!role) throw new NotFoundException('الدور غير موجود');
    this.assertCanModify(actor, role);

    const perms = await this.prisma.permission.findMany({ where: { id: { in: permissionIds } } });
    if (perms.length !== permissionIds.length) {
      throw new BadRequestException('بعض الصلاحيات غير موجودة');
    }

    for (const permissionId of permissionIds) {
      await this.prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
    await this.audit.log({
      userId: actor.id, action: 'role_permissions_granted', entityTable: 'roles', entityId: roleId,
      newValue: { permissions: perms.map((p) => p.code) }, req,
    });
    return this.findRolePermissions(actor.organizationId, roleId);
  }

  async revokePermission(actor: AuthUser, roleId: string, permissionId: string, req?: Request) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId: actor.organizationId },
    });
    if (!role) throw new NotFoundException('الدور غير موجود');
    this.assertCanModify(actor, role);

    const rp = await this.prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId, permissionId } },
      include: { permission: true },
    });
    if (!rp) throw new NotFoundException('الدور لا يملك هذه الصلاحية');

    await this.prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId, permissionId } },
    });
    await this.audit.log({
      userId: actor.id, action: 'role_permission_revoked', entityTable: 'roles', entityId: roleId,
      oldValue: { permission: rp.permission.code }, req,
    });
    return this.findRolePermissions(actor.organizationId, roleId);
  }
}
