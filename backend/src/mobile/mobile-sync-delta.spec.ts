import {mobileSyncDelta,validSyncSectionVersions} from './mobile-sync-delta';
const user:any={id:'u',organizationId:'org',permissions:['balances.read','customers.read_all']};
const snapshot=()=>({schemaVersion:1,snapshot:'full',serverTime:'now',syncToken:'next',customers:[{id:'c',name:'عميل',balance:'446105.077'}],tasks:[{id:'t'}],followups:[],promises:[{id:'p'}],collections:[],reservations:[],references:{currencies:[{code:'YER'}],oracleReceiptCatalog:[{parties:{customers:[{code:'1',name:'عميل'}]}}]},newDebt:{window:{to:'now'},amount:'0.0041'}});
describe('scoped mobile delta snapshots',()=>{
 it('retains the exact full response for legacy APKs',()=>{const full=snapshot();expect(mobileSyncDelta(full,user,'collection')).toBe(full);});
 it('skips unchanged sections while refreshing volatile summary metadata',()=>{
  const first:any=mobileSyncDelta(snapshot(),user,'collection',{});
  const next=snapshot();next.newDebt.window.to='later';next.serverTime='later';
  const result:any=mobileSyncDelta(next,user,'collection',first.syncSectionVersions);
  expect(result.snapshot).toBe('delta');expect(result.customers).toBeUndefined();expect(result.tasks).toBeUndefined();expect(result.references).toEqual({});expect(result.newDebt).toEqual(next.newDebt);expect(first.customers[0].balance).toBe('446105.077');
 });
 it('sends changed records and explicit empty sections without altering the original snapshot',()=>{
  const first:any=mobileSyncDelta(snapshot(),user,'collection',{});const next=snapshot();next.customers[0].name='اسم جديد';next.promises=[];
  const result:any=mobileSyncDelta(next,user,'collection',first.syncSectionVersions);
  expect(result.customers).toEqual(next.customers);expect(result.promises).toEqual([]);expect(result.references).toEqual({});expect(next.references.currencies).toHaveLength(1);
 });
 it.each([{...user,id:'other'},{...user,organizationId:'other'},{...user,permissions:['balances.read']}])('does not reuse another identity or permission scope',actor=>{
  const first:any=mobileSyncDelta(snapshot(),user,'collection',{});const result:any=mobileSyncDelta(snapshot(),actor,'collection',first.syncSectionVersions);expect(result.customers).toEqual(snapshot().customers);expect(result.references.currencies).toBeDefined();
 });
 it('does not reuse a collection revision in operations mode',()=>{const first:any=mobileSyncDelta(snapshot(),user,'collection',{});expect((mobileSyncDelta(snapshot(),user,'operations',first.syncSectionVersions) as any).customers).toBeDefined();});
 it('rejects unsupported, unbounded and malformed version maps',()=>{expect(validSyncSectionVersions({})).toBe(true);for(const value of [[],null,{'customers':'x'},{'unknown':'a'.repeat(64)}])expect(validSyncSectionVersions(value)).toBe(false);});
});
