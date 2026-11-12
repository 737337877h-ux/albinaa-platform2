import {describe,expect,it,jest} from '@jest/globals';
jest.mock('../src/config/product',()=>({isOperationsApp:false}));
import {canOpenAppRoute} from '../src/utils/app-access';
describe('collection report permissions',()=>{
 it('requires report permission for collector performance',()=>{
  expect(canOpenAppRoute('CollectorPerformance',['reports.read'])).toBe(true);
  expect(canOpenAppRoute('CollectorPerformance',['customers.read'])).toBe(false);
 });
 it('honors explicit mobile customer access and legacy roles for the missing-phone report',()=>{
  expect(canOpenAppRoute('CustomersWithoutPhones',['customers.read'])).toBe(true);
  expect(canOpenAppRoute('CustomersWithoutPhones',['customers.read','mobile.inventory.view'])).toBe(false);
  expect(canOpenAppRoute('CustomersWithoutPhones',['customers.read','mobile.customers.view'])).toBe(true);
  expect(canOpenAppRoute('CustomersWithoutPhones',['mobile.customers.view'])).toBe(false);
 });
});
