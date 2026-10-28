export type OracleAccountLink = {
  accountCode: string;
  accountName: string;
  accountGroupNameAr?: string | null;
  analyticalAccountCode: string;
  analyticalAccountName: string;
  analyticalType: number;
  currencyCodes: string[];
};

export type OracleCollector = {
  code: string;
  nameAr: string;
  commissionPercent: number | null;
};

export type OracleParty = {
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  linkedAccounts: OracleAccountLink[];
  assignedCollector?: OracleCollector | null;
};

export type PartyCategory = 'customers' | 'vendors' | 'employees' | 'debtors' | 'creditors' | 'custodies' | 'bank_accounts' | 'other';

export type OracleRequestCatalog = {
  mode: 'SELECT_ONLY';
  schema: string;
  purpose: 'receipt' | 'payment';
  currencyMapping: { complete: boolean; missingSources: string[] };
  cashboxes: Array<{ code: string; nameAr: string; accountCode: string | null; currencyCodes: string[] }>;
  banks: Array<{ code: string; nameAr: string; accountCode: string | null; currencyCodes: string[] }>;
  collectors: OracleCollector[];
  parties: Record<PartyCategory, OracleParty[]>;
};

export const partyCategoryLabels: Record<PartyCategory, string> = {
  customers: 'عميل', vendors: 'مورد', employees: 'موظف',
  debtors: 'مدينون', creditors: 'دائنون', custodies: 'عهد',
  bank_accounts: 'حسابات البنوك', other: 'حسابات أخرى',
};

const oracleCurrencyNames: Record<string, string> = {
  YR: 'ريال يمني',
  YER: 'ريال يمني',
  SR: 'ريال سعودي',
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  $: 'دولار أمريكي',
};

export function oracleCurrencyLabel(code: string, nameAr?: string | null) {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedName = oracleCurrencyNames[normalizedCode] ?? nameAr?.trim() ?? normalizedCode;
  return `${normalizedName} (${code.trim()})`;
}

function normalizedSearch(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase('ar');
}

export function filterParties(parties: OracleParty[], search: string) {
  const needle = normalizedSearch(search);
  if (!needle) return parties;
  return parties.filter((party) => normalizedSearch(
    `${party.code} ${party.nameAr} ${party.nameEn ?? ''} ${party.phone ?? ''}`,
  ).includes(needle));
}

export function accountLinkKey(link: OracleAccountLink) {
  return `${link.accountCode}|${link.analyticalAccountCode}|${link.analyticalType}`;
}

export function resolvePartyLink(party: OracleParty | undefined, selectedKey: string) {
  if (!party) return undefined;
  if (selectedKey) return party.linkedAccounts.find((link) => accountLinkKey(link) === selectedKey);
  return party.linkedAccounts.length === 1 ? party.linkedAccounts[0] : undefined;
}

export function allowedPartyCurrencies(party: OracleParty | undefined, selectedKey: string) {
  if (!party) return [];
  const selected = selectedKey
    ? party.linkedAccounts.filter((link) => accountLinkKey(link) === selectedKey)
    : party.linkedAccounts;
  return [...new Set(selected.flatMap((link) => link.currencyCodes ?? []))].sort((left, right) =>
    left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }));
}

export function automaticCollector(parties: Array<OracleParty | undefined>) {
  const assigned = parties.map((party) => party?.assignedCollector).filter((item): item is OracleCollector => Boolean(item));
  if (!assigned.length) return undefined;
  return assigned.every((item) => item.code === assigned[0].code) ? assigned[0] : undefined;
}

export function sumAmounts(lines: Array<{ amount: string | number }>) {
  return lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
}

export type ApprovedOracleReceipt = {
  kind: string;
  requestNo?: string | null;
  requestSerial?: string | null;
  status?: string | null;
  finalReceiptId?: string | null;
  createdAt?: string | null;
  amount?: number | string | null;
  currencyCode?: string | null;
  platformCustomerId?: string | null;
  platformCustomerCode?: string | null;
  recipientName?: string | null;
  collectorId?: string | null;
  collectorName?: string | null;
  attachment?: { id: string; fileName: string; previewPath: string; uploadedAt: string } | null;
};

export function approvedReceiptCollectionRows(
  requests: ApprovedOracleReceipt[],
  existingReferences: Iterable<string> = [],
) {
  const existing = new Set(existingReferences);
  return requests.flatMap((request) => {
    const serial = String(request.requestSerial ?? '').trim();
    const amount = Number(request.amount);
    const currencyCode = String(request.currencyCode ?? '').trim().toUpperCase();
    if (request.kind !== 'receipt' || request.status !== 'approved' || !serial
      || Boolean(request.finalReceiptId?.trim())
      || !Number.isFinite(amount) || amount <= 0 || !currencyCode || existing.has(serial)) return [];
    return [{
      id: `oracle-approved-receipt:${serial}`,
      customerId: request.platformCustomerId ?? null,
      currencyCode,
      amount,
      collectedAt: request.createdAt ?? '',
      status: 'approved',
      receiptNumber: request.requestNo ?? null,
      referenceNumber: serial,
      notes: 'سند قبض Oracle معتمد',
      customer: {
        id: request.platformCustomerId ?? null,
        name: request.recipientName ?? request.platformCustomerCode ?? 'عميل غير محدد',
        externalCustomerCode: request.platformCustomerCode ?? null,
      },
      collector: request.collectorName ? { id: request.collectorId ?? null, user: { fullName: request.collectorName } } : null,
      method: { name: 'سند قبض Oracle' },
      branch: null,
      receiptAttachment: request.attachment ?? null,
      source: 'oracle_approved_receipt' as const,
    }];
  });
}
