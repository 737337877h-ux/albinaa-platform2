import {describe,test,expect} from '@jest/globals';
import {parseGeoPoint} from '../src/utils/geo-point';
describe('customer location validity',()=>{
 test.each([[null,null],[undefined,undefined],['',''],['  ','44'],['abc','44'],[0,0],[91,44],[15,181],[Infinity,44],[true,44]])('rejects %p, %p without inventing coordinates',(lat,lng)=>expect(parseGeoPoint(lat,lng)).toBeNull());
 test('keeps negative coordinates and accepts legitimate equator locations',()=>{expect(parseGeoPoint('-15.2','44.3')).toEqual({latitude:-15.2,longitude:44.3});expect(parseGeoPoint(0,44)).toEqual({latitude:0,longitude:44});});
 test('accepts a comma decimal separator',()=>expect(parseGeoPoint('15,25','44,5')).toEqual({latitude:15.25,longitude:44.5}));
});
