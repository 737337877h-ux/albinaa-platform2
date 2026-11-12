import {getAccessToken,getCachedUser,getLastUserActivity} from './secure-storage';
import {sessionAllowsWorkInMemory,sessionExpired} from './session-lock';

export class SessionAccessError extends Error {
 constructor(public code:'SESSION_LOCKED'|'SESSION_CHANGED'){
  super(code==='SESSION_LOCKED'?'انتهت مهلة الجلسة؛ افتح التطبيق وسجّل الدخول لاستكمال الإرسال':'تغير الحساب؛ بقيت العمليات في نطاقها الأصلي');
 }
}
export function isSessionAccessError(error:any){return ['SESSION_LOCKED','SESSION_CHANGED'].includes(error?.code);}
export function tokenSubject(token:string):string|null {
 try{const raw=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(globalThis.atob(raw.padEnd(Math.ceil(raw.length/4)*4,'='))).sub??null;}catch{return null;}
}
/** A headless task may use a recent session, never open one or extend its idle time. */
export async function assertBusinessSession(expectedOwner?:string){
 const inMemory=sessionAllowsWorkInMemory();
 if(inMemory===false)throw new SessionAccessError('SESSION_LOCKED');
 const {getMeta}=await import('../db/database');
 const [user,token,last,owner]=await Promise.all([getCachedUser(),getAccessToken(),getLastUserActivity(),getMeta('dataOwner')]);
 if(!token||!user||(inMemory!==true&&sessionExpired(last)))throw new SessionAccessError('SESSION_LOCKED');
 const identity=`${user.organizationId}:${user.id}`;
 if(owner!==identity||(expectedOwner&&owner!==expectedOwner)||tokenSubject(token)!==user.id)throw new SessionAccessError('SESSION_CHANGED');
 return {owner:identity,token};
}
