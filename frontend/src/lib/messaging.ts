export type MessageChannel = 'whatsapp' | 'sms' | 'both';

export interface MessageTemplate {
  id: string;
  name: string;
  channel: MessageChannel;
  body: string;
  active: boolean;
}

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'friendly-reminder',
    name: 'تذكير ودي بالسداد',
    channel: 'both',
    active: true,
    body: 'مرحبًا {customerName}، نذكّركم بأن الرصيد المستحق هو {balance} {currency}. نرجو التكرم بالسداد أو التواصل معنا لتنسيق الموعد. شكرًا لتعاونكم — {companyName}',
  },
  {
    id: 'account-statement',
    name: 'إرسال كشف حساب',
    channel: 'whatsapp',
    active: true,
    body: 'الأخ/الأخت {customerName}، نرفق لكم تنبيهًا بخصوص حسابكم رقم {customerCode}. الرصيد الحالي {balance} {currency}. يرجى مراجعة الحساب والتواصل معنا عند وجود أي ملاحظة.',
  },
  {
    id: 'firm-reminder',
    name: 'تذكير حازم بالسداد',
    channel: 'both',
    active: true,
    body: 'الأخ/الأخت {اسم_العميل}، مضى على أقدم مديونية {أقدم_دين_بالأيام} يومًا، وإجمالي الرصيد المستحق {الرصيد} {العملة}. نرجو تحديد موعد السداد اليوم. المحصل: {اسم_المحصل}.',
  },
  {
    id: 'credit-limit-exceeded',
    name: 'تجاوز الحد الائتماني',
    channel: 'both',
    active: true,
    body: 'مرحبًا {اسم_العميل}، نحيطكم بأن رصيد الحساب {الرصيد} {العملة} تجاوز الحد الائتماني المعتمد. يرجى السداد أو التواصل مع {اسم_المحصل} لاستكمال الإجراءات.',
  },
  {
    id: 'reservation-expiry',
    name: 'انتهاء حجز البضاعة',
    channel: 'whatsapp',
    active: true,
    body: 'مرحبًا {اسم_العميل}، نذكّركم بأن الحجز رقم {رقم_الحجز} يستحق في {تاريخ_الاستحقاق}. يرجى التواصل مع {اسم_المحصل} لتأكيد الاستلام أو السداد.',
  },
  {
    id: 'final-warning',
    name: 'إنذار نهائي قبل التصعيد',
    channel: 'both',
    active: true,
    body: 'الأخ/الأخت {اسم_العميل}، هذا إنذار نهائي بشأن الرصيد المتأخر {الرصيد} {العملة} منذ {أقدم_دين_بالأيام} يومًا. نرجو السداد قبل {تاريخ_الاستحقاق} لتجنب التصعيد النظامي.',
  },
];

export interface TemplateVariables {
  customerName: string;
  customerCode?: string | null;
  balance?: number | string | null;
  currency?: string | null;
  debtAgeDays?: number | string | null;
  companyName?: string | null;
  collectorName?: string | null;
  reservationNumber?: string | null;
  dueDate?: string | null;
}

const DEBT_DISPLAY_LIMITS: Record<string, number> = { YER: 3000, SAR: 30, USD: 5 };
const CURRENCY_NAMES: Record<string, string> = {
  YER: 'ريال يمني', SAR: 'ريال سعودي', USD: 'دولار أمريكي',
};

export function significantDebtBalances(items: { currency: string; balance: number }[]) {
  return items.filter((item) => item.balance > (DEBT_DISPLAY_LIMITS[item.currency] ?? 0.00005));
}

export function formatDebtBalances(items: { currency: string; balance: number }[]) {
  return significantDebtBalances(items)
    .map((item) => `${item.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${CURRENCY_NAMES[item.currency] ?? item.currency}`)
    .join(' + ');
}

export function renderMessageTemplate(body: string, variables: TemplateVariables): string {
  const values: Record<string, string> = {
    customerName: variables.customerName || 'العميل',
    customerCode: variables.customerCode || '—',
    balance: variables.balance == null
      ? '—'
      : typeof variables.balance === 'number'
        ? variables.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : variables.balance,
    currency: variables.currency || '',
    debtAgeDays: variables.debtAgeDays == null ? '—' : String(variables.debtAgeDays),
    companyName: variables.companyName || 'البناء الراقي',
    collectorName: variables.collectorName || 'فريق التحصيل',
    reservationNumber: variables.reservationNumber || '—',
    dueDate: variables.dueDate || '—',
  };
  const aliases: Record<string, keyof typeof values> = {
    اسم_العميل: 'customerName', الرصيد: 'balance', العملة: 'currency',
    أقدم_دين_بالأيام: 'debtAgeDays', اسم_المحصل: 'collectorName',
    رقم_الحجز: 'reservationNumber', تاريخ_الاستحقاق: 'dueDate',
  };
  return body.replace(/\{([^{}]+)\}/g, (token, key: string) => {
    const resolved = aliases[key] ?? key;
    return resolved in values ? values[resolved] : token;
  });
}

export function parseMessageTemplates(value: unknown): MessageTemplate[] {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return DEFAULT_MESSAGE_TEMPLATES; }
  }
  if (!Array.isArray(candidate)) return DEFAULT_MESSAGE_TEMPLATES;
  const valid = candidate.filter((item): item is MessageTemplate =>
    !!item && typeof item === 'object' && typeof item.id === 'string' &&
    typeof item.name === 'string' && typeof item.body === 'string' &&
    ['whatsapp', 'sms', 'both'].includes(item.channel) && typeof item.active === 'boolean');
  return valid.length ? valid : DEFAULT_MESSAGE_TEMPLATES;
}
