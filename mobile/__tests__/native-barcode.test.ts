import {describe,test,expect} from '@jest/globals';
import {barcodeBits,barcodeSettings} from '../src/utils/native-barcode';
describe('native barcode printing limits',()=>{
 test('encodes a product code into real Code128 bars',()=>{const bits=barcodeBits('12345678');expect(bits).toMatch(/^[01]+$/);expect(bits.startsWith('11010011100')).toBe(true);expect(bits.endsWith('1100011101011')).toBe(true);});
 test('accepts supported physical label settings',()=>expect(barcodeSettings('12345678','50','30','2')).toEqual({widthMm:50,heightMm:30,copies:2}));
 test.each(['0','101','1.5','NaN'])('rejects invalid copy count %s',copies=>expect(()=>barcodeSettings('12345678','50','30',copies)).toThrow());
 test.each([['19','30'],['105','30'],['50','151'],['NaN','30']])('rejects unsupported label %s x %s',(width,height)=>expect(()=>barcodeSettings('12345678',width,height,'1')).toThrow());
 test('requires a wider label for a long code before submitting a print job',()=>expect(()=>barcodeSettings('LONG-PRODUCT-CODE-1234567890','20','30','1')).toThrow('زد عرض الملصق'));
 test('rejects control characters and empty item codes',()=>{expect(()=>barcodeBits('')).toThrow();expect(()=>barcodeBits('123\n456')).toThrow();});
});
