import { BadRequestException } from '@nestjs/common';
import { brandingLogoBuffer, resolveBranding, validateBrandingSetting } from './branding';

describe('branding settings', () => {
  it('uses organization defaults and applies saved overrides', () => {
    expect(resolveBranding('شركة الاختبار', [
      { key: 'branding.subtitle', value: 'إدارة التحصيل' },
    ])).toMatchObject({ name: 'شركة الاختبار', subtitle: 'إدارة التحصيل' });
  });

  it('accepts small PNG data URLs and rejects unsupported logo formats', () => {
    const png = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
    expect(() => validateBrandingSetting('branding.logoDataUrl', png)).not.toThrow();
    expect(brandingLogoBuffer(png)?.toString()).toBe('png');
    expect(() => validateBrandingSetting('branding.logoDataUrl', 'data:image/svg+xml;base64,PHN2Zz4='))
      .toThrow(BadRequestException);
  });
});
