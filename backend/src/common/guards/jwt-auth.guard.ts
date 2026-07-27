import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface AuthUser {
  id: string;
  organizationId: string;
  branchId: string | null;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

/**
 * حارس JWT عام (مسجل APP_GUARD):
 * - يسمح بالمسارات الموسومة @Public.
 * - يتحقق من Access Token، ثم يحمّل المستخدم وأدواره وصلاحياته من القاعدة
 *   في كل طلب — حتى يسري التعطيل وسحب الأدوار فورًا دون انتظار انتهاء التوكن.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Access Token مطلوب');
    }

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Access Token غير صالح أو منتهي');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('الحساب غير موجود أو معطّل');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ];

    (req as any).user = {
      id: user.id,
      organizationId: user.organizationId,
      branchId: user.branchId,
      username: user.username,
      fullName: user.fullName,
      roles,
      permissions,
    } satisfies AuthUser;
    return true;
  }
}
