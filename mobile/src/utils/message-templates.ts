import * as SecureStore from 'expo-secure-store';

export type MessageChannel = 'whatsapp' | 'sms' | 'both';
export interface MessageTemplate { id: string; name: string; channel: MessageChannel; body: string; active: boolean }

const KEY = 'albinaa.mobile_message_templates';
export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplate[] = [
  { id: 'friendly-reminder', name: 'تذكير ودي بالسداد', channel: 'both', active: true, body: 'مرحبًا {customerName}، نذكّركم بأن الرصيد المستحق هو {balance} {currency}. نرجو التكرم بالسداد أو التواصل معنا لتنسيق الموعد. شكرًا لتعاونكم — البناء الراقي' },
  { id: 'account-statement', name: 'تنبيه بكشف الحساب', channel: 'whatsapp', active: true, body: 'الأخ/الأخت {customerName}، نلفت عنايتكم إلى حسابكم رقم {customerCode}. الرصيد الحالي {balance} {currency}. يرجى مراجعة الحساب والتواصل معنا عند وجود أي ملاحظة.' },
  { id: 'promise-reminder', name: 'تذكير بموعد الوعد', channel: 'both', active: true, body: 'مرحبًا {customerName}، نذكّركم بموعد السداد المتفق عليه. الرصيد الحالي {balance} {currency}. شاكرين تعاونكم.' },
  { id: 'final-warning', name: 'تنبيه نهائي', channel: 'both', active: true, body: 'الأخ/الأخت {customerName}، هذا تنبيه نهائي بشأن الرصيد المتأخر {balance} {currency}. نرجو التواصل مع فريق التحصيل لتجنب التصعيد.' },
];

export async function loadMessageTemplates(): Promise<MessageTemplate[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return DEFAULT_MESSAGE_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_MESSAGE_TEMPLATES;
  } catch { return DEFAULT_MESSAGE_TEMPLATES; }
}

export async function saveMessageTemplates(templates: MessageTemplate[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(templates));
}

export function renderMessageTemplate(body: string, values: Record<string, string | number>): string {
  return body.replace(/\{([^{}]+)\}/g, (token, key: string) => key in values ? String(values[key]) : token);
}
