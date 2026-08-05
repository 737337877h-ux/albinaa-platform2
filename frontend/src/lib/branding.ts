export interface OrganizationBrandSource {
  name?: string;
  systemSettings?: { key: string; value: unknown }[];
}

export interface Branding {
  name: string;
  subtitle: string;
  address: string;
  phone: string;
  statementTitle: string;
  statementFooter: string;
  logoDataUrl: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  name: 'البناء الراقي',
  subtitle: 'المديونية والتحصيل',
  address: 'صنعاء - الجمهورية اليمنية',
  phone: '',
  statementTitle: 'كشف حساب',
  statementFooter: 'يعتبر هذا الكشف صحيحًا ما لم يصلنا اعتراض خطي خلال خمسة عشر يومًا من تاريخه، مع الشكر.',
  logoDataUrl: null,
};

export function brandingFromOrganization(source?: OrganizationBrandSource | null): Branding {
  const settings = new Map(source?.systemSettings?.map((item) => [item.key, item.value]) ?? []);
  const read = (key: string, fallback: string) => {
    const value = settings.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  };
  const logo = settings.get('branding.logoDataUrl');
  return {
    name: read('branding.name', source?.name || DEFAULT_BRANDING.name),
    subtitle: read('branding.subtitle', DEFAULT_BRANDING.subtitle),
    address: read('branding.address', DEFAULT_BRANDING.address),
    phone: read('branding.phone', DEFAULT_BRANDING.phone),
    statementTitle: read('branding.statementTitle', DEFAULT_BRANDING.statementTitle),
    statementFooter: read('branding.statementFooter', DEFAULT_BRANDING.statementFooter),
    logoDataUrl: typeof logo === 'string' && logo.startsWith('data:image/') ? logo : null,
  };
}
