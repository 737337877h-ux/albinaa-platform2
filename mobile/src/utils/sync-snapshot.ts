import type {SyncResponse} from '../api/endpoints';
import type {MobileSyncBatch} from '../db/database';

const SECTION=/^(customers|tasks|followups|promises|collections|reservations|references\.(currencies|collectionMethods|followupTypes|followupResults|reservationUnits|oracleCurrencies|oracleReceiptCatalog|oraclePaymentCatalog|oracleWarehouses|oracleItems|oracleInventorySummary))$/;
export function validSyncVersions(value:unknown):value is Record<string,string>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=17
  &&Object.entries(value).every(([key,hash])=>SECTION.test(key)&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash));
}
export function parseSyncVersions(raw:string|null):Record<string,string>{
 try{const value=JSON.parse(raw||'{}');return validSyncVersions(value)?value:{};}catch{return {};}
}
/** Reject proxy pages, undecoded/truncated bodies and incomplete snapshots before touching SQLite. */
export function assertSyncResponse(value:unknown):asserts value is SyncResponse {
 const data=value as SyncResponse;
 const business=['customers','tasks','followups','promises','collections','reservations'] as const;
 const object=(item:unknown)=>!!item&&typeof item==='object'&&!Array.isArray(item);
 if(!object(data)||!['full','delta'].includes(data.snapshot)||![1,2].includes(data.schemaVersion)
  ||typeof data.syncToken!=='string'||!data.syncToken.trim()
  ||typeof data.serverTime!=='string'||!Number.isFinite(Date.parse(data.serverTime))
  ||!object(data.references)
  ||business.some(key=>data[key]!==undefined?!Array.isArray(data[key]):data.snapshot==='full')
  ||Object.values(data.references).some(items=>!Array.isArray(items))
  ||((data.snapshot==='delta'||data.schemaVersion===2)&&!validSyncVersions(data.syncSectionVersions))){
  throw new Error('وصل رد مزامنة غير مكتمل أو غير قابل للقراءة؛ بقيت بياناتك وعملياتك المحفوظة كما هي. أعد المحاولة.');
 }
}
/** Omitted delta sections are preserved; an explicitly empty section removes old rows. */
export function syncSnapshotBatch(data:SyncResponse):MobileSyncBatch{
 const delta=data.snapshot==='delta';
 if((delta||data.syncSectionVersions!==undefined)&&(!validSyncVersions(data.syncSectionVersions)||data.schemaVersion!==2))throw new Error('استجابة المزامنة غير مكتملة؛ بقيت البيانات المحفوظة كما هي');
 return {
  inventoryCatalogVersion:data.inventoryCatalogVersion,
  syncSectionVersions:data.syncSectionVersions,
  customers:data.customers??(delta?undefined:[]),tasks:data.tasks??(delta?undefined:[]),
  followups:data.followups??(delta?undefined:[]),promises:data.promises??(delta?undefined:[]),
  collections:data.collections??(delta?undefined:[]),reservations:data.reservations??(delta?undefined:[]),
  references:data.references??{},newDebt:data.newDebt===undefined?(delta?undefined:null):data.newDebt,
  customerAlerts:data.customerAlerts===undefined?(delta?undefined:null):data.customerAlerts,
 };
}
