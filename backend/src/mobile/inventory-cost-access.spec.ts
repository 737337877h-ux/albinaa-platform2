import {inventoryCostAccess} from './inventory-cost-access';
describe('mobile cost permission',()=>{
 const data={referencePrimaryCost:'12',pricing:{weightedAverageCost:'14',lastSupplyPrices:[{price:'15'}],lastSalePrices:[{price:'20'}],salePrice:21},stockRows:[{availableQuantity:5,primaryCost:12}],movements:[{itemCost:12,stockCost:11}],valuation:{totalInventoryCost:500}};
 it('removes cost and purchasing data recursively without changing quantities or sales prices',()=>{const hidden=inventoryCostAccess(data,['mobile.inventory.view']);expect(JSON.stringify(hidden)).not.toMatch(/Cost|Supply|valuation/);expect(hidden.stockRows[0].availableQuantity).toBe(5);expect(hidden.pricing.salePrice).toBe(21);expect(data.referencePrimaryCost).toBe('12');});
 it('requires the explicit cost permission',()=>{expect(inventoryCostAccess(data,['users.manage'])).not.toBe(data);expect(inventoryCostAccess(data,['mobile.inventory.cost.view'])).toBe(data);});
});
