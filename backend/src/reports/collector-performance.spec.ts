import {oracleReceiptActivity} from '../common/oracle-receipt-activity';
jest.mock('../common/oracle-receipt-activity',()=>({oracleReceiptActivity:jest.fn().mockResolvedValue([])}));
import {collectorPerformance,performanceRange} from './collector-performance';
import {ReportsService} from './reports.service';
it('uses inclusive Aden calendar days and rejects impossible or oversized ranges',()=>{
 const range=performanceRange('2026-11-01','2026-11-01');
 expect(range.gte.toISOString()).toBe('2026-10-31T21:00:00.000Z');expect(range.lt.toISOString()).toBe('2026-11-01T21:00:00.000Z');
 for(const [a,b] of [['2026-02-30','2026-03-01'],['2026-11-02','2026-11-01'],['2025-01-01','2026-12-31']])expect(()=>performanceRange(a,b)).toThrow();
});
it('keeps currencies distinct, excludes reversals and counts customers once',()=>{
 const row={collectorId:'a',customerId:'c',currencyCode:'YER',amount:'100.10',status:'posted',collector:{user:{fullName:'A'}}};
 const report=collectorPerformance([row,row,{...row,collectorId:'b',amount:'200.20'},{...row,currencyCode:'SAR',amount:'5.50'},{...row,status:'reversed',amount:'999'}]);
 expect(report.rows.find(r=>r.collectorId==='a'&&r.currency==='YER')).toMatchObject({amount:'200.20',customers:1,receipts:2,sharePercent:'50.00'});
 expect(report.totals).toContainEqual({currency:'SAR',amount:'5.50'});
});
it('restricts both customer and collector to the authenticated organization',async()=>{
 const findMany=jest.fn().mockResolvedValue([]),service=new ReportsService({collection:{findMany}} as any,{} as any,{} as any);
 await service.collectorPerformance({id:'u',organizationId:'org',permissions:[]} as any,'2026-11-01','2026-11-30');
 expect(findMany.mock.calls[0][0].where).toMatchObject({customer:{organizationId:'org'},collector:{user:{organizationId:'org'}},status:{not:'reversed'}});
});

it('includes published Oracle receipts for the selected inclusive range alongside platform receipts',async()=>{
 const row={collectorId:'c',customerId:'a',currencyCode:'YER',amount:'100',status:'recorded',collector:{id:'c',user:{fullName:'Collector'}}};
 (oracleReceiptActivity as jest.Mock).mockResolvedValueOnce([{...row,amount:200,collectedAt:'2026-11-01T00:00:00+03:00'},{...row,amount:999,collectedAt:'2026-12-01T00:00:00+03:00'}]);
 const service=new ReportsService({collection:{findMany:jest.fn().mockResolvedValue([row])}} as any,{} as any,{} as any);
 const result=await service.collectorPerformance({id:'u',organizationId:'org',permissions:[]} as any,'2026-11-01','2026-11-30');
 expect(result.totals).toEqual([{currency:'YER',amount:'300.00'}]);expect(result.sources).toEqual({platform:1,oracleMirror:1});
});
