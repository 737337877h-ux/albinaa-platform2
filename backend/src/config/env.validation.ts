import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

/**
 * التحقق من متغيرات البيئة عند الإقلاع — يفشل التشغيل فورًا إذا نقص سر أساسي.
 * لا تُطبع القيم في أي رسالة خطأ (أسماء المتغيرات فقط).
 */
class EnvVars {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: string;

  @IsString()
  @MinLength(20)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET يجب أن يكون 32 حرفًا على الأقل' })
  JWT_ACCESS_SECRET!: string;

  /**
   * ملاحظة: JWT_REFRESH_SECRET غير مستخدم حاليًا — الـ Refresh Tokens حركات
   * عشوائية (opaque) بدل JWTs، لكن يُحتفظ به لحماية المستقبل إذا تم التحوّل
   * إلى JWT-based refresh tokens ( defence-in-depth ).
   */
  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET يجب أن يكون 32 حرفًا على الأقل' })
  JWT_REFRESH_SECRET!: string;

  @IsInt()
  @Min(60)
  JWT_ACCESS_TTL!: number;

  @IsInt()
  @Min(3600)
  JWT_REFRESH_TTL!: number;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'ADMIN_INITIAL_PASSWORD يجب أن يكون 8 أحرف على الأقل' })
  ADMIN_INITIAL_PASSWORD?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  MAX_SESSIONS_PER_USER?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  RISK_AUTO_RECALCULATE_ENABLED?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  RISK_RECALCULATE_HOUR?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, {
    ...config,
    JWT_ACCESS_TTL: Number(config.JWT_ACCESS_TTL ?? 900),
    JWT_REFRESH_TTL: Number(config.JWT_REFRESH_TTL ?? 604800),
    MAX_SESSIONS_PER_USER: Number(config.MAX_SESSIONS_PER_USER ?? 5),
    RISK_AUTO_RECALCULATE_ENABLED: String(config.RISK_AUTO_RECALCULATE_ENABLED ?? 'true'),
    RISK_RECALCULATE_HOUR: Number(config.RISK_RECALCULATE_HOUR ?? 2),
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`متغيرات بيئة ناقصة أو غير صالحة: ${names}`);
  }
  return validated;
}
