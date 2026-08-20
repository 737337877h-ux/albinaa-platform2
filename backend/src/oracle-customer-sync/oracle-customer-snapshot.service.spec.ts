import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OracleCustomerSnapshotService, OracleCustomerSnapshotValidationError } from './oracle-customer-snapshot.service';

const csv = (headers: string[], values: string[]) => `${headers.map((value) => `"${value}"`).join(',')}\n${values.map((value) => `"${value}"`).join(',')}\n`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('OracleCustomerSnapshotService', () => {
  let directory: string;
  const service = new OracleCustomerSnapshotService();

  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oracle-customers-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  async function fixture(controlDifference = '0'): Promise<void> {
    const files: Record<string, string> = {
      customers: csv(
        ['C_CODE', 'C_A_CODE', 'C_A_NAME', 'C_PHONE', 'C_MOBILE', 'C_ADDRESS', 'R_CODE', 'LATITUDE', 'LONGITUDE', 'C_SINCE', 'INACTIVE', 'CONN_BRN_NO', 'COL_NO', 'AD_DATE', 'UP_DATE'],
        ['30724', '112101001', 'عميل اختبار', '', '', 'صنعاء', '1', '', '', '2020-01-01', '1', '1', '', '2020-01-01 10:00:00', ''],
      ),
      customer_currencies: csv(['C_CODE', 'A_CY', 'INACTIVE', 'CR_LIMIT', 'INV_LIMIT'], ['30724', 'YR', '0', '0', '0']),
      customer_balances: csv(
        ['C_CODE', 'A_CY', 'TRANSACTION_COUNT', 'OPENING_DEBIT_LOCAL', 'OPENING_CREDIT_LOCAL', 'BALANCE_LOCAL', 'OPENING_DEBIT_FOREIGN', 'OPENING_CREDIT_FOREIGN', 'BALANCE_FOREIGN', 'FIRST_TRANSACTION_DATE', 'LAST_TRANSACTION_DATE'],
        ['30724', 'YR', '2', '10', '0', '5', '1400', '0', '700', '2026-01-01', '2026-01-02'],
      ),
      control_reconciliation: csv(
        ['A_CODE', 'A_CY', 'CUSTOMER_COUNT', 'CUSTOMER_BALANCE_LOCAL', 'CRNT_BLNC_L', 'DIFFERENCE_LOCAL', 'CUSTOMER_BALANCE_FOREIGN', 'CRNT_BLNC_F', 'DIFFERENCE_FOREIGN'],
        ['112101001', 'YR', '1', '5', '5', controlDifference, '700', '700', '0'],
      ),
      control_totals: csv(['CUSTOMERS', 'CUSTOMER_CURRENCIES', 'CUSTOMER_BALANCES', 'TRANSACTION_ROWS'], ['1', '1', '1', '2']),
    };
    const names: Record<string, string> = {
      customers: 'customers.csv', customer_currencies: 'customer_currencies.csv', customer_balances: 'customer_balances.csv',
      control_reconciliation: 'control_reconciliation.csv', control_totals: 'control_totals.csv',
    };
    const entries: Array<{ name: string; file: string; rows: number; sha256: string }> = [];
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(directory, names[name]), content, 'utf8');
      entries.push({ name, file: names[name], rows: 1, sha256: hash(content) });
    }
    const manifest = { contractVersion: '1.0', mode: 'oracle-customers-read-only-snapshot', generatedAtUtc: '2026-08-15T12:00:00.000Z', source: { alias: 'YEMENSOFT', schema: 'IAS20261', transactionMode: 'READ ONLY' }, files: entries };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  }

  it('accepts a complete read-only snapshot and preserves both balance bases', async () => {
    await fixture();
    const result = await service.inspect(directory);
    expect(result.sourceCounts).toEqual({ customers: 1, customer_currencies: 1, customer_balances: 1, transaction_rows: 2 });
    expect(result.customers[0]).toMatchObject({ externalCustomerCode: '30724', isInactive: true });
    expect(result.customerBalances[0]).toMatchObject({ balanceLocal: '5', balanceForeign: '700' });
    expect(result.validationSummary).toMatchObject({ passed: true, controlReconciliationPassed: true });
  });

  it('rejects a non-zero control-account difference', async () => {
    await fixture('1');
    await expect(service.inspect(directory)).rejects.toBeInstanceOf(OracleCustomerSnapshotValidationError);
  });

  it('rejects a file changed after the manifest was created', async () => {
    await fixture();
    await fs.appendFile(path.join(directory, 'customers.csv'), 'tampered');
    await expect(service.inspect(directory)).rejects.toThrow('SHA-256 mismatch');
  });
});
