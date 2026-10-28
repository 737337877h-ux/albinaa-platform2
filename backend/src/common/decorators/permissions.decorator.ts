import { SetMetadata } from '@nestjs/common';
export const PERMISSIONS_KEY = 'required_permissions';
export const ANY_PERMISSIONS_KEY = 'any_required_permissions';
/** يتطلب امتلاك كل الصلاحيات المذكورة (AND). التحقق في API وليس الواجهة. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
/** يتطلب امتلاك صلاحية واحدة على الأقل من الصلاحيات المذكورة (OR). */
export const RequireAnyPermissions = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
