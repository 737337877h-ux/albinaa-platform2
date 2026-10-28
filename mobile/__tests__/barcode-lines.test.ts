import {describe,it,expect} from '@jest/globals';
import {barcodeItem,incrementBarcodeLine} from '../src/utils/barcode-lines';
describe('barcode item entry',()=>{
 it('increments only existing row and preserves unit/price for recalculated total',()=>{
 const rows=[{id:'a',item:{key:'100'},unit:{key:'piece'},quantity:'2',price:15,expanded:false},{id:'b',quantity:'',price:0,expanded:true}];
 const result=incrementBarcodeLine(rows,'a');
 expect(result).toHaveLength(2);expect(result[0].quantity).toBe('3');expect(Number(result[0].quantity)*result[0].price).toBe(45);expect(result[0].unit).toEqual(rows[0].unit);expect(rows[0].quantity).toBe('2');
 });
 it('matches exact item before other partial results',()=>{const a={itemCode:'123'},b={itemCode:'1234'};expect(barcodeItem([a,b],'123')).toBe(a);expect(barcodeItem([b],'123')).toBeUndefined();});
 it('resolves unit barcode and rejects ambiguous matches',()=>{const a={itemCode:'12',units:[{barcode:'999'}]};expect(barcodeItem([a],'999')).toBe(a);expect(barcodeItem([a,{...a}],'999')).toBeUndefined();});
 it('starts empty quantity at one and increments decimal quantity',()=>{expect(incrementBarcodeLine([{id:'a',quantity:'',expanded:false}],'a')[0].quantity).toBe('1');expect(incrementBarcodeLine([{id:'a',quantity:'2.5',expanded:false}],'a')[0].quantity).toBe('3.5');});
});
