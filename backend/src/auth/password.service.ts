import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * خدمة كلمات المرور:
 * - الجديد يُشفَّر بـ Argon2id (المعيار الموصى به).
 * - التحقق يدعم أيضًا صيغة scrypt القديمة من Seed المرحلة الأولى
 *   (scrypt$N=...$salt$hash) — وعند نجاح الدخول بها يُعاد التجزئة بـ Argon2
 *   تلقائيًا (ترقية شفافة موثقة).
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  }

  async verify(stored: string, plain: string): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (stored.startsWith('$argon2')) {
      const ok = await argon2.verify(stored, plain).catch(() => false);
      return { ok, needsRehash: false };
    }
    if (stored.startsWith('scrypt$')) {
      // صيغة Seed: scrypt$N=16384,r=8,p=1$<salt_hex>$<hash_hex>
      const [, params, saltHex, hashHex] = stored.split('$');
      const opts: Record<string, number> = {};
      for (const kv of params.split(',')) {
        const [k, v] = kv.split('=');
        opts[k] = Number(v);
      }
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = scryptSync(plain, salt, expected.length, {
        N: opts.N ?? 16384, r: opts.r ?? 8, p: opts.p ?? 1,
      });
      const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
      return { ok, needsRehash: ok }; // ترقية إلى Argon2 عند أول دخول ناجح
    }
    return { ok: false, needsRehash: false };
  }

  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url'); // 64 حرفًا عشوائيًا قويًا
  }
}
