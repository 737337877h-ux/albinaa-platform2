import { SetMetadata } from '@nestjs/common';
export const PERMISSIONS_KEY = 'required_permissions';
/** يتطلب امتلاك كل الصلاحيات المذكورة (AND). التحقق في API وليس الواجهة. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
