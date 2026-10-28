/** Strip confidential valuation and purchase costs, keeping quantities and sale prices. */
export function inventoryCostAccess<T>(value: T, permissions: readonly string[]): T {
  if (permissions.includes('mobile.inventory.cost.view')) return value;
  function redact(node: any): any {
    if (node == null || typeof node !== 'object' || node instanceof Date) return node;
    if (Array.isArray(node)) return node.map(redact);
    return Object.fromEntries(Object.entries(node).filter(([key]) => !/cost|valuation|lastSupply|stockValue|inventoryValue/i.test(key)).map(([key, item]) => [key, redact(item)]));
  }
  return redact(value);
}
