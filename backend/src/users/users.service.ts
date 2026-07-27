import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** الحقول الآمنة للإرجاع — password_hash لا يغادر الخدمة أبدًا. */
const SAFE_SELECT = {
  id: true, username: true, fullName: true, phone: true, isActive: true,
  branchId: true, organizationId: true, lastLoginAt: true, createdAt: true,
  userRoles: { select: { role: { select: { id: true, name: true, isSystem: true } } } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private shape(u: any) {
    const { userRoles, ...rest } = u;
    return { ...rest, roles: userRoles.map((ur: any) => ur.role) };
  }

  async findAll(orgId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: orgId },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.shape(u));
  }

  async findOne(orgId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId: orgId }, select: SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    return this.shape(user);
  }

  async create(actor: AuthUser, dto: CreateUserDto, req?: Request) {
    const exists = await this.prisma.user.findFirst({
      where: { organizationId: actor.organizationId, username: dto.username },
    });
    if (exists) throw new ConflictException('اسم المستخدم مستخدم مسبقًا');

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId: actor.organizationId },
      });
      if (!branch) throw new BadRequestException('الفرع غير موجود');
    }

    const user = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        branchId: dto.branchId ?? null,
        username: dto.username,
        fullName: dto.fullName,
        phone: dto.phone ?? null,
        passwordHash: await this.passwords.hash(dto.password),
        userRoles: dto.roleIds?.length
          ? { create: dto.roleIds.map((roleId) => ({ roleId, grantedBy: actor.id })) }
          : undefined,
      },
      select: SAFE_SELECT,
    });

    await this.audit.log({
      userId: actor.id, action: 'user_created', entityTable: 'users', entityId: user.id,
      newValue: { username: dto.username, fullName: dto.fullName, roleIds: dto.roleIds ?? [] }, req,
    });
    return this.shape(user);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto, req?: Request) {
    const before = await this.findOne(actor.organizationId, id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { fullName: dto.fullName, phone: dto.phone, branchId: dto.branchId },
      select: SAFE_SELECT,
    });
    await this.audit.log({
      userId: actor.id, action: 'user_updated', entityTable: 'users', entityId: id,
      oldValue: { fullName: before.fullName, phone: before.phone, branchId: before.branchId },
      newValue: dto, req,
    });
    return this.shape(user);
  }

  /**
   * تفعيل/تعطيل — لا حذف نهائيًا.
   * حماية: لا يمكن تعطيل آخر "مدير نظام" نشط (يشمل محاولة المدير تعطيل نفسه).
   */
  async setStatus(actor: AuthUser, id: string, isActive: boolean, req?: Request) {
    const target = await this.findOne(actor.organizationId, id);

    if (!isActive) {
      const targetIsAdmin = target.roles.some((r: any) => r.name === 'مدير النظام');
      if (targetIsAdmin) {
        const otherActiveAdmins = await this.prisma.user.count({
          where: {
            organizationId: actor.organizationId,
            isActive: true,
            id: { not: id },
            userRoles: { some: { role: { name: 'مدير النظام' } } },
          },
        });
        if (otherActiveAdmins === 0) {
          throw new BadRequestException('لا يمكن تعطيل آخر مدير نظام نشط');
        }
      }
    }

    const user = await this.prisma.user.update({
      where: { id }, data: { isActive }, select: SAFE_SELECT,
    });
    if (!isActive) {
      // إبطال جلسات المستخدم المعطل فورًا
      await this.prisma.authSession.updateMany({
        where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
      });
    }
    await this.audit.log({
      userId: actor.id, action: isActive ? 'user_enabled' : 'user_disabled',
      entityTable: 'users', entityId: id,
      oldValue: { isActive: target.isActive }, newValue: { isActive }, req,
    });
    return this.shape(user);
  }

  async resetPassword(actor: AuthUser, id: string, newPassword: string, req?: Request) {
    await this.findOne(actor.organizationId, id);
    await this.prisma.user.update({
      where: { id }, data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    await this.prisma.authSession.updateMany({
      where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
    });
    await this.audit.log({
      userId: actor.id, action: 'user_password_reset', entityTable: 'users', entityId: id, req,
    });
    return { message: 'تمت إعادة تعيين كلمة المرور وإبطال جلسات المستخدم' };
  }

  async grantRoles(actor: AuthUser, id: string, roleIds: string[], req?: Request) {
    await this.findOne(actor.organizationId, id);
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds }, organizationId: actor.organizationId },
    });
    if (roles.length !== roleIds.length) throw new BadRequestException('بعض الأدوار غير موجودة');

    for (const roleId of roleIds) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: id, roleId } },
        update: {},
        create: { userId: id, roleId, grantedBy: actor.id },
      });
    }
    await this.audit.log({
      userId: actor.id, action: 'user_roles_granted', entityTable: 'users', entityId: id,
      newValue: { roleIds }, req,
    });
    return this.findOne(actor.organizationId, id);
  }

  async revokeRole(actor: AuthUser, id: string, roleId: string, req?: Request) {
    const target = await this.findOne(actor.organizationId, id);
    const role = target.roles.find((r: any) => r.id === roleId);
    if (!role) throw new NotFoundException('المستخدم لا يملك هذا الدور');

    // حماية آخر مدير نظام: سحب دور المدير من آخر مدير نشط ممنوع
    if (role.name === 'مدير النظام' && target.isActive) {
      const otherActiveAdmins = await this.prisma.user.count({
        where: {
          organizationId: actor.organizationId, isActive: true, id: { not: id },
          userRoles: { some: { role: { name: 'مدير النظام' } } },
        },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException('لا يمكن سحب دور مدير النظام من آخر مدير نشط');
      }
    }

    await this.prisma.userRole.delete({ where: { userId_roleId: { userId: id, roleId } } });
    await this.audit.log({
      userId: actor.id, action: 'user_role_revoked', entityTable: 'users', entityId: id,
      oldValue: { roleId, roleName: role.name }, req,
    });
    return this.findOne(actor.organizationId, id);
  }
}
