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
