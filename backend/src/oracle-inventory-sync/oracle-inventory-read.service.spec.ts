import { Prisma } from '@prisma/client';
import { summarizeMovementPricing, summarizeOracleMovementValuation } from './oracle-inventory-read.service';

describe('INVI008 item pricing summary', () => {
  it('values all warehouses 101 through 104 from signed Oracle stock cost movements', () => {
    const movement = (warehouse: string, inOut: number, quantity: number, cost: number | null) => ({
      externalWarehouseCode: warehouse, inOut,
      itemQuantity: new Prisma.Decimal(quantity),
      stockCost: cost == null ? null : new Prisma.Decimal(cost),
    });
    expect(summarizeOracleMovementValuation([
      movement('101', 1, 10, 2), movement('102', 1, 5, 3),
      movement('103', -1, 2, 4), movement('104', 1, 1, 9),
      movement('105', 1, 1000, 1000), movement('101', 1, 1, null),
    ])).toEqual({ totalInventoryCost: 36, valuedRows: 4, missingCostRows: 1 });
  });

  it('keeps last and average sale prices separated by currency', () => {
    const movements = [
      { id: 'yer-new', movementDate: new Date('2026-09-02'), inOut: -1, itemQuantity: new Prisma.Decimal(2), primaryQuantity: new Prisma.Decimal(2), unitName: 'حبة' },
      { id: 'yer-old', movementDate: new Date('2026-09-01'), inOut: -1, itemQuantity: new Prisma.Decimal(1), primaryQuantity: new Prisma.Decimal(1), unitName: 'حبة' },
      { id: 'sar-sale', movementDate: new Date('2026-08-31'), inOut: -1, itemQuantity: new Prisma.Decimal(5), primaryQuantity: new Prisma.Decimal(5), unitName: 'حبة' },
      { id: 'supply', movementDate: new Date('2026-08-30'), inOut: 1, itemQuantity: new Prisma.Decimal(5), primaryQuantity: new Prisma.Decimal(5), unitName: 'حبة' },
    ];
    const sources = new Map([
      ['yer-new', { itemCost: new Prisma.Decimal(900), stockCost: null, currencyCode: 'YER' }],
      ['yer-old', { itemCost: new Prisma.Decimal(600), stockCost: null, currencyCode: 'YER' }],
      ['sar-sale', { itemCost: new Prisma.Decimal(4), stockCost: null, currencyCode: 'SAR' }],
      ['supply', { itemCost: new Prisma.Decimal(3), stockCost: null, currencyCode: 'SAR' }],
    ]);

    const result = summarizeMovementPricing(movements, sources);

    expect(result.lastSalePrices).toEqual([
      expect.objectContaining({ currencyCode: 'YER', price: '900' }),
      expect.objectContaining({ currencyCode: 'SAR', price: '4' }),
    ]);
    expect(result.averageSalePrices).toEqual([
      expect.objectContaining({ currencyCode: 'YER', price: '800' }),
      expect.objectContaining({ currencyCode: 'SAR', price: '4' }),
    ]);
    expect(result.lastSupplyPrices).toEqual([
      expect.objectContaining({ currencyCode: 'SAR', price: '3' }),
    ]);
  });

  it('normalizes supply and sale prices to the automatic base unit', () => {
    const movements = [
      { id: 'bundle-sale', movementDate: new Date('2026-09-02'), inOut: -1, itemQuantity: new Prisma.Decimal(2), primaryQuantity: new Prisma.Decimal(20), packageSize: new Prisma.Decimal(10), unitName: 'بندل' },
      { id: 'piece-sale', movementDate: new Date('2026-09-01'), inOut: -1, itemQuantity: new Prisma.Decimal(10), primaryQuantity: new Prisma.Decimal(10), packageSize: new Prisma.Decimal(1), unitName: 'حبة' },
      { id: 'bundle-supply', movementDate: new Date('2026-08-30'), inOut: 1, itemQuantity: new Prisma.Decimal(1), primaryQuantity: new Prisma.Decimal(10), packageSize: new Prisma.Decimal(10), unitName: 'بندل' },
    ];
    const sources = new Map([
      ['bundle-sale', { itemCost: new Prisma.Decimal(1000), stockCost: null, currencyCode: 'SAR' }],
      ['piece-sale', { itemCost: new Prisma.Decimal(80), stockCost: null, currencyCode: 'SAR' }],
      ['bundle-supply', { itemCost: new Prisma.Decimal(700), stockCost: null, currencyCode: 'SAR' }],
    ]);

    const result = summarizeMovementPricing(movements, sources, { unitName: 'حبة', packageSize: 1 });

    expect(result.lastSalePrices[0]).toEqual(expect.objectContaining({ price: '100', unitName: 'حبة' }));
    expect(result.averageSalePrices[0]).toEqual(expect.objectContaining({ price: '93.333333333333', unitName: 'حبة' }));
    expect(result.lastSupplyPrices[0]).toEqual(expect.objectContaining({ price: '70', unitName: 'حبة' }));
  });
});
