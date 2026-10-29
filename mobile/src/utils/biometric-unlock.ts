import * as LocalAuthentication from 'expo-local-authentication';
export async function verifyBiometric(enabled: boolean): Promise<boolean> {
  if (!enabled) return false;
  if (!await LocalAuthentication.hasHardwareAsync() || !await LocalAuthentication.isEnrolledAsync()) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'تأكيد هويتك لفتح تطبيق الراقي', cancelLabel: 'إلغاء',
    disableDeviceFallback: true, biometricsSecurityLevel: 'strong',
  });
  return result.success === true;
}
