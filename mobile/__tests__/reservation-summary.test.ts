import {describe,it,expect,jest} from '@jest/globals';
jest.mock('../src/config/product',()=>({isOperationsApp:false}));
import {canOpenAppRoute} from '../src/utils/app-access';
import {reservationSummary} from '../src/utils/reservation-summary';
describe('collector reservations',()=>{
 it('preserves separate read and create permissions',()=>{expect(canOpenAppRoute('Reservations',['mobile.reservations.view'])).toBe(true);expect(canOpenAppRoute('NewReservation',['mobile.reservations.view'])).toBe(false);expect(canOpenAppRoute('NewReservation',['mobile.reservations.create'])).toBe(true);expect(canOpenAppRoute('Reservations',[])).toBe(false);});
 it('separates currencies and only sums remaining active goods',()=>{const rows=[{status:'partial',totalTons:2,totalAmount:500,currencyCode:'YR'},{status:'open',totalTons:3,totalAmount:100,currencyCode:'SAR'},{status:'completed',totalTons:9,totalAmount:900,currencyCode:'YER'},{status:'cancelled',totalTons:8,totalAmount:800,currencyCode:'SAR'}];expect(reservationSummary(rows)).toEqual({count:2,quantities:{'طن':5},totals:{YER:500,SAR:100}});});
 it('does not label unconverted pieces as tons',()=>{expect(reservationSummary([{status:'active',remainingQty:8,unitName:'حبة',totalAmount:25,currencyCode:'SR'}])).toEqual({count:1,quantities:{'حبة':8},totals:{YER:0,SAR:25}});});
 it('shows both requested currencies when empty',()=>{expect(reservationSummary([]).totals).toEqual({YER:0,SAR:0});});
});
