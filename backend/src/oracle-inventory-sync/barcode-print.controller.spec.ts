import { BarcodePrintService } from './barcode-print.controller';
describe('barcode queue safety', () => {
 const org='ced51b8c-59bb-4353-8308-a50667ef5d6c';
 const actor:any={id:'e9436c07-4896-4f9b-a290-1585030a039e',organizationId:org};
 const dto={operationId:'21d2a870-2054-4714-a931-fb9bbc7f2039',itemCode:'230800105005',itemName:'صنف',widthMm:50,heightMm:30,copies:1,showName:true,showCode:true};
 let db:any,service:BarcodePrintService;
 beforeEach(()=>{process.env.BARCODE_PRINT_ORG=org;process.env.BARCODE_PRINT_KEY='x'.repeat(64);db={$executeRaw:jest.fn().mockResolvedValue(1),$queryRaw:jest.fn()};service=new BarcodePrintService(db);});
 afterEach(()=>{delete process.env.BARCODE_PRINT_ORG;delete process.env.BARCODE_PRINT_KEY;});
 it('rejects another organization before writing',async()=>{await expect(service.create({...actor,organizationId:'other'},dto)).rejects.toThrow();expect(db.$executeRaw).not.toHaveBeenCalled();});
 it('rejects unreadably narrow labels before writing',async()=>{await expect(service.create(actor,{...dto,widthMm:20})).rejects.toThrow('زد عرض');expect(db.$executeRaw).not.toHaveBeenCalled();});
 it('rejects missing or wrong agent secrets without touching the queue',async()=>{await expect(service.next('')).rejects.toThrow();await expect(service.next('y'.repeat(64))).rejects.toThrow();expect(db.$executeRaw).not.toHaveBeenCalled();});
 it('returns existing job for a duplicate operation and detects changed content',async()=>{
  const result:any={};require('jsbarcode')(result,dto.itemCode,{format:'CODE128',displayValue:false});
  const {operationId,...payload}=dto;db.$queryRaw.mockResolvedValue([{id:'existing',status:'submitted',payload:{...payload,bits:result.encodings.map((e:any)=>e.data).join('')}}]);
  expect(await service.create(actor,dto)).toEqual({id:'existing',status:'submitted'});
  await expect(service.create(actor,{...dto,copies:2})).rejects.toThrow('بإعدادات مختلفة');
 });
 it('claims queued work atomically and marks stale dispatches unknown without requeueing',async()=>{
  db.$queryRaw.mockResolvedValue([]);expect(await service.next('x'.repeat(64))).toBeNull();
  expect(db.$executeRaw.mock.calls[0][0].join('')).toContain("status='unknown'");
  const sql=db.$queryRaw.mock.calls[0][0].join('');expect(sql).toContain('FOR UPDATE SKIP LOCKED');expect(sql).toContain("status='queued'");
 });
});
