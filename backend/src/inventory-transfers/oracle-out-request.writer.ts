import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OracleOutRequestDraftInput {
  externalReference: string;
  sourceWarehouseCode: string;
  destinationWarehouseCode: string;
  requestSide?: string;
  notes?: string;
  lines: Array<{ itemCode: string; unitCode: string; quantity: number }>;
}

export interface OracleOutRequestDraftResult {
  created: boolean;
  requestNo: string;
  requestSerial: string;
}

export abstract class OracleOutRequestWriter {
  abstract isEnabled(): boolean;
  abstract allowsInsufficientStock(): boolean;
  abstract targetSchema(): string | null;
  abstract createDraft(input: OracleOutRequestDraftInput): Promise<OracleOutRequestDraftResult>;
}

@Injectable()
export class OracleOutRequestHttpWriter implements OracleOutRequestWriter {
  private readonly enabled: boolean;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly readSchema: string;
  private readonly writeSchema: string;
  private readonly dedicatedIas20261: boolean;

  constructor(config: ConfigService) {
    this.readSchema = config.get<string>('ORACLE_READ_SCHEMA')?.trim().toUpperCase() || 'IAS20261';
    this.dedicatedIas20261 = config.get<string>('ORACLE_IAS20261_TRANSFER_WRITE_ENABLED') === 'true';
    if (this.dedicatedIas20261) {
      this.enabled = true;
      this.baseUrl = config.get<string>('ORACLE_IAS20261_TRANSFER_WRITE_API_URL')?.replace(/\/$/, '');
      this.apiKey = config.get<string>('ORACLE_IAS20261_TRANSFER_WRITE_API_KEY');
      this.writeSchema = config.get<string>('ORACLE_IAS20261_TRANSFER_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    } else {
      this.enabled = config.get<string>('ORACLE_WRITE_ENABLED') === 'true';
      this.baseUrl = config.get<string>('ORACLE_WRITE_API_URL')?.replace(/\/$/, '');
      this.apiKey = config.get<string>('ORACLE_WRITE_API_KEY');
      this.writeSchema = config.get<string>('ORACLE_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    }
  }

  isEnabled() { return this.enabled; }
  allowsInsufficientStock() { return this.enabled && !this.dedicatedIas20261 && this.writeSchema === 'IAS20191'; }
  targetSchema() { return this.enabled ? this.writeSchema : null; }

  async createDraft(input: OracleOutRequestDraftInput): Promise<OracleOutRequestDraftResult> {
    if (!this.enabled) throw new ServiceUnavailableException('بوابة كتابة Oracle التجريبية غير مفعلة');
    const expectedSchema = this.dedicatedIas20261 ? 'IAS20261' : 'IAS20191';
    if (this.writeSchema !== expectedSchema || this.readSchema !== this.writeSchema) {
      throw new ServiceUnavailableException(`يجب أن تتطابق بيئة القراءة والكتابة على ${expectedSchema}`);
    }
    if (!this.baseUrl || !this.apiKey) throw new ServiceUnavailableException('بوابة كتابة Oracle التجريبية غير مهيأة');
    const response = await fetch(`${this.baseUrl}/inventory/out-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new ServiceUnavailableException(`فشل إنشاء مسودة طلب التحويل (${response.status})`);
    const result = await response.json() as Partial<OracleOutRequestDraftResult>;
    if (typeof result.created !== 'boolean' || !/^\d+$/.test(result.requestNo || '') || !/^\d+$/.test(result.requestSerial || '')) {
      throw new ServiceUnavailableException('بوابة كتابة Oracle أعادت نتيجة غير صالحة');
    }
    return result as OracleOutRequestDraftResult;
  }
}
