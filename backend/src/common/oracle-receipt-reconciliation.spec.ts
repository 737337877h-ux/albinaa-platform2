import { reconcileReceiptRequests, countableReceiptRequest, recordedLocalReceiptFinals } from './oracle-receipt-reconciliation';
const audit=(extra:any={})=>({id:'a',entityId:'request-93',createdAt:new Date('2026-10-27T17:43:11Z'),newValue:{
  kind:'receipt',requestNo:'93',requestSerial:'request-93',amount:100000,currencyCode:'YR',platformCustomerCode:'90002',referenceNo:'7770012345',...extra}});
const final=(extra:any={})=>({id:'final-13',referenceNumber:'final-serial-13',sourceReferenceNumber:'7770012345',externalCustomerCode:'90002',
  customerId:'customer',amount:100000,currencyCode:'YER',collectedAt:'2026-10-27T00:00:00+03:00',...extra});
const live=(extra:any={})=>({kind:'receipt',requestSerial:'request-93',status:'approved',platformCustomerCode:'90002',...extra});
it('replaces request93 with receipt13 using the unique bank reference, customer, currency and amount',()=>{
 const [r]=reconcileReceiptRequests([audit()],[final()],[live()]);
 expect(r).toMatchObject({finalReceiptId:'final-13',matchedBy:'transfer_reference',statusVerified:true,status:'approved'});
 expect(countableReceiptRequest(r)).toBe(false);
});
it('fills the customer code absent from older phone audits from the live request',()=>{
 expect(reconcileReceiptRequests([audit({platformCustomerCode:null})],[final()],[live()])[0].finalReceiptId).toBe('final-13');
});
it('labels creation-time pending as unverified if Oracle is unavailable',()=>{
 const [r]=reconcileReceiptRequests([audit()],[]);
 expect(r.status).toBe('unknown');expect(r.statusVerified).toBe(false);expect(r.statusLabel).toContain('تعذر التحقق');
});
it.each([{amount:99999},{currencyCode:'SAR'},{externalCustomerCode:'other'},{sourceReferenceNumber:'other'},
 {collectedAt:'2026-10-26T00:00:00+03:00'}])('does not collapse a different final receipt %j',change=>{
 expect(reconcileReceiptRequests([audit()],[final(change)],[live()])[0].finalReceiptId).toBeNull();
});
it('does not guess by recipient name/amount or a short reused document number',()=>{
 expect(reconcileReceiptRequests([audit({referenceNo:'13',recipientName:'same name'})],[final({sourceReferenceNumber:'13'})],[live()])[0].finalReceiptId).toBeNull();
});
it('leaves repeated reference candidates and duplicate requests for review',()=>{
 expect(reconcileReceiptRequests([audit()],[final(),final({id:'other-final'})],[live()])[0].finalReceiptId).toBeNull();
 const other={...audit(),id:'b',entityId:'request-94',newValue:{...audit().newValue,requestSerial:'request-94'}};
 expect(reconcileReceiptRequests([audit(),other],[final()],[live()]).every(r=>!r.finalReceiptId)).toBe(true);
});
it.each(['rejected','cancelled','inactive'])('does not count %s requests',status=>{
 expect(countableReceiptRequest(reconcileReceiptRequests([audit()],[],[live({status})])[0])).toBe(false);
});
it('retains exact serial matching without needing a transfer reference',()=>{
 expect(reconcileReceiptRequests([audit({referenceNo:null})],[final({referenceNumber:'request-93'})])[0].matchedBy).toBe('serial');
});
it('does not use a short reused numeric document number as a globally unique serial',()=>{
 const request={...audit({requestSerial:'13',referenceNo:null,platformCustomerCode:null}),entityId:'13'};
 expect(reconcileReceiptRequests([request],[final({referenceNumber:'13'})])[0].finalReceiptId).toBeNull();
});
it.each([{platformCustomerId:'wrong-id'},{platformCustomerCode:'wrong-code',platformCustomerId:'customer'}])('rejects conflicting supplied customer identities %j',change=>{
 expect(reconcileReceiptRequests([audit(change)],[final()],[live({platformCustomerCode:change.platformCustomerCode??'90002'})])[0].finalReceiptId).toBeNull();
});
it.each([undefined,null,'unrecognized'])('does not verify a creation-time fallback when the live status is %s',status=>{
 const [r]=reconcileReceiptRequests([audit()],[],[live({status})]);
 expect(r.status).toBe('unknown');expect(r.statusVerified).toBe(false);
});
it('recognizes recorded local finals by an exact global serial alias and excludes pending/reversed rows',()=>{
 const serial='202600000100092200000009001';
 const rows=recordedLocalReceiptFinals([
  {id:'local-final',customerId:'customer',currencyCode:'YER',amount:100000,collectedAt:'2026-10-27T20:00:00+03:00',
   referenceNumber:'bank-ref',receiptNumber:serial,status:'recorded',customer:{externalCustomerCode:'90002'}},
  ...['pending_approval','reversed'].map(status=>({id:status,customerId:'customer',currencyCode:'YER',amount:100000,
   collectedAt:'2026-10-27',referenceNumber:serial,status})),
 ]);
 expect(rows).toHaveLength(1);
 const [r]=reconcileReceiptRequests([audit({requestSerial:serial,referenceNo:null})],rows,[]);
 expect(r.finalReceiptId).toBe('local-final');expect(r.matchedBy).toBe('serial');
 expect(countableReceiptRequest(r)).toBe(false);
});
