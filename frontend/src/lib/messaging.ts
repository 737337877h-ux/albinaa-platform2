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
    id: 'urgent-collection',
    name: 'متابعة تحصيل عاجلة',
    channel: 'both',
    active: true,
    body: 'مرحبًا {customerName}، مرّ على المديونية {debtAgeDays} يومًا، والرصيد المستحق {balance} {currency}. نأمل الإفادة بموعد السداد اليوم لتجنب تأخر الحساب.',
  },
];

export interface TemplateVariables {
  customerName: string;
  customerCode?: string | null;
  balance?: number | string | null;
  currency?: string | null;
  debtAgeDays?: number | string | null;
  companyName?: string | null;
}

export function renderMessageTemplate(body: string, variables: TemplateVariables): string {
  const values: Record<string, string> = {
    customerName: variables.customerName || 'العميل',
    customerCode: variables.customerCode || '—',
    balance: variables.balance == null ? '—' : Number(variables.balance).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    currency: variables.currency || '',
    debtAgeDays: variables.debtAgeDays == null ? '—' : String(variables.debtAgeDays),
    companyName: variables.companyName || 'البناء الراقي',
  };
  return body.replace(/\{(customerName|customerCode|balance|currency|debtAgeDays|companyName)\}/g, (_, key: string) => values[key]);
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
