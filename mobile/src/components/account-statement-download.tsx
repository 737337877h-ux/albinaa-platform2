import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, NativeModules, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { getClient } from '../api/client';
import { getBaseUrl } from '../config/api';
import { getAccessToken } from '../utils/secure-storage';
import { parseFlexibleDate } from '../utils/date-input';
import { statementCaption } from '../utils/statement-caption';
import { contactLinks, uniqueContactNumbers } from '../utils/contact';

/** Only mount when both customer and balance access are granted. Server rechecks scope. */
export default function AccountStatementDownload({ customerId, customerName, customerCode, phones = [], openRequest = 0 }: { customerId: string; customerName: string; customerCode?: string; phones?: Array<string | null | undefined>; reminder?: string; openRequest?: number }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(`01/01/${new Date().getFullYear()}`);
  const [to, setTo] = useState(new Date().toLocaleDateString('en-GB'));
  const [currency, setCurrency] = useState('YER');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const defaultMessage = statementCaption(customerName, customerCode, parseFlexibleDate(from)?.display || from, parseFlexibleDate(to)?.display || to, currency);
  const [message, setMessage] = useState(defaultMessage);
  React.useEffect(() => { setMessage(defaultMessage); }, [defaultMessage, openRequest]);
  React.useEffect(() => { if (openRequest) setOpen(true); }, [openRequest]);
  const openCustomerChat = () => {
    const numbers = uniqueContactNumbers(phones);
    const openNumber = (number: string) => {
      const link = contactLinks(number, message);
      if (link) void Linking.openURL(link.whatsapp).catch(() => Alert.alert('تعذر فتح واتساب', 'تحقق من تثبيت واتساب وصحة رقم العميل.'));
    };
    if (!numbers.length) { Alert.alert('رقم العميل غير متاح', 'أضف رقم واتساب أو الهاتف إلى بيانات العميل أولًا.'); return; }
    if (numbers.length === 1) { openNumber(numbers[0]); return; }
    Alert.alert('اختر رقم العميل', `${customerName} — للرجوع اضغط خارج النافذة`, numbers.map(number => ({ text: number, onPress: () => openNumber(number) })), { cancelable: true });
  };
  const saveForAttachment = async () => {
    if (!saved || busy) return;
    setBusy(true);
    try {
      const directory = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!directory.granted) return;
      const destination = await FileSystem.StorageAccessFramework.createFileAsync(directory.directoryUri, `statement-${customerCode || customerId}-${currency}-${Date.now()}.pdf`, 'application/pdf');
      const data = await FileSystem.readAsStringAsync(saved, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.writeAsStringAsync(destination, data, { encoding: FileSystem.EncodingType.Base64 });
      Alert.alert('تم حفظ الكشف', 'افتح محادثة العميل ثم اختر المرفقات > مستند وحدد الكشف من المجلد الذي اخترته.');
    } catch { Alert.alert('تعذر حفظ الملف', 'أعد اختيار مجلد يسمح بحفظ الملفات.'); }
    finally { setBusy(false); }
  };
  const sharePdf = async () => {
    if (!saved || busy) return;
    try {
      if (!NativeModules.StatementShare?.share) throw new Error('حدّث التطبيق لتفعيل مشاركة النص والملف معًا');
      const contentUri = await FileSystem.getContentUriAsync(saved);
      await NativeModules.StatementShare.share(contentUri, message);
    } catch (error: any) { Alert.alert('تعذر فتح المشاركة', error?.message || 'حاول مجددًا'); }
  };
  const button = { backgroundColor: '#087d6b', padding: 14, borderRadius: 10, marginTop: 10 };
  const label = { color: '#fff', textAlign: 'center' as const };
  const input = { borderWidth: 1, borderColor: '#aeb9b6', borderRadius: 8, padding: 12, color: '#172b28', marginVertical: 8 };

  const viewPdf = async (uri: string) => {
    if (Platform.OS !== 'android') throw new Error('فتح PDF متاح حاليًا على Android');
    const contentUri = await FileSystem.getContentUriAsync(uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, type: 'application/pdf', flags: 1 });
  };
  const download = async () => {
    if (busy) return;
    const start = parseFlexibleDate(from)?.iso;
    const end = parseFlexibleDate(to)?.iso;
    if (!start || !end || start > end || start < '2020-01-01' || end > '2026-12-31') {
      Alert.alert('الفترة غير صحيحة', 'حدد فترة من 2020 إلى 2026. مثال: 01/01/2025'); return;
    }
    setBusy(true); setProgress(null); setSaved(null);
    let target: string | undefined;
    try {
      // Refresh expired credentials through the existing authenticated client before the download.
      const client = await getClient();
      await client.get('/auth/me', { timeout: 15000 });
      const base = (await getBaseUrl()).replace(/\/+$/, '');
      const token = await getAccessToken();
      if (!token) throw new Error('يرجى تسجيل الدخول مجددًا');
      target = `${FileSystem.cacheDirectory}statement-${customerId}-${Date.now()}.pdf`;
      const params = `source=oracle_archive&template=branded&currency=${currency}&fromDate=${start}&toDate=${end}`;
      const job = FileSystem.createDownloadResumable(`${base}/customers/${customerId}/statement.pdf?${params}`, target,
        { headers: { Authorization: `Bearer ${token}` } },
        p => setProgress(p.totalBytesExpectedToWrite > 0 ? Math.min(100, Math.round(100 * p.totalBytesWritten / p.totalBytesExpectedToWrite)) : null));
      const timer = setTimeout(() => { void job.cancelAsync(); }, 75000);
      let result;
      try { result = await job.downloadAsync(); } finally { clearTimeout(timer); }
      if (!result) throw new Error('لم يكتمل التنزيل؛ أعد المحاولة بعد التحقق من الاتصال');
      if (result.status !== 200) {
        let message = 'تعذر إصدار الكشف. تحقق من الاتصال والصلاحية والفترة.';
        try {
          const body = JSON.parse(await FileSystem.readAsStringAsync(target));
          if (typeof body.message === 'string') message = body.message;
        } catch { /* Non-JSON proxy errors use the safe message above. */ }
        throw new Error(message);
      }
      const signature = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 5 });
      if (signature !== 'JVBERi0=') throw new Error('الملف المستلم ليس PDF صالحًا');
      setSaved(result.uri); setProgress(100);
      try { await viewPdf(result.uri); } catch { Alert.alert('تم التنزيل', 'تعذر فتح عارض PDF. ثبّت عارض PDF ثم اضغط فتح الكشف.'); }
    } catch (error: any) {
      if (target) await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      Alert.alert('تعذر تنزيل الكشف', error?.message || 'تحقق من الشبكة المحلية أو Tailscale ثم أعد المحاولة');
    } finally { setBusy(false); }
  };
  return <>
    <TouchableOpacity style={button} onPress={() => setOpen(true)}><Text style={label}>تنزيل كشف حساب PDF</Text></TouchableOpacity>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => { if (!busy) setOpen(false); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 18 }}>
        <ScrollView style={{ flexGrow: 0, backgroundColor: 'white', borderRadius: 16 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 20, textAlign: 'right', color: '#172b28' }}>كشف الحساب</Text>
          <Text style={{ textAlign: 'right', marginVertical: 12, color: '#506661' }}>صادر من المنصة ببيانات Oracle. يحتاج اتصالًا؛ الأرشيف المتاح 2020-2026. ليس تقرير أونكس الرسمي.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>{[['YER','ريال يمني'],['SAR','ريال سعودي'],['USD','دولار']].map(([code,name]) =>
            <TouchableOpacity disabled={busy} key={code} style={{ flex: 1, padding: 10, backgroundColor: currency === code ? '#087d6b' : '#e1ebe8', borderRadius: 8 }} onPress={() => { setCurrency(code); setSaved(null); }}>
              <Text style={{ textAlign: 'center', color: currency === code ? 'white' : '#172b28' }}>{name}</Text>
            </TouchableOpacity>)}</View>
          <Text style={{ textAlign: 'right', marginTop: 12 }}>من تاريخ (يوم/شهر/سنة)</Text>
          <TextInput editable={!busy} value={from} onChangeText={v => { setFrom(v); setSaved(null); }} onBlur={() => { const date = parseFlexibleDate(from); if (date) setFrom(date.display); }} style={input} placeholder="01/01/2025 أو 010125" keyboardType="numbers-and-punctuation" />
          <Text style={{ textAlign: 'right' }}>إلى تاريخ (يوم/شهر/سنة)</Text>
          <TextInput editable={!busy} value={to} onChangeText={v => { setTo(v); setSaved(null); }} onBlur={() => { const date = parseFlexibleDate(to); if (date) setTo(date.display); }} style={input} placeholder="06/09/2026 أو 060926" keyboardType="numbers-and-punctuation" />
          <Text style={{ textAlign: 'right', color: '#506661' }}>تاريخ ذكي: 120926 أو 12/9 أو الأرقام العربية. عند ترك الحقل يظهر التاريخ الكامل.</Text>
          <Text style={{ textAlign: 'right', marginTop: 12 }}>نص التنبيه المرفق بالكشف — قابل للتعديل</Text>
          <TextInput multiline editable={!busy} value={message} onChangeText={setMessage} style={[input, { textAlign: 'right', minHeight: 100 }]} />
          <Text style={{ textAlign: 'right', color: '#506661' }}>فتح محادثة العميل يعبّئ النص تلقائيًا دون نسخ أو إرسال. احفظ الكشف وأرفقه من داخل المحادثة. خيار المشاركة العامة بديل منفصل ينسخ النص للحافظة ويطلب اختيار المستلم.</Text>
          {busy && <><ActivityIndicator color="#087d6b" /><Text style={{ textAlign: 'center' }}>{progress == null ? 'جارٍ إعداد الكشف واحتساب الرصيد الافتتاحي…' : `التنزيل ${progress}%`}</Text></>}
          <TouchableOpacity disabled={busy} style={button} onPress={download}><Text style={label}>إعداد وتنزيل PDF</Text></TouchableOpacity>
          {saved && <TouchableOpacity style={button} onPress={() => viewPdf(saved).catch(() => Alert.alert('تنبيه', 'يلزم عارض PDF لفتح الكشف'))}><Text style={label}>فتح الكشف المحفوظ</Text></TouchableOpacity>}
          {saved && <>
            <TouchableOpacity disabled={busy} style={button} onPress={saveForAttachment}><Text style={label}>حفظ PDF لإرفاقه في المحادثة</Text></TouchableOpacity>
            <TouchableOpacity disabled={busy || !message.trim()} style={button} onPress={openCustomerChat}><Text style={label}>فتح محادثة العميل مع رسالة التنبيه</Text></TouchableOpacity>
            <Text style={{ textAlign: 'right', marginTop: 8 }}>تُعبّأ الرسالة تلقائيًا دون إرسال. أرفق الكشف المحفوظ من داخل المحادثة؛ فتح المحادثة لا يرفق PDF تلقائيًا.</Text>
            <TouchableOpacity disabled={busy || !message.trim()} style={button} onPress={sharePdf}><Text style={label}>مشاركة عامة للملف ونسخ النص (اختياري)</Text></TouchableOpacity>
          </>}
          <TouchableOpacity disabled={busy} style={{ padding: 14 }} onPress={() => setOpen(false)}><Text style={{ textAlign: 'center', color: '#172b28' }}>إغلاق</Text></TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
