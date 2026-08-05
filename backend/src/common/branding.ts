import { BadRequestException } from '@nestjs/common';

export const BRANDING_KEYS = [
  'branding.name',
  'branding.subtitle',
  'branding.address',
  'branding.phone',
  'branding.statementTitle',
  'branding.statementFooter',
  'branding.logoDataUrl',
] as const;

export type BrandingKey = typeof BRANDING_KEYS[number];

export interface BrandingSettings {
  name: string;
  subtitle: string;
  address: string;
  phone: string;
  statementTitle: string;
  statementFooter: string;
  logoDataUrl: string | null;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  name: 'البناء الراقي',
  subtitle: 'المديونية والتحصيل',
  address: 'صنعاء - الجمهورية اليمنية',
  phone: '',
  statementTitle: 'كشف حساب',
  statementFooter: 'يعتبر هذا الكشف صحيحًا ما لم يصلنا اعتراض خطي خلال خمسة عشر يومًا من تاريخه، مع الشكر.',
  logoDataUrl: null,
};

export function resolveBranding(
  organizationName: string,
  settings: { key: string; value: unknown }[] = [],
): BrandingSettings {
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  const read = (key: BrandingKey, fallback: string) => {
    const value = values.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  };
  const logo = values.get('branding.logoDataUrl');
  return {
    name: read('branding.name', organizationName || DEFAULT_BRANDING.name),
    subtitle: read('branding.subtitle', DEFAULT_BRANDING.subtitle),
    address: read('branding.address', DEFAULT_BRANDING.address),
    phone: read('branding.phone', DEFAULT_BRANDING.phone),
    statementTitle: read('branding.statementTitle', DEFAULT_BRANDING.statementTitle),
    statementFooter: read('branding.statementFooter', DEFAULT_BRANDING.statementFooter),
    logoDataUrl: typeof logo === 'string' && logo.trim() ? logo : null,
  };
}

export function validateBrandingSetting(key: string, value: unknown) {
  if (!BRANDING_KEYS.includes(key as BrandingKey)) return;
  if (typeof value !== 'string') throw new BadRequestException('قيمة إعداد الهوية يجب أن تكون نصًا');
  if (key !== 'branding.logoDataUrl') {
    if (value.length > 500) throw new BadRequestException('قيمة إعداد الهوية أطول من الحد المسموح');
    return;
  }
  if (!value) return;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new BadRequestException('الشعار يجب أن يكون صورة PNG أو JPEG صالحة');
  if (Buffer.byteLength(match[2], 'base64') > 512 * 1024) {
    throw new BadRequestException('حجم الشعار يجب ألا يتجاوز 512 كيلوبايت');
  }
}

export function brandingLogoBuffer(dataUrl: string | null): Buffer | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return match ? Buffer.from(match[1], 'base64') : null;
}
