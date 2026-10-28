export interface VoucherPartyRecord {
  code?: unknown;
  nameAr?: unknown;
  linkedAccounts?: unknown[];
  [key: string]: unknown;
}

export interface ResolvedVoucherParty {
  category: string;
  party: VoucherPartyRecord;
}

const normalizeText = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('ar');

/**
 * Platform advance accounts use ADV-<analytical code>, while the Oracle catalog
 * exposes the same analytical code under the debtors category without the prefix.
 */
export function resolveVoucherPresetParty(
  groups: Record<string, unknown> | undefined,
  presetCode: unknown,
  presetName?: unknown,
): ResolvedVoucherParty | undefined {
  const rawCode = String(presetCode ?? '').trim();
  if (!rawCode || !groups) return undefined;

  const isAdvance = /^ADV-/i.test(rawCode);
  const oracleCode = isAdvance ? rawCode.replace(/^ADV-/i, '') : rawCode;
  const preferredCategories = isAdvance
    ? ['debtors', 'custodies', 'employees', 'other', 'customers', 'vendors', 'creditors', 'bank_accounts']
    : ['customers', 'vendors', 'employees', 'debtors', 'creditors', 'custodies', 'bank_accounts', 'other'];
  const categoryOrder = [
    ...preferredCategories,
    ...Object.keys(groups).filter((category) => !preferredCategories.includes(category)),
  ];

  const candidates = categoryOrder.flatMap((category) => {
    const rows = Array.isArray(groups[category]) ? groups[category] as VoucherPartyRecord[] : [];
    return rows
      .filter((party) => [rawCode, oracleCode].includes(String(party.code ?? '').trim()))
      .map((party) => ({ category, party }));
  });
  if (!candidates.length) return undefined;

  const normalizedName = normalizeText(presetName);
  if (normalizedName) {
    const named = candidates.find(({ party }) => normalizeText(party.nameAr) === normalizedName);
    if (named) return named;
  }
  return candidates[0];
}
