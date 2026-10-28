import { durableOracleRequest, DurableOracleRequest, mergeOracleRequestRecords, OracleRequestAuditRow, platformCurrencyCode } from './oracle-request-audit';

export type FinalReceipt = {
  id: string; referenceNumber: string; currencyCode: string; amount: number;
  collectedAt: string | Date; customerId: string; externalCustomerCode?: string;
  sourceReferenceNumber?: string | null;
  referenceAliases?: string[];
};
export type ReceiptRequestState = Omit<DurableOracleRequest,'status'> & {
  status: string;
  statusVerified: boolean; statusLabel: string; finalReceiptId: string | null;
  matchedBy: 'serial' | 'transfer_reference' | null;
};
const labels: Record<string,string> = {
  pending_approval: 'بانتظار الاعتماد', approved: 'معتمد — بانتظار ظهور السند النهائي',
  rejected: 'مرفوض', cancelled: 'ملغي', inactive: 'غير فعّال', unknown: 'تعذر التحقق من حالة الطلب',
};
function reference(value: unknown) { return String(value ?? '').trim().replace(/\s+/g,'').toUpperCase(); }
function amountMatches(a: unknown,b: unknown) { return Math.abs(Number(a)-Number(b)) < 0.00005; }
function sameCustomer(r: Pick<DurableOracleRequest,'platformCustomerId'|'platformCustomerCode'>,f: FinalReceipt) {
  if (r.platformCustomerId && f.customerId && r.platformCustomerId !== f.customerId) return false;
  if (r.platformCustomerCode && f.externalCustomerCode && r.platformCustomerCode !== f.externalCustomerCode) return false;
  return !!((r.platformCustomerId && r.platformCustomerId===f.customerId)
    || (r.platformCustomerCode && r.platformCustomerCode===f.externalCustomerCode));
}
function strongSerial(value: string) {
  return /^\d{16,}$/.test(value) || (value.length >= 8 && /[^\d]/.test(value));
}
/** Only financially recorded local rows may replace a request in financial totals. */
export function recordedLocalReceiptFinals(rows: Array<{
  id: string; customerId: string; currencyCode: string; amount: unknown;
  collectedAt: string | Date; status: string; referenceNumber?: string | null; receiptNumber?: string | null;
  customer?: { externalCustomerCode?: string | null } | null;
}>): FinalReceipt[] {
  return rows.flatMap(row => {
    const amount = Number(row.amount);
    if (row.status !== 'recorded' || !Number.isFinite(amount) || amount <= 0) return [];
    return [{ id: row.id, customerId: row.customerId, currencyCode: platformCurrencyCode(row.currencyCode), amount,
      collectedAt: row.collectedAt, referenceNumber: row.referenceNumber?.trim() || row.receiptNumber?.trim() || '',
      referenceAliases: [row.referenceNumber, row.receiptNumber].filter((value): value is string => Boolean(value?.trim())),
      sourceReferenceNumber: row.referenceNumber ?? null, externalCustomerCode: row.customer?.externalCustomerCode ?? undefined }];
  });
}
function orgDay(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
/** Never deduplicate by name/amount or a reused short document number. */
export function reconcileReceiptRequests(
  audits: OracleRequestAuditRow[], finals: FinalReceipt[], liveItems: Record<string,unknown>[] = [],
): ReceiptRequestState[] {
  const liveBySerial = new Map<string, Record<string,unknown>[]>();
  for (const item of liveItems.filter(x=>x.kind==='receipt')) {
    const key=String(item.requestSerial??'').trim(); if(!key)continue;
    liveBySerial.set(key,[...(liveBySerial.get(key)??[]),item]);
  }
  const requests=audits.flatMap(row=>{
    const durable=durableOracleRequest(row); if(durable?.kind!=='receipt')return [];
    const live=liveBySerial.get(durable.requestSerial);
    const liveRow=live?.length===1?live[0]:null;
    const merged=liveRow?mergeOracleRequestRecords(liveRow,durable as unknown as Record<string,unknown>):durable;
    const rawStatus=liveRow && [true,1,'1'].includes(liveRow.inactive as any) ? 'inactive' : String(liveRow?.status??'unknown');
    const verified=!!liveRow && rawStatus!=='unknown' && Object.prototype.hasOwnProperty.call(labels,rawStatus);
    const status=verified?rawStatus:'unknown';
    return [{...durable,...merged,createdAt:durable.createdAt,
      currencyCode:platformCurrencyCode(merged.currencyCode)||durable.currencyCode,
      // Internal state deliberately permits unknown; creation-time pending is not current status.
      status,statusVerified:verified,statusLabel:labels[status]??labels.unknown,
      finalReceiptId:null,matchedBy:null} as unknown as ReceiptRequestState];
  });
  const candidates=new Map<number,Array<{id:string;by:'serial'|'transfer_reference'}>>();
  requests.forEach((r,index)=>{
    const matches:Array<{id:string;by:'serial'|'transfer_reference'}>=finals.flatMap<{id:string;by:'serial'|'transfer_reference'}>(f=>{
      if(platformCurrencyCode(f.currencyCode)!==r.currencyCode || !amountMatches(r.amount,f.amount))return [];
      const requestSerial=reference(r.requestSerial);
      const serial=strongSerial(requestSerial) && [f.referenceNumber,...(f.referenceAliases??[])].some(alias=>requestSerial===reference(alias));
      if(serial && (!r.platformCustomerId&&!r.platformCustomerCode || sameCustomer(r,f)))return [{id:f.id,by:'serial' as const}];
      const ref=reference(r.referenceNo);
      // Bank/wallet references must be substantial; generic text and short numbers are ambiguous.
      if(ref.length<6 || !/\d{6}/.test(ref) || ref!==reference(f.sourceReferenceNumber) || !sameCustomer(r,f))return [];
      if(orgDay(f.collectedAt)<orgDay(r.createdAt))return [];
      return [{id:f.id,by:'transfer_reference' as const}];
    });
    candidates.set(index,[...new Map(matches.map(x=>[x.id,x])).values()]);
  });
  const uses=new Map<string,number>();
  for(const values of candidates.values())for(const m of values)uses.set(m.id,(uses.get(m.id)??0)+1);
  return requests.map((r,index)=>{
    const values=candidates.get(index)??[];
    if(values.length!==1 || uses.get(values[0].id)!==1)return r;
    return {...r,finalReceiptId:values[0].id,matchedBy:values[0].by,statusLabel:'تم إصدار سند القبض النهائي'};
  });
}
export function countableReceiptRequest(request: ReceiptRequestState) {
  return !request.finalReceiptId && !['rejected','cancelled','inactive'].includes(String(request.status));
}
