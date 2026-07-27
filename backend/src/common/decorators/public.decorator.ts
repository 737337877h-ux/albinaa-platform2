import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
/** يجعل الـ Endpoint متاحًا بدون مصادقة (مثل /health و /auth/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
