import { OracleStockSnapshot } from './oracle-inventory.reader';

export interface TransferValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  lineNo?: number;
  message: string;
}

export function validateStockLine(
  lineNo: number,
  quantity: number,
  snapshot: OracleStockSnapshot,
): TransferValidationIssue[] {
  const issues: TransferValidationIssue[] = [];
  if (!snapshot.itemExists) issues.push({ code: 'ITEM_NOT_FOUND', severity: 'error', lineNo, message: 'الصنف غير موجود في Oracle' });
  if (!snapshot.unitExists) issues.push({ code: 'UNIT_NOT_FOUND', severity: 'error', lineNo, message: 'الوحدة غير معتمدة للصنف' });
  if (snapshot.unitExists && (snapshot.packageSize === null || snapshot.packageSize <= 0)) {
    issues.push({ code: 'INVALID_PACKAGE_SIZE', severity: 'error', lineNo, message: 'حجم العبوة P_SIZE غير صالح للوحدة' });
  }
  if (!snapshot.warehouseExists) issues.push({ code: 'SOURCE_WAREHOUSE_NOT_FOUND', severity: 'error', lineNo, message: 'المستودع المصدر غير موجود' });
  if (snapshot.availableQuantity < quantity) {
    issues.push({
      code: 'INSUFFICIENT_SOURCE_STOCK', severity: 'error', lineNo,
      message: `رصيد المصدر غير كافٍ: المتاح ${snapshot.availableQuantity} والمطلوب ${quantity}`,
    });
  }
  return issues;
}
