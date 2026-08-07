import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

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

  /** تعديل/حذف الأدوار النظامية الحساسة يتطلب صلاحية settings.manage. */
  private assertCanModify(actor: AuthUser, role: { name: string; isSystem: boolean }) {
    if (role.isSystem && SENSITIVE_SYSTEM_ROLES.includes(role.name)) {
      if (!actor.permissions.includes('settings.manage')) {
        throw new ForbiddenException(
          'تعديل الدور النظامي الحساس يتطلب صلاحية settings.manage (تحقق إضافي)',
        );
      }
    }
  }

  /** إنشاء دور جديد — فريد ضمن المنشأة. */
  async createRole(actor: AuthUser, dto: CreateRoleDto, req?: Request) {
    const exists = await this.prisma.role.findFirst({
      where: { organizationId: actor.organizationId, name: dto.name },
    });
    if (exists) throw new ConflictException('اسم الدور مستخدم مسبقًا');

    const role = await this.prisma.role.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        // User-created roles must never be promoted to protected system roles
        // through the public API.
        isSystem: false,
      },
      select: { id: true, name: true, isSystem: true },
    });
    await this.audit.log({
      userId: actor.id, action: 'role_created', entityTable: 'roles', entityId: role.id,
      newValue: { name: dto.name, isSystem: false }, req,
    });
    return role;
  }

  /** تعديل اسم الدور — لا يمكن تعديل الأدوار النظامية الحساسة بدون settings.manage. */
  async updateRole(actor: AuthUser, id: string, dto: UpdateRoleDto, req?: Request) {
    const before = await this.prisma.role.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('الدور غير موجود');
    if (before.isSystem && SENSITIVE_SYSTEM_ROLES.includes(before.name)) {
      if (!actor.permissions.includes('settings.manage')) {
        throw new ForbiddenException('لا يمكن تعديل اسم الدور النظامي الحساس');
      }
    }

    if (dto.name && dto.name !== before.name) {
      const dup = await this.prisma.role.findFirst({
        where: { organizationId: actor.organizationId, name: dto.name },
      });
      if (dup) throw new ConflictException('اسم الدور مستخدم مسبقًا');
    }

    const role = await this.prisma.role.update({
      where: { id },
      data: { name: dto.name ?? before.name },
      select: { id: true, name: true, isSystem: true },
    });
    await this.audit.log({
      userId: actor.id, action: 'role_updated', entityTable: 'roles', entityId: id,
      oldValue: { name: before.name }, newValue: { name: role.name }, req,
    });
    return role;
  }

  /** حذف الدور — ممنوع إذا كان عليه مستخدمون، والأدوار النظامية الحساسة لا تحذف. */
  async deleteRole(actor: AuthUser, id: string, req?: Request) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!role) throw new NotFoundException('الدور غير موجود');
    if (role._count.userRoles > 0) {
      throw new ConflictException('لا يمكن حذف دور عليه مستخدمون — انزع الدور من المستخدمين أولاً');
    }
    if (role.isSystem && SENSITIVE_SYSTEM_ROLES.includes(role.name)) {
      throw new ForbiddenException('لا يمكن حذف الدور النظامي الحساس');
    }

    await this.prisma.role.delete({ where: { id } });
    await this.audit.log({
      userId: actor.id, action: 'role_deleted', entityTable: 'roles', entityId: id,
      oldValue: { name: role.name, isSystem: role.isSystem }, req,
    });
    return { message: 'تم حذف الدور' };
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
