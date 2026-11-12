import {getDb,getMeta} from '../db/database';
import {assertBusinessSession,SessionAccessError} from './business-session';
import {generateIdempotencyKey} from './constants';

const KEY='business.queue.lease',TTL=5*60*1000;
/** SQLite arbitrates foreground/headless workers; an interrupted lease expires. */
export async function withQueueLease<T>(work:(owner:string,check:()=>Promise<void>)=>Promise<T>,expectedOwner?:string):Promise<T|null>{
 const owner=await getMeta('dataOwner');if(!owner)return null;
 await assertBusinessSession(expectedOwner??owner);
 const db=await getDb(),id=generateIdempotencyKey();
 const value=()=>JSON.stringify({id,owner,expiresAt:Date.now()+TTL});
 const claimed=await db.runAsync(`INSERT INTO sync_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(json_extract(sync_metadata.value,'$.expiresAt') AS INTEGER)<=?`,KEY,value(),Date.now());
 if(!claimed.changes)return null;
 const check=async()=>{
  await assertBusinessSession(owner);
  const renewed=await db.runAsync(`UPDATE sync_metadata SET value=? WHERE key=? AND json_extract(value,'$.id')=?`,value(),KEY,id);
  if(!renewed.changes)throw new SessionAccessError('SESSION_CHANGED');
 };
 try{return await work(owner,check);}finally{await db.runAsync(`DELETE FROM sync_metadata WHERE key=? AND json_extract(value,'$.id')=?`,KEY,id);}
}
