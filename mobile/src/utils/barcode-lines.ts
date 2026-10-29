import { westernDigits } from './date-input';
export type ScannableLine = {id:string;item?:{key:string};unit?:{key:string};quantity:string;expanded:boolean};
export function incrementBarcodeLine<T extends ScannableLine>(rows:T[], id:string):T[] {
 return rows.map(row=>row.id===id?{...row,quantity:String((Number(westernDigits(row.quantity))||0)+1),expanded:true}:row);
}
export function barcodeItem(rows:any[], code:string) {
 const exact=rows.filter(row=>String(row.externalItemCode??row.itemCode)===code || (row.units??[]).some((u:any)=>String(u.barcode??'')===code));
 return exact.length===1?exact[0]:undefined;
}
