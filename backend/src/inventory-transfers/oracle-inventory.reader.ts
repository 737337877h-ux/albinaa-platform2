import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OracleStockSnapshot {
  warehouseExists: boolean;
  itemExists: boolean;
  unitExists: boolean;
  packageSize: number | null;
  availableQuantity: number;
}

export interface OracleTransferStatus {
  outReqSer: string | null;
  transferDocumentNumber: string | null;
  sourceTransferSerial: string | null;
  destinationTransferSerial: string | null;
  sourceIssued: boolean;
  destinationReceived: boolean;
  transferCompleted: boolean;
  diagnostics?: OracleTransferDiagnostics;
}

export interface OracleTransferDiagnostics {
  sourceTrPost: number | null;
  sourceStkProcessed: number | null;
  sourcePostDate: string | null;
}

export interface OracleTransferEvidence {
  source: {
    transferSerial: string;
    transferDocumentNumber: string | null;
    warehouseCode: string;
    destinationWarehouseCode: string;
    trPost: number | null;
    stkProcessed: number | null;
    postDate: string | null;
  } | null;
  destinationDocuments: Array<{
    transferSerial: string;
    sourceTransferSerial: string;
    warehouseCode: string;
  }>;
  movements: Array<{
    documentSerial: string;
    documentType: number;
    itemCode: string;
    warehouseCode: string;
  }>;
}

export interface OracleTransferLookup {
  sourceTransferSerial: string;
  sourceWarehouseCode: string;
  destinationWarehouseCode: string;
  itemCodes: string[];
}

export function transferStatusFromEvidence(evidence: OracleTransferEvidence, requestedItemCodes: string[]): OracleTransferStatus | null {
  const source = evidence.source;
  if (!source) return null;
  const itemCodes = [...new Set(requestedItemCodes)];
  const sourceIssued = itemCodes.length > 0 && itemCodes.every((itemCode) => evidence.movements.some((movement) =>
    movement.documentSerial === source.transferSerial
      && movement.documentType === 7
      && movement.itemCode === itemCode
      && movement.warehouseCode === source.warehouseCode));
  const destination = evidence.destinationDocuments.find((document) =>
    document.transferSerial !== source.transferSerial
      && document.sourceTransferSerial === source.transferSerial
      && document.warehouseCode === source.destinationWarehouseCode
      && itemCodes.every((itemCode) => evidence.movements.some((movement) =>
        movement.documentSerial === document.transferSerial
          && movement.documentType === 8
          && movement.itemCode === itemCode
          && movement.warehouseCode === source.destinationWarehouseCode)));
  const destinationReceived = Boolean(destination);
  return {
    outReqSer: null,
    transferDocumentNumber: source.transferDocumentNumber,
    sourceTransferSerial: source.transferSerial,
    destinationTransferSerial: destination?.transferSerial ?? null,
    sourceIssued,
    destinationReceived,
    transferCompleted: sourceIssued && destinationReceived,
    diagnostics: {
      sourceTrPost: source.trPost,
      sourceStkProcessed: source.stkProcessed,
      sourcePostDate: source.postDate,
    },
  };
}

export abstract class OracleInventoryReader {
  abstract warehouseExists(code: string): Promise<boolean>;
  abstract stock(warehouseCode: string, itemCode: string, unitCode: string): Promise<OracleStockSnapshot>;
  abstract transferStatus(lookup: OracleTransferLookup): Promise<OracleTransferStatus | null>;
}

/**
 * Adapter for a separately deployed, SELECT-only Oracle gateway. It deliberately
 * exposes GET requests only; this backend has no Oracle write method or driver.
 */
@Injectable()
export class ReadOnlyOracleHttpReader implements OracleInventoryReader {
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly schema: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('ORACLE_READ_API_URL')?.replace(/\/$/, '');
    this.apiKey = config.get<string>('ORACLE_READ_API_KEY');
    this.schema = config.get<string>('ORACLE_READ_SCHEMA')?.trim() || 'IAS20261';
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException('بوابة Oracle للقراءة فقط غير مهيأة');
    }
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${this.baseUrl}${path}${separator}schema=${encodeURIComponent(this.schema)}`, {
      method: 'GET',
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(`فشل استعلام Oracle للقراءة فقط (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  async warehouseExists(code: string) {
    const result = await this.get<{ exists: boolean }>(`/inventory/warehouses/${encodeURIComponent(code)}`);
    return result.exists;
  }

  stock(warehouseCode: string, itemCode: string, unitCode: string) {
    const query = new URLSearchParams({ warehouseCode, itemCode, unitCode });
    return this.get<OracleStockSnapshot>(`/inventory/stock?${query.toString()}`);
  }

  async transferStatus(lookup: OracleTransferLookup) {
    const query = new URLSearchParams({
      sourceTransferSerial: lookup.sourceTransferSerial,
      sourceWarehouseCode: lookup.sourceWarehouseCode,
      destinationWarehouseCode: lookup.destinationWarehouseCode,
      itemCodes: lookup.itemCodes.join(','),
    });
    const evidence = await this.get<OracleTransferEvidence>(`/inventory/transfers/evidence?${query.toString()}`);
    return transferStatusFromEvidence(evidence, lookup.itemCodes);
  }
}
