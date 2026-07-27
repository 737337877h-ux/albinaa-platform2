import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, Min, MinLength, validateSync } from 'class-validator';

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

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET يجب أن يكون 32 حرفًا على الأقل' })
  JWT_REFRESH_SECRET!: string;

  @IsInt()
  @Min(60)
  JWT_ACCESS_TTL!: number;

  @IsInt()
  @Min(3600)
  JWT_REFRESH_TTL!: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, {
    ...config,
    JWT_ACCESS_TTL: Number(config.JWT_ACCESS_TTL ?? 900),
    JWT_REFRESH_TTL: Number(config.JWT_REFRESH_TTL ?? 604800),
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`متغيرات بيئة ناقصة أو غير صالحة: ${names}`);
  }
  return validated;
}
