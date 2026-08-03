'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, MessageSquare, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { contactLinks } from '@/lib/contact';
import { DEFAULT_MESSAGE_TEMPLATES, MessageChannel, parseMessageTemplates, renderMessageTemplate } from '@/lib/messaging';
import { Dialog } from '@/components/ui/dialog';
import { Button, Field, Select, Textarea } from '@/components/ui/primitives';

interface SettingItem { key: string; value: unknown }

export function MessageTemplateDialog({
  open, onClose, initialChannel, customerName, customerCode, phone, whatsapp, balance, currency, debtAgeDays,
}: {
  open: boolean; onClose: () => void; initialChannel: Exclude<MessageChannel, 'both'>;
  customerName: string; customerCode?: string | null; phone?: string | null; whatsapp?: string | null;
  balance?: number | null; currency?: string | null; debtAgeDays?: number | null;
}) {
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
  const available = templates.filter((t) => t.channel === 'both' || t.channel === channel);

  useEffect(() => { if (open) setChannel(initialChannel); }, [open, initialChannel]);
  useEffect(() => {
    const selected = available.find((t) => t.id === templateId) ?? available[0];
    if (!selected) return;
    if (selected.id !== templateId) setTemplateId(selected.id);
    setMessage(renderMessageTemplate(selected.body, {
      customerName, customerCode, balance, currency, debtAgeDays, companyName: 'البناء الراقي',
    }));
  }, [templateId, channel, open, settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    const target = channel === 'whatsapp' ? (whatsapp ?? phone) : phone;
    const links = contactLinks(target, message);
    const url = channel === 'whatsapp' ? links?.whatsapp : links?.sms;
    if (url) window.open(url, channel === 'whatsapp' ? '_blank' : '_self', 'noopener,noreferrer');
  };

  const hasTarget = !!contactLinks(channel === 'whatsapp' ? (whatsapp ?? phone) : phone);
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
        <Field label="نص الرسالة" hint="يمكن تعديل النص قبل فتح تطبيق الإرسال.">
          <Textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {!hasTarget && <p className="text-sm text-debt-600">لا يوجد رقم صالح لهذا العميل.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="button" variant={channel === 'whatsapp' ? 'success' : 'primary'} disabled={!hasTarget || !message.trim()} onClick={send}>
            <Send className="h-4 w-4" /> فتح تطبيق الإرسال
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
