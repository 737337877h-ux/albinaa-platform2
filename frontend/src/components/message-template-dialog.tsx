'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, MessageSquare, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { registerContactAttempt } from '@/lib/contact-attempt';
import { contactLinks, uniqueContactNumbers } from '@/lib/contact';
import { DEFAULT_MESSAGE_TEMPLATES, formatDebtBalances, MessageChannel, parseMessageTemplates, renderMessageTemplate, significantDebtBalances } from '@/lib/messaging';
import { Dialog } from '@/components/ui/dialog';
import { Button, Field, Select, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { StatementReminderAttachment } from '@/components/statement-reminder-attachment';

interface SettingItem { key: string; value: unknown }

export function MessageTemplateDialog({
  open, onClose, initialChannel, customerId, customerName, customerCode, phone, phoneSecondary, whatsapp, balance, currency,
  debtAgeDays, collectorName, reservationNumber, dueDate,
  balances, groupBalances, childBalances,
}: {
  open: boolean; onClose: () => void; initialChannel: Exclude<MessageChannel, 'both'>;
  customerId: string;
  customerName: string; customerCode?: string | null; phone?: string | null; phoneSecondary?: string | null; whatsapp?: string | null;
  balance?: number | null; currency?: string | null; debtAgeDays?: number | null;
  collectorName?: string | null; reservationNumber?: string | null; dueDate?: string | null;
  balances?: { currency: string; balance: number }[];
  groupBalances?: { currency: string; balance: number }[];
  childBalances?: { currency: string; balance: number }[];
}) {
  const qc = useQueryClient();
  const settings = useQuery<SettingItem[]>({
    queryKey: ['settings'], queryFn: () => api<SettingItem[]>('/settings'), enabled: open,
  });
  const templates = useMemo(() => {
    const stored = settings.data?.find((s) => s.key === 'communication.templates')?.value;
    return parseMessageTemplates(stored).filter((t) => t.active);
  }, [settings.data]);
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>(initialChannel);
  const [templateId, setTemplateId] = useState(DEFAULT_MESSAGE_TEMPLATES[0].id);
  const [message, setMessage] = useState('');
  const [selectedPhone, setSelectedPhone] = useState('');
  const [opening, setOpening] = useState(false);
  const available = templates.filter((t) => t.channel === 'both' || t.channel === channel);
  const windowsSetting = settings.data?.find((s) => s.key === 'messaging.whatsappWindows.enabled')?.value;
  const phoneLinkSetting = settings.data?.find((s) => s.key === 'messaging.phoneLink.enabled')?.value;
  const useWindowsWhatsApp = windowsSetting === undefined
    || windowsSetting === true
    || String(windowsSetting).toLowerCase() === 'true';
  const useWindowsPhoneLink = phoneLinkSetting === undefined
    || phoneLinkSetting === true
    || String(phoneLinkSetting).toLowerCase() === 'true';
  const contactNumbers = useMemo(() => uniqueContactNumbers(channel === 'whatsapp'
    ? [
        { label: 'رقم واتساب', value: whatsapp },
        { label: 'الهاتف الأساسي', value: phone },
        { label: 'الهاتف الآخر', value: phoneSecondary },
      ]
    : [
        { label: 'الهاتف الأساسي', value: phone },
        { label: 'الهاتف الآخر', value: phoneSecondary },
        { label: 'رقم واتساب', value: whatsapp },
      ]), [channel, phone, phoneSecondary, whatsapp]);

  useEffect(() => { if (open) setChannel(initialChannel); }, [open, initialChannel]);
  useEffect(() => {
    if (!contactNumbers.some((item) => item.value === selectedPhone)) {
      setSelectedPhone(contactNumbers[0]?.value ?? '');
    }
  }, [contactNumbers, selectedPhone]);
  useEffect(() => {
    const selected = available.find((t) => t.id === templateId) ?? available[0];
    if (!selected) return;
    if (selected.id !== templateId) setTemplateId(selected.id);
    const positiveGroup = significantDebtBalances(groupBalances ?? []);
    const positiveDirect = significantDebtBalances(balances ?? []);
    const positiveChildren = significantDebtBalances(childBalances ?? []);
    const accountBalances = positiveGroup.length > 0 ? positiveGroup : positiveDirect;
    const allCurrencies = formatDebtBalances(accountBalances);
    const rendered = renderMessageTemplate(selected.body, {
      customerName, customerCode, balance: allCurrencies || balance, currency: allCurrencies ? '' : currency, debtAgeDays, companyName: 'البناء الراقي',
      collectorName, reservationNumber, dueDate,
    });
    setMessage(positiveChildren.length > 0
      ? `${rendered}\n\nمنها أرصدة الحسابات الفرعية: ${formatDebtBalances(positiveChildren)}.`
      : rendered);
  }, [templateId, channel, open, settings.data, balances, groupBalances, childBalances]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const links = contactLinks(selectedPhone, message);
    const url = channel === 'whatsapp'
      ? (useWindowsWhatsApp ? links?.whatsappWindows : links?.whatsapp)
      : (useWindowsPhoneLink ? links?.smsWindows : links?.sms);
    if (!url) return;
    setOpening(true);
    try {
      if (channel === 'sms' && useWindowsPhoneLink) {
        await navigator.clipboard.writeText(message.trim());
      }
      // Start the request, then launch while this call is still inside the
      // user's click gesture. Waiting first makes browsers block app protocols.
      const recordContact = registerContactAttempt(customerId, channel);
      window.location.assign(url);
      await recordContact;
      await qc.invalidateQueries({ queryKey: ['followups', customerId] });
      toast(channel === 'sms' && useWindowsPhoneLink
        ? 'تم نسخ الرسالة دون تشويه؛ الصقها في Phone Link ثم أرسلها'
        : 'تم فتح تطبيق الإرسال؛ سجّل النتيجة خلال 10 دقائق لتجنب المتابعة التلقائية', 'ok');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذر تسجيل التواصل', 'err');
    } finally {
      setOpening(false);
    }
  };

  const hasTarget = !!contactLinks(selectedPhone);
  return (
    <Dialog open={open} onClose={onClose} title="إرسال رسالة للعميل">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-concrete-50 p-1 dark:bg-iron-900">
          <Button type="button" variant={channel === 'whatsapp' ? 'success' : 'ghost'} onClick={() => setChannel('whatsapp')}>
            <MessageCircle className="h-4 w-4" /> واتساب
          </Button>
          <Button type="button" variant={channel === 'sms' ? 'primary' : 'ghost'} onClick={() => setChannel('sms')}>
            <MessageSquare className="h-4 w-4" /> رسالة نصية
          </Button>
        </div>
        <Field label="قالب الرسالة">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="رقم المستلم" hint="يمكن استخدام أي رقم هاتف مسجل في بيان العميل.">
          <Select value={selectedPhone} onChange={(e) => setSelectedPhone(e.target.value)}>
            {contactNumbers.map((item) => (
              <option key={item.normalized} value={item.value}>{item.label} — {item.value}</option>
            ))}
          </Select>
        </Field>
        <Field label="نص الرسالة" hint="يمكن تعديل النص قبل فتح تطبيق الإرسال.">
          <Textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {templateId === 'account-statement' && <StatementReminderAttachment key={customerId} customerId={customerId} message={message} phone={selectedPhone} windowsWhatsApp={useWindowsWhatsApp} />}
        {channel === 'whatsapp' && (
          <p className="text-xs text-concrete-500">
            {useWindowsWhatsApp
              ? 'سيُفتح تطبيق WhatsApp المثبّت على Windows، وستبقى أنت المسؤول عن الضغط على إرسال.'
              : 'سيُفتح WhatsApp عبر الويب. يمكن تفعيل تطبيق Windows من الإعدادات.'}
          </p>
        )}
        {channel === 'sms' && useWindowsPhoneLink && (
          <p className="text-xs text-concrete-500">
            سيُنسخ النص العربي كما هو وتُفتح محادثة الرقم في Phone Link؛ الصق الرسالة ثم اضغط إرسال.
          </p>
        )}
        {!hasTarget && <p className="text-sm text-debt-600">لا يوجد رقم صالح لهذا العميل.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="button" variant={channel === 'whatsapp' ? 'success' : 'primary'} disabled={!hasTarget || !message.trim()} loading={opening} onClick={send}>
            <Send className="h-4 w-4" /> فتح تطبيق الإرسال
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
