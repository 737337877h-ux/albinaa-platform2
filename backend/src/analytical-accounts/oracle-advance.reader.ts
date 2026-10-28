import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const ADVANCE_SOURCE_ACCOUNTS = ['113101001', '113101002'] as const;

interface OracleAdvanceRawRow {
  sourceAccountCode: string;
  accountNumber: string;
  nameAr: string;
  nameEn: string | null;
  analyticalType: number;
  currencyCode: string | null;
  amountLocal: number;
  amountForeign: number;
}

interface OracleAdvanceResponse {
  mode: string;
  oracleWrite: string;
  schema: string;
  sourceAccountCodes: string[];
  items: OracleAdvanceRawRow[];
}

export interface OracleAdvanceAccount {
  sourceAccountCode: string;
  accountNumber: string;
  nameAr: string;
  analyticalType: number;
  currencyCode: 'YER' | 'SAR' | 'USD' | null;
  balance: number;
  amountLocal: number;
  amountForeign: number;
  balanceBasis: 'local' | 'foreign' | 'none';
}

export function platformCurrency(value: string | null): OracleAdvanceAccount['currencyCode'] {
  const code = value?.trim().toUpperCase();
  if (!code) return null;
  if (code === 'YR' || code === 'YER') return 'YER';
  if (code === 'SR' || code === 'SAR') return 'SAR';
  if (code === '$' || code === 'USD') return 'USD';
  return null;
}

export function normalizeOracleAdvance(row: OracleAdvanceRawRow): OracleAdvanceAccount {
  const currencyCode = platformCurrency(row.currencyCode);
  const balanceBasis = currencyCode === 'SAR' ? 'local' : currencyCode ? 'foreign' : 'none';
  const balance = balanceBasis === 'local'
    ? Number(row.amountLocal || 0)
    : balanceBasis === 'foreign' ? Number(row.amountForeign || 0) : 0;
  return {
    sourceAccountCode: String(row.sourceAccountCode),
    accountNumber: String(row.accountNumber),
    nameAr: String(row.nameAr || row.accountNumber).trim(),
    analyticalType: Number(row.analyticalType),
    currencyCode,
    balance,
    amountLocal: Number(row.amountLocal || 0),
    amountForeign: Number(row.amountForeign || 0),
    balanceBasis,
  };
}

@Injectable()
export class OracleAdvanceReader {
  constructor(private readonly config: ConfigService) {}

  async read(): Promise<{ schema: 'IAS20261'; accounts: OracleAdvanceAccount[] }> {
    const baseUrl = this.config.get<string>('ORACLE_READ_API_URL')?.trim().replace(/\/$/, '');
    const apiKey = this.config.get<string>('ORACLE_READ_API_KEY')?.trim();
    const schema = (this.config.get<string>('ORACLE_READ_SCHEMA') ?? 'IAS20261').trim().toUpperCase();
    if (!baseUrl || !apiKey) throw new ServiceUnavailableException('بوابة قراءة أوراكل غير مهيأة');
    if (schema !== 'IAS20261') throw new ServiceUnavailableException('مزامنة السلف مقيدة بقاعدة IAS20261');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/accounting/advances?schema=IAS20261`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new BadGatewayException('تعذر الاتصال ببوابة قراءة حسابات السلف');
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 500 && body.includes('ORA-00942')) {
        throw new ServiceUnavailableException('يلزم منح ALBINAA_RO صلاحية قراءة GLS_V_AC_DTL_CCPJACTV_BLNC');
      }
      throw new BadGatewayException(`تعذر قراءة حسابات السلف من أوراكل (${response.status})`);
    }
    const payload = await response.json() as OracleAdvanceResponse;
    if (payload.mode !== 'SELECT_ONLY' || payload.oracleWrite !== 'NONE' || payload.schema !== 'IAS20261') {
      throw new BadGatewayException('بوابة حسابات السلف لم تؤكد وضع القراءة الآمنة');
    }
    if (ADVANCE_SOURCE_ACCOUNTS.some((code) => !payload.sourceAccountCodes.includes(code))) {
      throw new BadGatewayException('استجابة حسابات السلف لا تحتوي نطاق الحسابات المعتمد');
    }
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.some(row =>
      (row.currencyCode != null && !platformCurrency(row.currencyCode))
      || !ADVANCE_SOURCE_ACCOUNTS.includes(row.sourceAccountCode as typeof ADVANCE_SOURCE_ACCOUNTS[number])
      || !Number.isFinite(Number(row.amountLocal)) || !Number.isFinite(Number(row.amountForeign)))) {
      throw new BadGatewayException('استجابة حسابات السلف غير مكتملة أو تحتوي عملة غير مدعومة');
    }
    return { schema: 'IAS20261', accounts: payload.items.map(normalizeOracleAdvance) };
  }
}
