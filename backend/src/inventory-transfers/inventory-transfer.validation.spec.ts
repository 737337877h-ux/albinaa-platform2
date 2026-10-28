import { validateStockLine } from './inventory-transfer.validation';

describe('inventory transfer validation', () => {
  it('accepts an existing item/unit with sufficient source stock', () => {
    expect(validateStockLine(1, 5, { warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 5 })).toEqual([]);
  });

  it('blocks approval when source stock is insufficient', () => {
    const issues = validateStockLine(2, 10, { warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 3 });
    expect(issues).toEqual([expect.objectContaining({ code: 'INSUFFICIENT_SOURCE_STOCK', severity: 'error', lineNo: 2 })]);
  });

  it('keeps insufficient stock as a warning for a YemenSoft draft request', () => {
    const issues = validateStockLine(1, 1, {
      warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 0,
    }, true);
    expect(issues).toEqual([expect.objectContaining({ code: 'INSUFFICIENT_SOURCE_STOCK', severity: 'warning' })]);
  });

  it('reports item, unit and warehouse failures independently', () => {
    const codes = validateStockLine(1, 1, { warehouseExists: false, itemExists: false, unitExists: false, packageSize: null, availableQuantity: 0 }).map((issue) => issue.code);
    expect(codes).toEqual(['ITEM_NOT_FOUND', 'UNIT_NOT_FOUND', 'SOURCE_WAREHOUSE_NOT_FOUND', 'INSUFFICIENT_SOURCE_STOCK']);
  });

  it('rejects a unit whose P_SIZE is missing or invalid', () => {
    const issues = validateStockLine(1, 1, { warehouseExists: true, itemExists: true, unitExists: true, packageSize: null, availableQuantity: 10 });
    expect(issues).toEqual([expect.objectContaining({ code: 'INVALID_PACKAGE_SIZE' })]);
  });
});
