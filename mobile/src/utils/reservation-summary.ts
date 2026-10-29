export function reservationSummary(rows: any[]) {
 const active=rows.filter(row=>['open','active','partial'].includes(String(row.status).toLowerCase()));
 const quantities:Record<string,number>={};const totals:Record<string,number>={YER:0,SAR:0};
 const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
 for(const row of active){
  const unit=row.totalTons!=null?'طن':String(row.unitName||'وحدة غير محددة');
  quantities[unit]=(quantities[unit]||0)+number(row.totalTons??row.remainingQty);
  const raw=String(row.currencyCode||'غير محددة').trim().toUpperCase();
  const currency=({YR:'YER',YER:'YER',SR:'SAR',SAR:'SAR'} as Record<string,string>)[raw]||raw;
  totals[currency]=(totals[currency]||0)+number(row.totalAmount);
 }
 return {count:active.length,quantities,totals};
}
