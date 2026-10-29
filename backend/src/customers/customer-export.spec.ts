import ExcelJS from 'exceljs';
import {customerExportWorkbook,customerExportCsv,CUSTOMER_EXPORT_HEADERS,customerExportValues} from './customer-export';
import {CustomersController} from './customers.controller';
import {CustomersService} from './customers.service';
const row:any={externalCustomerCode:'00030677',accountNumber:'11210100112345678901',name:'عميل عربي "مميز"',tradeName:null,phonePrimary:'0770123456',phoneSecondary:'+967770123456',whatsapp:'00967770123456',region:null,address:'شارع أول\nالدور الثاني',geoLat:0,geoLng:44.253594,customerType:'customer',status:'active',notes:'=1+1',relationshipStartDate:null,branch:null,assignments:[],balances:[{currencyCode:'YER',accountingBalance:'-0.0024'},{currencyCode:'SAR',accountingBalance:'2284.208'}]};
it('creates a real RTL Excel workbook with separate Arabic columns and exact text identifiers',async()=>{
 const bytes=await customerExportWorkbook([row]);expect(bytes.subarray(0,2).toString()).toBe('PK');
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as any);const sheet=book.worksheets[0];
 expect(sheet.rowCount).toBe(2);expect(sheet.columnCount).toBe(18);expect(sheet.views[0]).toMatchObject({state:'frozen',ySplit:1,rightToLeft:true});
 expect(sheet.getRow(1).values).toEqual([undefined,...CUSTOMER_EXPORT_HEADERS]);
 expect(sheet.getRow(2).values).toEqual([undefined,...customerExportValues(row)]);
 expect(sheet.getCell('A2').value).toBe('00030677');expect(sheet.getCell('B2').value).toBe(row.accountNumber);expect(sheet.getCell('E2').value).toBe('0770123456');
 expect(sheet.getCell('R2').value).toBe('=1+1');expect(sheet.getCell('R2').type).toBe(ExcelJS.ValueType.String);expect(sheet.getCell('J2').text).toBe('0');
 expect(sheet.getCell('P2').text).toBe('YER: -0.0024 | SAR: 2284.208');expect(sheet.autoFilter).toBe('A1:R2');
});
it('keeps the existing CSV option and does not invent missing source fields',()=>{
 const csv=customerExportCsv([row]);expect(csv.startsWith('\uFEFF')).toBe(true);expect(csv).toContain('"عميل عربي ""مميز"""');expect(csv).toContain('"شارع أول\nالدور الثاني"');
 expect(customerExportValues(row)[3]).toBe('');expect(customerExportValues(row)[9]).toBe('0');
});
it('handles an empty scoped export with valid headers',async()=>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await customerExportWorkbook([]) as any);expect(book.worksheets[0].rowCount).toBe(1);
});
it('keeps the XLSX response MIME, filename and binary format consistent',async()=>{
 const service={exportFull:jest.fn().mockResolvedValue([row])};const controller=new CustomersController(service as any);const res={setHeader:jest.fn(),send:jest.fn()};
 await controller.exportFull({id:'actor'} as any,res as any,'xlsx');expect(res.setHeader).toHaveBeenCalledWith('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition',expect.stringContaining('.xlsx'));expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
 await expect(controller.exportFull({} as any,res as any,'xls')).rejects.toThrow();
});
it('preserves assigned-customer visibility and includes zero balances without pagination',async()=>{
 const prisma={collector:{findUnique:jest.fn().mockResolvedValue({id:'collector'})},customer:{findMany:jest.fn().mockResolvedValue([])}};
 await new CustomersService(prisma as any,{} as any,{} as any).exportFull({id:'u',organizationId:'org',roles:['المحصل'],permissions:[]} as any);
 const q=prisma.customer.findMany.mock.calls[0][0];expect(q.where).toMatchObject({organizationId:'org',assignments:{some:{collectorId:'collector',effectiveTo:null}}});expect(q.where.balances).toBeUndefined();expect(q.take).toBeUndefined();
});
