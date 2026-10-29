import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthUser } from './jwt-auth.guard';

/** يتحقق أن المستخدم يملك كل الصلاحيات المطلوبة على الـ Endpoint. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    const anyRequired = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if ((!required || required.length === 0) && (!anyRequired || anyRequired.length === 0)) return true;

    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) return false; // مسار محمي بدون مستخدم — JwtAuthGuard رفضه أصلاً
    const missing = (required ?? []).filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`صلاحيات ناقصة: ${missing.join(', ')}`);
    }
    if (anyRequired?.length && !anyRequired.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(`يلزم امتلاك إحدى الصلاحيات: ${anyRequired.join(', ')}`);
    }
    return true;
  }
}
