/** Normalize common Yemeni local formats into international digits. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 9) digits = `967${digits}`;

  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function contactLinks(phone?: string | null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  return {
    tel: `tel:+${normalized}`,
    sms: `sms:+${normalized}`,
    whatsapp: `https://wa.me/${normalized}`,
  };
}
