import ExcelJS from 'exceljs';

/** Same usable length as mobile dialing; accepts Arabic digits and formatted/multiple numbers. */
export function hasUsableContact(values:unknown[]):boolean {
 return values.some(value=>String(value??'').split(/[,،;؛/|\n]+/).some(part=>{
  let digits=part.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  if(digits.length===10&&digits.startsWith('0'))digits=digits.slice(1);
  return digits.length>=7&&digits.length<=15&&!/^(\d)\1+$/.test(digits);
 }));
}
export const MISSING_PHONE_HEADERS=['كود العميل','رقم الحساب','العميل','المحصل الحالي','الفرع','المنطقة','الحالة','سبب الظهور'];
export async function missingPhonesWorkbook(rows:Array<{externalCustomerCode:string;accountNumber:string|null;name:string;collectorName:string|null;branch:string|null;region:string|null;status:string;reason:string}>){
 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('عملاء دون أرقام',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
 sheet.columns=MISSING_PHONE_HEADERS.map((header,i)=>({header,width:[18,22,38,30,24,24,18,40][i],style:{numFmt:'@',font:{name:'Arial',size:11},alignment:{readingOrder:'rtl',horizontal:'right',wrapText:true}}}));
 for(const row of rows)sheet.addRow([row.externalCustomerCode,row.accountNumber??'',row.name,row.collectorName??'غير مسند',row.branch??'',row.region??'',row.status==='active'?'نشط':'غير نشط',row.reason]);
 sheet.getRow(1).font={name:'Arial',bold:true,color:{argb:'FFFFFFFF'}};
 sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF004B40'}};
 sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:8}};
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
