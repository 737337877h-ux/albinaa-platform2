import { mergeReferenceOptions } from '../db/database';

export function newQuotationReference(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 3) | 8).toString(16);
  });
}

export async function submitQueuedQuotation(client: any, payload: any) {
  // The save endpoint validates in Oracle and deduplicates before allocating numbers.
  // Do not regenerate externalReference on retries or after a lost response.
  if (!/^[a-f0-9-]{36}$/i.test(payload?.externalReference || '')) {
    const error: any = new Error('معرف عرض السعر غير صالح');
    error.response = { status: 422, data: { message: error.message } }; throw error;
  }
  try {
    const response = await client.post('/quotations', payload, { timeout: 120000 });
    if (!response.data?.serial || !response.data?.number) throw new Error('لم يصل تأكيد حفظ عرض السعر؛ ستعاد المحاولة بنفس المعرف');
    await mergeReferenceOptions('quotationReceipts', [{
      id: payload.externalReference, ...response.data, savedAt: new Date().toISOString(),
    }]);
    return response;
  }
  catch (error: any) {
    // A short Oracle numbering lock is temporary, not a rejected draft.
    if (error?.response?.status === 409) error.response.status = 503;
    throw error;
  }
}
