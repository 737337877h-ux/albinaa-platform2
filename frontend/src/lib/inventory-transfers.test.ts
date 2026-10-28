import { describe, expect, it } from 'vitest';
import type { OracleItemDetail } from './oracle-inventory';
import {
  oracleStateLabel,
  preferredTransferUnit,
  transferAvailableQuantity,
  transferStatusTone,
} from './inventory-transfers';

const item = {
  units: [
    { unitName: 'كرتون', isInactive: false, isMainUnit: true, isStockUnit: false },
    { unitName: 'حبة', isInactive: false, isMainUnit: false, isStockUnit: true },
  ],
  stockRows: [
    { unitName: 'حبة', externalWarehouseCode: '102', availableQuantity: '12', isInactive: false },
    { unitName: 'حبة', externalWarehouseCode: '102', availableQuantity: '3.5', isInactive: false },
    { unitName: 'حبة', externalWarehouseCode: '101', availableQuantity: '99', isInactive: false },
  ],
} as OracleItemDetail;

describe('inventory transfer presentation', () => {
  it('shows completed only when both Oracle effects exist', () => {
    expect(oracleStateLabel(true, true, true)).toBe('مكتمل');
    expect(oracleStateLabel(true, false, false)).toBe('صادر ولم يُستلم');
    expect(oracleStateLabel(false, false, false)).toBe('لم يصدر بعد');
  });

  it('uses warning and success tones for workflow states', () => {
    expect(transferStatusTone('pending_approval')).toBe('hazard');
    expect(transferStatusTone('approved')).toBe('credit');
    expect(transferStatusTone('rejected')).toBe('debt');
  });

  it('selects the active stock unit before the main unit', () => {
    expect(preferredTransferUnit(item)).toBe('حبة');
  });

  it('sums the selected unit balance only in the source warehouse', () => {
    expect(transferAvailableQuantity(item, '102', 'حبة')).toBe(15.5);
    expect(transferAvailableQuantity(item, '101', 'حبة')).toBe(99);
    expect(transferAvailableQuantity(item, '102', 'كرتون')).toBe(0);
  });
});
