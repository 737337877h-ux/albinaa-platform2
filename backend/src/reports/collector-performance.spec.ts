import {oracleReceiptActivity} from '../common/oracle-receipt-activity';
jest.mock('../common/oracle-receipt-activity',()=>({oracleReceiptActivity:jest.fn().mockResolvedValue([])}));
import {collectorPerformance,performanceRange,periodTarget} from './collector-performance';
import {ReportsService} from './reports.service';
import ExcelJS from 'exceljs';

const actor={id:'u1',organizationId:'org',roles:['مدير النظام'],permissions:['reports.read','customers.read_all']} as any;
function setup(){
 const empty=()=>({findMany:jest.fn().mockResolvedValue([])});
 const db={collection:empty(),collector:empty(),followup:empty(),paymentPromise:empty(),collectorTarget:empty(),customerAssignment:empty(),oracleMovementSyncRun:{findFirst:jest.fn().mockResolvedValue(null)}};
 db.collector.findMany.mockResolvedValue([{id:'a',userId:'u1',oracleCollectorNo:1,active:true,user:{fullName:'محصل'}},{id:'b',userId:'u2',oracleCollectorNo:2,active:false,user:{fullName:'محصل سابق'}}] as any);
 return {db,service:new ReportsService(db as any,{} as any,{} as any)};
}
beforeEach(()=>{(oracleReceiptActivity as jest.Mock).mockReset().mockResolvedValue([]);});
it('uses inclusive Aden days and rejects impossible or oversized ranges',()=>{
 const range=performanceRange('2026-11-01','2026-11-01');
 expect(range.gte.toISOString()).toBe('2026-10-31T21:00:00.000Z');expect(range.lt.toISOString()).toBe('2026-11-01T21:00:00.000Z');
 for(const [a,b] of [['2026-02-30','2026-03-01'],['2026-11-02','2026-11-01'],['2025-01-01','2026-12-31']])expect(()=>performanceRange(a,b)).toThrow();
});
it('preserves four decimals, distinct currencies and customers; excludes pending/reversed receipts and repeated final IDs',()=>{
 const row={id:'r1',collectorId:'a',customerId:'c',currencyCode:'YER',amount:'100.1017',status:'recorded',collector:{user:{fullName:'A'}}};
 const report=collectorPerformance([row,row,{...row,id:'r2',amount:'0.0001'},{...row,id:'r3',currencyCode:'SAR',amount:'5.5001'},{...row,id:'r4',status:'reversed',amount:'999'},{...row,id:'r5',status:'pending_approval',amount:'999'}]);
 expect(report.rows.find(r=>r.currency==='YER')).toMatchObject({amount:'100.1018',customers:1,receipts:2});
 expect(report.totals).toContainEqual({currency:'SAR',amount:'5.5001'});
});
it('prorates month targets by calendar days, including leap years; never hides a missing month',()=>{
 expect(periodTarget([{month:new Date('2026-11-01'),targetAmount:'3000'}],'2026-11-01','2026-11-12')).toBe('1200.0000');
 expect(periodTarget([{month:new Date('2024-02-01'),targetAmount:'2900'}],'2024-02-29','2024-02-29')).toBe('100.0000');
 expect(periodTarget([{month:new Date('2026-11-01'),targetAmount:3000}],'2026-11-30','2026-12-01')).toBeNull();
});
it('restricts all reads and the Oracle projection to the authenticated organization and own collector',async()=>{
 const {db,service}=setup();
 const own={...actor,roles:['المحصل'],permissions:['reports.read','customers.read_all']};
 await service.collectorPerformance(own,'2026-11-01','2026-11-30');
 expect(db.collection.findMany.mock.calls[0][0].where).toMatchObject({customer:{organizationId:'org'},collector:{user:{organizationId:'org'},userId:'u1'},status:'recorded'});
 expect(db.followup.findMany.mock.calls[0][0].where.customer.organizationId).toBe('org');
 expect((oracleReceiptActivity as jest.Mock).mock.calls[0][1].permissions).not.toContain('customers.read_all');
});
it('includes published final receipts once, keeps zero collectors, and attributes followups to their author',async()=>{
 const {db,service}=setup();
 db.collection.findMany.mockResolvedValue([{id:'local',collectorId:'a',customerId:'c1',currencyCode:'YER',amount:'100.0001',status:'recorded',collector:{user:{fullName:'محصل'}}}] as any);
 (oracleReceiptActivity as jest.Mock).mockResolvedValue([{id:'final',collector:{id:'a',user:{fullName:'محصل'}},customerId:'c2',currencyCode:'YER',amount:200,collectedAt:'2026-11-01T00:00:00+03:00',status:'recorded'},{collector:{id:'a'},collectedAt:'2026-12-01T00:00:00+03:00'}]);
 db.followup.findMany.mockResolvedValue([{userId:'u2',customerId:'c1'},{userId:'u2',customerId:'c1'}] as any);
 const result=await service.collectorPerformance(actor,'2026-11-01','2026-11-30');
 expect(result.totals).toEqual([{currency:'YER',amount:'300.0001'}]);expect(result.sources).toEqual({platform:1,oracleMirror:1});
 expect(result.rows.find(r=>r.collectorId==='b')).toMatchObject({amount:'0.0000',receipts:0,collectorNo:2});
 expect(result.activity.find(r=>r.collectorId==='b')).toMatchObject({followups:2,followedCustomers:1,active:false});
});
it('exports the selected report with exact decimal text and the scope/source context',async()=>{
 const {service}=setup();
 jest.spyOn(service,'collectorPerformance').mockResolvedValue({from:'2026-11-01',to:'2026-11-12',scope:'self',sources:{platform:1,oracleMirror:0},oracleSnapshotAt:null,totals:[{currency:'YER',amount:'100.0001'}],rows:[{collectorNo:1,collectorName:'=عميل',currency:'YER',amount:'100.0001',receipts:1,customers:1,sharePercent:null,target:null,targetAttainment:null}],activity:[]} as any);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await service.collectorPerformanceWorkbook(actor,'2026-11-01','2026-11-12') as any);
 expect(book.worksheets).toHaveLength(3);
 expect(book.worksheets[1].getCell('D2').value).toBe('100.0001');
 expect(book.worksheets[1].getCell('B2').type).toBe(ExcelJS.ValueType.String);
 expect(book.worksheets[0].getCell('B2').value).toBe('2026-11-01');
});
