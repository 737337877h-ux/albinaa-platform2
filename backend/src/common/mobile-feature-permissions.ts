export function hasMobileFeature(
  permissions: readonly string[],
  mobileCode: string,
  legacyCode?: string,
): boolean {
  const mobilePermissionsConfigured = permissions.some((code) => code.startsWith('mobile.'));
  if (mobilePermissionsConfigured) return permissions.includes(mobileCode);
  return legacyCode ? permissions.includes(legacyCode) : true;
}
