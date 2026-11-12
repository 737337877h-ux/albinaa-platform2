import {describe,it,expect} from '@jest/globals';
import {formatBalance} from '../src/utils/customer';

describe('Oracle account precision',()=>{
  it.each<[number,string]>([[446105.077,'446,105.077'],[-0.0041,'-0.0041'],[500.09,'500.09'],[350000,'350,000']])(
    'preserves the financial value %s without padding or hiding significant fractions', (value,expected)=>{
      expect(formatBalance(value as number)).toBe(expected);
    });
});
