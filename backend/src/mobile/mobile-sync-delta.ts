import {createHash} from 'crypto';
import {AuthUser} from '../common/guards/jwt-auth.guard';

const BUSINESS = ['customers','tasks','followups','promises','collections','reservations'] as const;
const REFERENCES = ['currencies','collectionMethods','followupTypes','followupResults','reservationUnits','oracleCurrencies','oracleReceiptCatalog','oraclePaymentCatalog','oracleWarehouses','oracleItems','oracleInventorySummary'];
const KEYS = new Set<string>([...BUSINESS,...REFERENCES.map(key=>'references.'+key)]);
export function validSyncSectionVersions(value:unknown):value is Record<string,string> {
  return !!value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length<=KEYS.size
    && Object.entries(value).every(([key,hash])=>KEYS.has(key)&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash));
}

/** Compute from fresh scoped data, never from a timer or assumed last-update date. */
export function mobileSyncDelta<T extends {references:Record<string,unknown>}>(
  snapshot:T,user:AuthUser,mode:string,previous?:Record<string,string>,
):T {
  if (!previous) return snapshot; // Existing APKs retain the full-snapshot contract.
  const scope=JSON.stringify([user.organizationId,user.id,[...user.permissions].sort(),mode]);
  const result:any={...snapshot,references:{...snapshot.references},schemaVersion:2};
  const versions:Record<string,string>={};
  let omitted=false;
  const revise=(key:string,value:unknown,remove:()=>void)=>{
    const hash=createHash('sha256').update(scope).update('\0'+key+'\0').update(JSON.stringify(value)).digest('hex');
    versions[key]=hash;
    if(previous[key]===hash){remove();omitted=true;}
  };
  for(const key of BUSINESS)if(key in result)revise(key,result[key],()=>{delete result[key];});
  for(const [key,value]of Object.entries(snapshot.references))if(KEYS.has('references.'+key)){
    revise('references.'+key,value,()=>{delete result.references[key];});
  }
  result.syncSectionVersions=versions;
  result.snapshot=omitted?'delta':'full';
  return result;
}
