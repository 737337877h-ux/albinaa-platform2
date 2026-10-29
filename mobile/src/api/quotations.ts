import { getClient } from './client';
import { getReferenceOptions, mergeReferenceOptions, replaceReferenceOptions } from '../db/database';

export async function collectQuotationPages(client: any): Promise<any[]> {
  const rows = new Map<string, any>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const { data } = await client.get('/quotations', { params: cursor ? { afterSerial: cursor } : {} });
    if (!Array.isArray(data?.items)) throw new Error('استجابة عروض الأسعار غير مكتملة');
    for (const row of data.items) {
      if (!row.SERIAL) throw new Error('عرض سعر بلا معرف');
      rows.set(String(row.SERIAL), { ...row, id: String(row.SERIAL), name: String(row.DOCUMENT_NO) });
    }
    cursor = data.nextAfterSerial ? String(data.nextAfterSerial) : undefined;
    if (cursor && seen.has(cursor)) throw new Error('تكرر مؤشر صفحات عروض الأسعار');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...rows.values()];
}

export async function fetchQuotationsOfflineSnapshot() {
  const rows = await collectQuotationPages(await getClient());
  const cachedAt = new Date().toISOString();
  await replaceReferenceOptions('quotations', rows.map(row => ({ ...row, cachedAt })));
  return rows;
}

export async function fetchQuotationDetail(serial: string) {
  try {
    const { data } = await (await getClient()).get(`/quotations/${encodeURIComponent(serial)}`);
    if (!Array.isArray(data?.lines)) throw new Error('تفاصيل عرض السعر غير مكتملة');
    const result = { ...data, id: serial, cachedAt: new Date().toISOString() };
    await mergeReferenceOptions('quotationDetails', [result]);
    return { ...result, offline: false };
  } catch (error: any) {
    if (error?.response && error.response.status < 500) throw error;
    const cached = (await getReferenceOptions('quotationDetails')).find(row => row.id === serial);
    if (!cached) throw new Error('تفاصيل هذا العرض غير محفوظة على الهاتف. اتصل بالشبكة لفتحها أول مرة.', { cause: error });
    return { ...cached, offline: true };
  }
}

export async function dryRunQuotation(payload: unknown) {
  return (await getClient()).post('/quotations/dry-run', payload, { timeout: 120000 });
}
