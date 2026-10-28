export function inventoryCostAccess<T>(value:T,permissions:readonly string[]):T {
 if(permissions.includes('mobile.inventory.cost.view'))return value;
 const redact=(node:any):any=>node==null||typeof node!=='object'?node:Array.isArray(node)?node.map(redact):Object.fromEntries(Object.entries(node).filter(([key])=>!/cost|valuation|lastSupply|stockValue|inventoryValue/i.test(key)).map(([key,item])=>[key,redact(item)]));
 return redact(value);
}
