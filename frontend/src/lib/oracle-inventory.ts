export interface OracleInventorySummary {
  snapshot: {
    runId: string;
    sourceSchema: string;
    activatedAt: string;
    extractedAt: string | null;
    validatedAt: string | null;
    publishedAt: string | null;
  };
  counts: {
    itemGroups: number;
    items: number;
    itemUnits: number;
    warehouseGroups: number;
    warehouses: number;
    stockBalances: number;
  };
  valuation: {
    totalInventoryCost: number;
    totalPrimaryQuantity: number;
    valuedRows: number;
    missingCostRows: number;
    currencyCode: 'SAR';
    basis: string;
  };
  reservationStock: {
    grossTons: number;
    reservedTons: number;
    netAvailableTons: number;
    basis: string;
    approvedItems: Array<{
      itemCode: string;
      itemName: string;
      rodsPerTon: number;
      stockRods: number;
      stockTons: number;
    }>;
  };
  movementAnalysis: {
    source: string;
    runId: string | null;
    runStatus: string | null;
    extractedAt: string | null;
    movementCount: number;
    fromDate: string | null;
    toDate: string | null;
    coverageDays: number;
    seasonalAssessment: 'reliable' | 'preliminary' | 'insufficient';
    note: string;
  };
  classificationSummary: Array<{
    type: string;
    count: number;
    stockValue: number;
    recommendedSupplyQuantity: number;
  }>;
  decisions: Array<{
    type: 'negative_stock' | 'stockout_risk' | 'reorder' | 'dead_stock' | 'slow_moving' | 'overstock' | 'seasonal_candidate' | 'fast_moving' | 'insufficient_history';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: 'high' | 'medium' | 'preliminary';
    itemCode: string;
    itemName: string;
    hasStockBalance: boolean;
    currentQuantity: number;
    stockValue: number;
    outbound30: number;
    outbound90: number;
    outbound180: number;
    outbound365: number;
    inbound90: number;
    daysOfCover: number | null;
    lastMovementAt: string | null;
    lastOutboundAt: string | null;
    activeMonths: number;
    peakMonthShare: number;
    recommendedSupplyQuantity: number;
    risk: string;
    recommendation: string;
  }>;
  decisionPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  branchMappings: Array<{
    externalBranchCode: string;
    verifiedAt: string | null;
    platformBranch: { id: string; name: string; active: boolean };
  }>;
}

export interface OracleItemGroup {
  externalGroupCode: string;
  nameAr: string;
  nameEn: string | null;
  parentExternalCode: string | null;
  sourceUpdatedAt: string | null;
  _count: { items: number };
}

export interface OracleInventoryItem {
  externalItemCode: string;
  nameAr: string;
  externalGroupCode: string;
  referencePrimaryCost: string | null;
  referenceWeightedAverageCost: string | null;
  isInactive: boolean;
  isService: boolean;
  sourceUpdatedAt: string | null;
  totalAvailablePrimaryQuantity: string;
  group: { nameAr: string; nameEn: string | null };
  _count: { units: number };
}

export interface OracleItemsResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  snapshotRunId: string;
  items: OracleInventoryItem[];
}

export interface OracleWarehouse {
  externalWarehouseCode: string;
  nameAr: string;
  nameEn: string | null;
  locationText: string | null;
  phone: string | null;
  isInactive: boolean;
  keeperName: string | null;
  externalGroupCode: string | null;
  warehouseType: number | null;
  noSale: boolean;
  checkAvailableQuantity: boolean;
  externalBranchCode: string | null;
  warehouseGroup: { nameAr: string; nameEn: string | null } | null;
  _count: { stockRows: number };
  branchMapping: {
    externalBranchCode: string;
    verifiedAt: string | null;
    platformBranch: { id: string; name: string; active: boolean };
  } | null;
}

export interface OracleWarehousesResponse {
  snapshotRunId: string;
  items: OracleWarehouse[];
}

export interface OracleStockBalance {
  externalItemCode: string;
  itemName: string;
  itemInactive: boolean;
  unitName: string;
  packageSize: string;
  externalWarehouseCode: string;
  warehouseName: string;
  externalBranchCode: string | null;
  warehouseInactive: boolean;
  externalWarehouseGroupCode: string | null;
  availableQuantity: string;
  primaryCost: string | null;
  weightedAverageCost: string | null;
  isInactive: boolean;
}

export interface OracleStockResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  snapshotRunId: string;
  items: OracleStockBalance[];
}

export interface OracleItemDetail extends Omit<OracleInventoryItem, '_count'> {
  snapshotRunId: string;
  units: Array<{
    unitName: string;
    packageSize: string;
    isMainUnit: boolean;
    isSaleUnit: boolean;
    isPurchaseUnit: boolean;
    isStockUnit: boolean;
    isPriceUnit: boolean;
    noSale: boolean;
    barcode: string | null;
    unitLevel: number | null;
    usesSerialNumber: boolean;
    isInactive: boolean;
    inactiveReason: string | null;
    salePrice: string | null;
  }>;
  stockRows: Array<{
    unitName: string;
    packageSize: string;
    externalWarehouseCode: string;
    availableQuantity: string;
    primaryCost: string | null;
    weightedAverageCost: string | null;
    isInactive: boolean;
    warehouse: { nameAr: string; externalBranchCode: string | null };
  }>;
  movements: Array<{
    id: string;
    sourceFingerprint: string;
    movementDate: string;
    documentType: string;
    billDocumentType: string | null;
    documentTypeLabelAr: string;
    documentNumber: string;
    documentSequence: string;
    unitName: string;
    packageSize: string;
    itemQuantity: string;
    freeQuantity: string;
    primaryQuantity: string;
    primaryFreeQuantity: string;
    inOut: -1 | 1;
    externalWarehouseCode: string;
    description: string | null;
    referenceNumber: string | null;
    externalCustomerCode: string | null;
    publishedAt: string;
    customer: { id: string; name: string; externalCustomerCode: string } | null;
    itemCost: string | null;
    stockCost: string | null;
    currencyCode: string | null;
  }>;
  activity: {
    status: 'demanded' | 'moving' | 'stagnant';
    labelAr: string;
    inboundPrimaryQuantity: number;
    outboundPrimaryQuantity: number;
    lastMovementAt: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    basis: string;
  };
  pricing: {
    baseUnitName: string | null;
    lastSupplyCost: string | null;
    lastSupplyPrices: Array<{ currencyCode: string; price: string; movementDate: string; unitName: string }>;
    weightedAverageCost: string | null;
    salePrice: string | null;
    salePriceUnit: string | null;
    averageSalePrice: string | null;
    lastSalePrice: string | null;
    lastSalePrices: Array<{ currencyCode: string; price: string; movementDate: string; unitName: string }>;
    averageSalePrices: Array<{ currencyCode: string; price: string; movementCount: number; unitName: string }>;
    noteAr: string;
  };
}

export function inventoryNumber(value: string | number | null | undefined, maximumFractionDigits = 4) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(number)
    : '—';
}
