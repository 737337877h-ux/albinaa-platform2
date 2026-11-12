import {afterEach,beforeEach,describe,expect,it,jest} from '@jest/globals';
const {DatabaseSync}=require('node:sqlite');
let mockDb:any;
jest.mock('../src/db/database',()=>({
 getMeta:async(key:string)=>mockDb.prepare('SELECT value FROM sync_metadata WHERE key=?').get(key)?.value??null,
 getDb:async()=>({runAsync:async(sql:string,...args:any[])=>mockDb.prepare(sql).run(...args)}),
}));
jest.mock('../src/utils/business-session',()=>({assertBusinessSession:async()=>({owner:'org:u1'}),SessionAccessError:class extends Error{code:string;constructor(code:string){super(code);this.code=code;}}}));
jest.mock('../src/utils/constants',()=>({generateIdempotencyKey:()=>`${Date.now()}-${Math.random()}`}));
import {withQueueLease} from '../src/utils/queue-lease';
const deferred=()=>{let resolve!:()=>void;return {promise:new Promise<void>(r=>{resolve=r;}),resolve:()=>resolve()};};
const tick=()=>new Promise(r=>setImmediate(r));
describe('SQLite foreground/headless exclusion',()=>{
 beforeEach(()=>{mockDb=new DatabaseSync(':memory:');mockDb.exec("CREATE TABLE sync_metadata(key TEXT PRIMARY KEY,value TEXT); INSERT INTO sync_metadata VALUES('dataOwner','org:u1')");});
 afterEach(()=>{mockDb.close();jest.useRealTimers();jest.restoreAllMocks();});
 it('allows only one worker and releases after completion',async()=>{
  const stop=deferred(),started=deferred(),work=jest.fn<()=>Promise<void>>();
  const first=withQueueLease(async()=>{started.resolve();await stop.promise;});await started.promise;
  expect(await withQueueLease(work)).toBeNull();expect(work).not.toHaveBeenCalled();stop.resolve();await first;
  await withQueueLease(work);expect(work).toHaveBeenCalledTimes(1);
 });
 it('releases on failure without touching queued business records',async()=>{
  await expect(withQueueLease(async()=>{throw Error('offline');})).rejects.toThrow('offline');
  expect(mockDb.prepare("SELECT value FROM sync_metadata WHERE key='business.queue.lease'").get()).toBeUndefined();
 });
 it('recovers an interrupted lease, and an old worker cannot remove its replacement',async()=>{
  const firstStop=deferred(),secondStop=deferred(),firstStarted=deferred(),secondStarted=deferred();
  const now=Date.now();jest.spyOn(Date,'now').mockReturnValue(now);
  const first=withQueueLease(async()=>{firstStarted.resolve();await firstStop.promise;});await firstStarted.promise;
  (Date.now as jest.Mock).mockReturnValue(now+301000);
  const second=withQueueLease(async()=>{secondStarted.resolve();await secondStop.promise;});await secondStarted.promise;
  firstStop.resolve();await first;
  expect(mockDb.prepare("SELECT value FROM sync_metadata WHERE key='business.queue.lease'").get()).toBeTruthy();
  secondStop.resolve();await second;jest.restoreAllMocks();
 });
});
