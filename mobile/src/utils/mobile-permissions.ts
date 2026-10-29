export function canUseMobileFeature(
  permissions: readonly string[] | null | undefined,
  mobileCode: string,
  legacyCode?: string,
): boolean {
  const values = permissions ?? [];
  const configured = values.some((code) => code.startsWith('mobile.'));
  if (configured) return values.includes(mobileCode);
  return legacyCode ? values.includes(legacyCode) : true;
}
