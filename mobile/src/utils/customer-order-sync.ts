import { bindCustomerOrderServerId, getMeta } from '../db/database';

const CUSTOMER_ORDER_TIMEOUT_MS = 120_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const customerOrderIdKey = (localId: string) => `customer-order-server:${localId}`;

export async function submitQueuedCustomerOrder(client: any, operationId: string, payload: any) {
  const localId = `local:${operationId}`;
  const existing = await getMeta(customerOrderIdKey(localId));
  if (existing && UUID.test(existing)) return { data: { id: existing } };
  const checked = await client.post('/sales-order-drafts/dry-run', payload, {
    headers: { 'Idempotency-Key': `${operationId}:dry-run` },
    timeout: CUSTOMER_ORDER_TIMEOUT_MS,
  });
  if (checked.data?.valid !== true) {
    const message = (checked.data?.issues || []).map((item: any) => item.message).filter(Boolean).join('، ')
      || 'لم ينجح فحص طلب العميل';
    throw Object.assign(new Error(message), { response: { status: 422, data: { message } } });
  }
  // /offline is a GET snapshot only. Keep the creation key stable across retries.
  const response = await client.post('/sales-order-drafts', payload, {
    headers: { 'Idempotency-Key': operationId },
    timeout: CUSTOMER_ORDER_TIMEOUT_MS,
  });
  if (!UUID.test(String(response.data?.id || ''))) {
    throw new Error('لم يُرجع الخادم رقم طلب صالحًا؛ احتُفظ بالطلب لإعادة المحاولة دون تكراره');
  }
  await bindCustomerOrderServerId(localId, response.data);
  return response;
}

export async function submitQueuedOracleCustomerOrder(client:any,operationId:string,payload:any){
  const {__oracleScope,...input}=payload;
  const capability=(await client.get('/customer-orders/capabilities')).data;
  if(!__oracleScope||capability?.draftScope!==__oracleScope){
    throw Object.assign(new Error('طلب العملاء يخص حساب دخول آخر'),{response:{status:422,data:{message:'طلب العملاء يخص حساب دخول آخر'}}});
  }
  if(!capability.createEnabled)throw new Error('حفظ طلبات Oracle غير متاح حاليًا؛ سيعاد المحاولة');
  // The create endpoint deduplicates before checking current credit/stock. A
  // separate dry run here could prevent recovery after a successful lost reply.
  try{
    const response=await client.post('/customer-orders',{...input,externalReference:operationId},{timeout:CUSTOMER_ORDER_TIMEOUT_MS});
    if(!UUID.test(String(response.data?.id||''))||response.data?.sourceSchema!=='IAS20261')throw new Error('تعذر تأكيد الطلب؛ احتُفظ بمرجعه لإعادة المحاولة');
    await bindCustomerOrderServerId(`local:${operationId}`,response.data);
    return response;
  }catch(error:any){if(error?.response?.status===409)error.response.status=503;throw error;}
}

export async function resolveCustomerOrderEndpoint(endpoint: string): Promise<string> {
  const match = /^\/sales-order-drafts\/(local:[^/]+)(\/process)?$/.exec(endpoint);
  if (!match) return endpoint;
  const serverId = await getMeta(customerOrderIdKey(match[1]));
  if (!serverId || !UUID.test(serverId)) {
    // No HTTP response: both queue processors defer this dependent mutation.
    throw new Error('بانتظار إرسال طلب العميل الأصلي وربطه برقم المنصة؛ لم تُرسل المعالجة بعد');
  }
  return `/sales-order-drafts/${serverId}${match[2] || ''}`;
}
