import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OracleCustomerOrderKind = 'cash' | 'credit' | 'other';

export interface OracleCustomerOrderLine {
  lineNo: number;
  itemCode: string;
  itemName: string;
  unitCode: string | null;
  quantity: string | null;
  packageSize: string | null;
  packageQuantity: string | null;
  unitPrice: string | null;
  warehouseCode: string | null;
  vatAmount: string | null;
  otherAmount: string | null;
  cancelled: boolean;
  externalPost: boolean;
}

export interface OracleCustomerOrder {
  orderType: string | null;
  orderNo: string;
  orderSerial: string;
  orderDate: string;
  kind: OracleCustomerOrderKind;
  billDocumentType: string;
  currencyCode: string | null;
  exchangeRate: string | null;
  amount: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerAddress: string | null;
  customerCodeRequired: boolean;
  customerBindingStatus: string;
  description: string | null;
  warehouseCode: string | null;
  approved: boolean;
  processed: boolean;
  inactive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  companyNo: string | null;
  branchNo: string | null;
  branchYear: string | null;
  branchUser: string | null;
  lines: OracleCustomerOrderLine[];
}

export interface OracleCustomerOrderPage {
  mode: 'SELECT_ONLY';
  oracleWrite: 'NONE';
  schema: 'IAS20261';
  items: OracleCustomerOrder[];
  nextAfterSerial: string | null;
}

@Injectable()
export class OracleCustomerOrdersReader {
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly schema: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('ORACLE_READ_API_URL')?.trim().replace(/\/$/, '');
    this.apiKey = config.get<string>('ORACLE_READ_API_KEY')?.trim();
    this.schema = config.get<string>('ORACLE_READ_SCHEMA')?.trim().toUpperCase() || 'IAS20261';
  }

  async page(afterSerial: string | null, limit = 200): Promise<OracleCustomerOrderPage> {
    if (!this.baseUrl || !this.apiKey) {
      throw new ServiceUnavailableException('بوابة Oracle للقراءة فقط غير مهيأة');
    }
    if (this.schema !== 'IAS20261') {
      throw new ServiceUnavailableException('مزامنة طلبات العملاء مقيدة بـ IAS20261');
    }
    const query = new URLSearchParams({ schema: this.schema, kind: 'all', limit: String(limit) });
    if (afterSerial) query.set('afterSerial', afterSerial);
    const response = await fetch(`${this.baseUrl}/customer-orders?${query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(`تعذر قراءة طلبات العملاء من Oracle (${response.status})`);
    }
    const body = await response.json() as OracleCustomerOrderPage;
    if (body.mode !== 'SELECT_ONLY' || body.oracleWrite !== 'NONE' || body.schema !== 'IAS20261') {
      throw new ServiceUnavailableException('استجابة بوابة طلبات العملاء غير آمنة');
    }
    return body;
  }

  async get(serial: string): Promise<OracleCustomerOrder> {
    if (!this.baseUrl || !this.apiKey || this.schema !== 'IAS20261' || !/^\d{1,38}$/.test(serial)) throw new ServiceUnavailableException('قارئ طلبات Oracle غير مهيأ');
    const response = await fetch(`${this.baseUrl}/customer-orders/${serial}?schema=IAS20261`, {
      headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new ServiceUnavailableException('تعذر جلب الطلب المحفوظ');
    const body = await response.json();
    if (body.schema !== 'IAS20261' || body.mode !== 'SELECT_ONLY' || body.oracleWrite !== 'NONE'
      || body.item?.orderSerial !== serial || !Array.isArray(body.item.lines)) throw new ServiceUnavailableException('استجابة قراءة الطلب غير صالحة');
    return body.item;
  }
}
