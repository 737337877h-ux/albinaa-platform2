import {hasUsableContact,missingPhonesWorkbook} from './missing-phones';
import {CustomersService} from './customers.service';
import ExcelJS from 'exceljs';
const actor={id:'u1',organizationId:'org',roles:['المحصل'],permissions:['customers.read']} as any;
function customer(id:string,phone:string|null=null){return {id,externalCustomerCode:id,accountNumber:'00112101',name:'محمد أحمد',phonePrimary:phone,phoneSecondary:null,whatsapp:null,region:null,status:'active',branch:null,assignments:[{collector:{id:'col',user:{fullName:'محصل'}}}]};}
it.each([[null,'','لا يوجد','0000000'],['123','---','111111111']])('rejects empty, placeholder and incomplete fields %s',(...values)=>expect(hasUsableContact(values)).toBe(false));
it.each(['٧٧٧١٢٣٤٥٦','+967 777 123 456','00966-50-123-4567','https://wa.me/967777123456','777123456 / 777234567'])('accepts formatted, Arabic or additional numbers: %s',value=>expect(hasUsableContact([null,null,value])).toBe(true));
it('checks all three fields before pagination and exports all filtered results',async()=>{
 const rows=[customer('0001'),{...customer('0002'),whatsapp:'٧٧٧١٢٣٤٥٦'},customer('0003','123')];
 const findMany=jest.fn().mockResolvedValue(rows),db={customer:{findMany},collector:{findUnique:jest.fn().mockResolvedValue({id:'col'})}};
 const service=new CustomersService(db as any,{} as any,{} as any);
 const q={page:1,limit:1};const report=await service.withoutPhones(actor,q);
 expect(report.total).toBe(2);expect(report.items.map(c=>c.id)).toEqual(['0001']);
 expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({organizationId:'org',assignments:{some:{collectorId:'col',effectiveTo:null}}});
 expect((await service.withoutPhones(actor,q,true)).items.map(c=>c.id)).toEqual(['0001','0003']);
 expect((await service.withoutPhones(actor,{collectorId:'unassigned'})).total).toBe(0);
});
it('uses normalized multiword search and does not broaden a missing collector scope',async()=>{
 const findMany=jest.fn().mockResolvedValue([customer('001')]);
 const db={customer:{findMany},collector:{findUnique:jest.fn().mockResolvedValue(null)}};
 const service=new CustomersService(db as any,{} as any,{} as any);
 await service.withoutPhones(actor,{});
 expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({organizationId:'org',id:'00000000-0000-0000-0000-000000000000'});
 db.collector.findUnique.mockResolvedValue({id:'col'});
 expect((await service.withoutPhones(actor,{search:'أحمد محمد'})).total).toBe(1);
 expect((await service.withoutPhones(actor,{search:'عميل آخر'})).total).toBe(0);
});
it('exports Arabic text and customer/account identifiers without Excel rounding or formulas',async()=>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await missingPhonesWorkbook([{externalCustomerCode:'0001',accountNumber:'00112101001',name:'=اسم',collectorName:null,branch:null,region:null,status:'active',reason:'لا توجد أرقام مسجلة'}]) as any);
 const sheet=book.worksheets[0];expect(sheet.getCell('A2').value).toBe('0001');expect(sheet.getCell('B2').value).toBe('00112101001');expect(sheet.getCell('C2').type).toBe(ExcelJS.ValueType.String);expect(sheet.views[0].rightToLeft).toBe(true);
});
