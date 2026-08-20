import { Prisma } from '@prisma/client';
import { OracleMovementAutoPublicationService } from './oracle-movement-auto-publication.service';

const decimal = (value: string | number) => new Prisma.Decimal(value);

describe('OracleMovementAutoPublicationService safety classification', () => {
  const service = new OracleMovementAutoPublicationService({} as never);

  const customer = (overrides: Record<string, unknown> = {}) => ({
    id: 'row-1',
    source_fingerprint: 'a'.repeat(64),
    source_hash: 'b'.repeat(64),
    external_customer_code: '30001',
    currency_code: 'YR',
    document_date: new Date('2026-08-16T00:00:00.000Z'),
    document_type: '4',
    document_jv_type: null,
    document_number: '5001',
    description: 'new sale',
    reference_number: null,
    customer_id: '00000000-0000-0000-0000-000000000001',
    customer_status: 'active',
    platform_currency: 'YER',
    platform_debit: decimal(1000),
    platform_credit: decimal(0),
    document_type_id: '00000000-0000-0000-0000-000000000002',
    currency_exists: true,
    source_group_debit: decimal(1000),
    source_group_credit: decimal(0),
    platform_rows: 0n,
    platform_group_debit: decimal(0),
    platform_group_credit: decimal(0),
    ...overrides,
  });

  const inventory = (overrides: Record<string, unknown> = {}) => ({
    id: 'inventory-1',
    source_fingerprint: 'c'.repeat(64),
    source_hash: 'd'.repeat(64),
    movement_date: new Date('2026-08-16T00:00:00.000Z'),
    document_type: '1',
    document_number: '5001',
    document_sequence: '1',
    serial_number: '1',
    external_item_code: '10001',
    unit_name: 'حبة',
    package_size: decimal(1),
    item_quantity: decimal(2),
    free_quantity: decimal(0),
    primary_quantity: decimal(2),
    primary_free_quantity: decimal(0),
    in_out: -1,
    external_warehouse_code: '101',
    external_warehouse_group_code: null,
    description: 'new issue',
    reference_number: null,
    barcode: null,
    external_customer_code: null,
    item_exists: true,
    unit_exists: true,
    warehouse_exists: true,
    existing_business_rows: 0n,
    existing_package_size: null,
    existing_item_quantity: null,
    existing_free_quantity: null,
    existing_primary_quantity: null,
    existing_primary_free_quantity: null,
    existing_in_out: null,
    existing_warehouse_group_code: null,
    existing_description: null,
    existing_reference_number: null,
    existing_barcode: null,
    ...overrides,
  });

  it('publishes a genuinely new customer movement after the cutoff', () => {
    const result = (service as never as { classifyCustomer(rows: unknown[], cutoff: string): Array<{ action: string }> })
      .classifyCustomer([customer()], '2026-08-16');
    expect(result[0].action).toBe('publish');
  });

  it('publishes a newly discovered historical movement with an explicit reason', () => {
    const result = (service as never as { classifyCustomer(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyCustomer([customer({ document_date: new Date('2026-08-15T00:00:00.000Z') })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'publish', reasonCode: 'historical_after_baseline_published' });
  });

  it('ignores the same business key when the aggregate amount is identical', () => {
    const result = (service as never as { classifyCustomer(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyCustomer([customer({ platform_rows: 1n, platform_group_debit: decimal(1000) })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'ignore', reasonCode: 'already_exists_same_business_key_and_amount' });
  });

  it('publishes Oracle amount for the same business key as a documented replacement', () => {
    const result = (service as never as { classifyCustomer(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyCustomer([customer({ platform_rows: 1n, platform_group_debit: decimal(900) })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'publish', reasonCode: 'oracle_amount_override_published' });
  });

  it('quarantines a movement for an unknown customer', () => {
    const result = (service as never as { classifyCustomer(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyCustomer([customer({ customer_id: null })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'quarantine', reasonCode: 'unknown_customer' });
  });

  it('publishes a valid new inventory movement', () => {
    const result = (service as never as { classifyInventory(rows: unknown[], cutoff: string): Array<{ action: string }> })
      .classifyInventory([inventory()], '2026-08-16');
    expect(result[0].action).toBe('publish');
  });

  it('quarantines inventory for an item missing from the published snapshot', () => {
    const result = (service as never as { classifyInventory(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyInventory([inventory({ item_exists: false })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'quarantine', reasonCode: 'unknown_item_in_active_snapshot' });
  });

  it('ignores an existing inventory key when only descriptive metadata changed', () => {
    const result = (service as never as { classifyInventory(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyInventory([inventory({
        existing_business_rows: 1n,
        existing_package_size: decimal(1),
        existing_item_quantity: decimal(2),
        existing_free_quantity: decimal(0),
        existing_primary_quantity: decimal(2),
        existing_primary_free_quantity: decimal(0),
        existing_in_out: -1,
        existing_warehouse_group_code: null,
        existing_description: 'old issue',
      })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'ignore', reasonCode: 'already_exists_same_inventory_impact' });
  });

  it('publishes an existing inventory key revision with a documented replacement', () => {
    const result = (service as never as { classifyInventory(rows: unknown[], cutoff: string): Array<{ action: string; reasonCode: string }> })
      .classifyInventory([inventory({
        existing_business_rows: 1n,
        existing_package_size: decimal(1),
        existing_item_quantity: decimal(3),
        existing_free_quantity: decimal(0),
        existing_primary_quantity: decimal(3),
        existing_primary_free_quantity: decimal(0),
        existing_in_out: -1,
        existing_warehouse_group_code: null,
      })], '2026-08-16');
    expect(result[0]).toMatchObject({ action: 'publish', reasonCode: 'oracle_inventory_revision_published' });
  });
});
