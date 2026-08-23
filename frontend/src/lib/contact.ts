/** Normalize common Yemeni local formats into international digits. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 9) digits = `967${digits}`;

  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function contactLinks(phone?: string | null, message?: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const encoded = message?.trim() ? encodeURIComponent(message.trim()) : '';

  const sms = `sms:+${normalized}${encoded ? `?body=${encoded}` : ''}`;

  return {
    tel: `tel:+${normalized}`,
    sms,
    // Phone Link can corrupt Arabic text passed in the URI. The Windows flow
    // copies the Unicode message separately and opens only the recipient.
    smsWindows: `sms:+${normalized}`,
    whatsapp: `https://wa.me/${normalized}${encoded ? `?text=${encoded}` : ''}`,
    whatsappWindows: `whatsapp://send?phone=${normalized}${encoded ? `&text=${encoded}` : ''}`,
  };
}

export interface LabeledContactNumber {
  label: string;
  value: string;
  normalized: string;
}

/** Return every valid customer number once, even when stored in multiple fields. */
export function uniqueContactNumbers(
  entries: Array<{ label: string; value?: string | null }>,
): LabeledContactNumber[] {
  const seen = new Set<string>();
  const result: LabeledContactNumber[] = [];
  for (const entry of entries) {
    const normalized = normalizePhone(entry.value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ label: entry.label, value: entry.value!.trim(), normalized });
  }
  return result;
}
