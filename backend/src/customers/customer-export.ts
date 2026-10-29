import ExcelJS from 'exceljs';
export const CUSTOMER_EXPORT_HEADERS=['كود العميل','رقم الحساب','الاسم','الاسم التجاري','الهاتف الرئيسي','الهاتف الآخر','واتساب','المنطقة','العنوان','خط العرض','خط الطول','المحصل','الفرع','النوع','الحالة','الأرصدة','بداية العلاقة','ملاحظات'];
export interface CustomerExportRow {
 externalCustomerCode:unknown;accountNumber:unknown;name:unknown;tradeName:unknown;
 phonePrimary:unknown;phoneSecondary:unknown;whatsapp:unknown;region:unknown;address:unknown;
 geoLat:unknown;geoLng:unknown;customerType:unknown;status:unknown;notes:unknown;
 relationshipStartDate:Date|null;branch:{name:string}|null;
 assignments:{collector:{user:{fullName:string}}}[];
 balances:{currencyCode:string;accountingBalance:unknown}[];
}
export function customerExportValues(row:CustomerExportRow):string[]{
 return [row.externalCustomerCode,row.accountNumber,row.name,row.tradeName,row.phonePrimary,row.phoneSecondary,row.whatsapp,
 row.region,row.address,row.geoLat,row.geoLng,row.assignments[0]?.collector.user.fullName,row.branch?.name,
 row.customerType,row.status,row.balances.map(b=>`${b.currencyCode}: ${b.accountingBalance}`).join(' | '),
 row.relationshipStartDate?.toISOString().slice(0,10),row.notes].map(value=>String(value??''));
}
export function customerExportCsv(rows:CustomerExportRow[]){
 const cell=(v:string)=>`"${v.replace(/"/g,'""')}"`;
 return '\uFEFF'+[CUSTOMER_EXPORT_HEADERS,...rows.map(customerExportValues)].map(r=>r.map(cell).join(',')).join('\r\n');
}
// Native application export: keep identifiers and source values as text so Excel
// never drops leading zeroes, rounds account numbers, or evaluates source text.
export async function customerExportWorkbook(rows:CustomerExportRow[]){
 const book=new ExcelJS.Workbook();book.creator='منصة البناء الراقي';book.created=new Date();
 const sheet=book.addWorksheet('قاعدة العملاء',{views:[{state:'frozen',ySplit:1,rightToLeft:true}]});
 const widths=[18,22,36,30,22,22,22,22,40,20,20,28,26,18,18,52,22,48];
 sheet.columns=CUSTOMER_EXPORT_HEADERS.map((header,i)=>({header,width:widths[i],style:{numFmt:'@',font:{name:'Arial',size:11},alignment:{vertical:'middle',horizontal:'right',readingOrder:'rtl',wrapText:true}}}));
 const header=sheet.getRow(1);header.height=30;header.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFFFF'}};
 header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF004B40'}};
 for(const row of rows){const line=sheet.addRow(customerExportValues(row));line.height=30;if(line.number%2===0)line.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7F6'}};}
 sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:CUSTOMER_EXPORT_HEADERS.length}};
 return Buffer.from(await book.xlsx.writeBuffer());
}
