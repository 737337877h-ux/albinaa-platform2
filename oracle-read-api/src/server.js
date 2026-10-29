'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const oracledb = require('oracledb');
const { loadConfig, resolveSchema } = require('./config');
const { OracleReadPool } = require('./oracle');
const queries = require('./queries');
const quotationQueries = require('./quotations');
const { accountStatementQuery } = require('./account-statement');
const { hrStatementQuery } = require('./hr-statement');

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function authorized(request, expectedKeys) {
  const prefix = 'Bearer ';
  const header = request.headers.authorization || '';
  if (!header.startsWith(prefix)) return false;
  const received = Buffer.from(header.slice(prefix.length));
  const keys = expectedKeys instanceof Set ? expectedKeys : new Set([expectedKeys]);
  return [...keys].some((key) => {
    const expected = Buffer.from(key);
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
}

function requiredParam(url, name, pattern, maxLength = 80) {
  const value = url.searchParams.get(name)?.trim();
  if (!value || value.length > maxLength || (pattern && !pattern.test(value))) {
    throw new RequestError(`Invalid ${name}`);
  }
  return value;
}

class RequestError extends Error {}

function mapSource(row) {
  if (!row) return null;
  return {
    transferSerial: row.TRANSFER_SERIAL,
    transferDocumentNumber: row.TRANSFER_DOCUMENT_NUMBER ?? null,
    warehouseCode: row.WAREHOUSE_CODE,
    destinationWarehouseCode: row.DESTINATION_WAREHOUSE_CODE,
    trPost: row.TR_POST ?? null,
    stkProcessed: row.STK_PROCESSED ?? null,
    postDate: row.POST_DATE ?? null,
  };
}

const flag = (value) => Number(value || 0) !== 0;
const decimal = (value) => value == null ? null : String(value);
const platformCurrency = (value) => {
  const code = String(value ?? '').trim().toUpperCase();
  if (code === 'YR' || code === 'YER') return 'YER';
  if (code === 'SR' || code === 'SAR') return 'SAR';
  if (code === '$' || code === 'US$' || code === 'USD') return 'USD';
  return code || null;
};
const compareCodeAscending = (left, right) => String(left).localeCompare(String(right), 'en', {
  numeric: true,
  sensitivity: 'base',
});

const requestAccountHierarchy = {
  IAS20191: {
    cashboxes: new Set(['111101001', '111101002']),
    banks: new Set(['111202001']),
    employees: new Set(['116101001']),
    vendors: new Set(['211101001', '211102001']),
    debtors: new Set(),
    creditors: new Set(),
    custodies: new Set(),
    accountGroups: new Map(),
  },
  IAS20261: {
    cashboxes: new Set(['111101001', '111101002']),
    banks: new Set(['111202001', '111202002', '111202003', '111202004', '111202005', '111202006', '111202007']),
    employees: new Set(['116101001']),
    vendors: new Set(['211101001', '211102001']),
    debtors: new Set(['113101001', '113101002']),
    creditors: new Set(),
    custodies: new Set(['116201001']),
    accountGroups: new Map([
      ['113101001', 'السلف'], ['113101002', 'السلف'], ['116201001', 'العهد'],
    ]),
  },
};

const platformJournalMainAccounts = {
  IAS20261: new Set(['312401001']),
};

const ias20191ConfirmedPartyLinks = {
  vendors: new Map([
    ['10001', { accountCode: '211101001', analyticalType: 4 }],
    ['20001', { accountCode: '211102001', analyticalType: 4 }],
  ]),
  employees: new Map([
    ['1', { accountCode: '116101001', analyticalType: 7 }],
  ]),
};

function requestCatalogResponse(schema, purpose, oracleUserId, rows) {
  const hierarchy = requestAccountHierarchy[schema];
  const ias20191CustomerAccountCode = '112101001';
  const ias20191CustomerAnalyticalType = 3;
  const permissionField = purpose === 'receipt' ? 'RECEIPT_ALLOWED' : 'PAYMENT_ALLOWED';
  const accountNames = new Map(rows.accounts.map((row) => [String(row.CODE), row.NAME_AR]));
  const accountAnalyticalTypes = new Map(rows.accounts.map((row) => [String(row.CODE), Number(row.ANALYTICAL_TYPE)]));
  const currencyMap = (currencyRows, keyName) => {
    const result = new Map();
    for (const row of currencyRows) {
      const key = String(row[keyName]);
      const currencyCode = String(row.CURRENCY_CODE);
      if (!result.has(key)) result.set(key, new Set());
      result.get(key).add(currencyCode);
    }
    return new Map([...result].map(([key, values]) => [key, [...values].sort(compareCodeAscending)]));
  };
  const accountCurrencies = currencyMap(rows.accountCurrencies, 'ACCOUNT_CODE');
  const customerCurrencies = currencyMap(rows.customerCurrencies, 'CODE');
  const linksByCode = new Map();
  for (const row of rows.analyticalAccounts) {
    const code = String(row.CODE);
    const link = {
      accountCode: String(row.ACCOUNT_CODE),
      accountName: accountNames.get(String(row.ACCOUNT_CODE)) ?? String(row.ACCOUNT_CODE),
      ...(hierarchy?.accountGroups.has(String(row.ACCOUNT_CODE))
        ? { accountGroupNameAr: hierarchy.accountGroups.get(String(row.ACCOUNT_CODE)) }
        : {}),
      analyticalAccountCode: code,
      analyticalAccountName: row.NAME_AR ?? code,
      analyticalType: Number(row.ANALYTICAL_TYPE),
      currencyCodes: accountCurrencies.get(String(row.ACCOUNT_CODE)) ?? [],
    };
    if (!linksByCode.has(code)) linksByCode.set(code, []);
    linksByCode.get(code).push(link);
  }
  const party = (row) => {
    const links = linksByCode.get(String(row.CODE)) ?? [];
    const masterAccountCode = row.MASTER_ACCOUNT_CODE == null ? null : String(row.MASTER_ACCOUNT_CODE);
    const preferred = masterAccountCode == null
      ? links
      : links.filter((link) => link.accountCode === masterAccountCode);
    const analyticalType = masterAccountCode == null ? null : accountAnalyticalTypes.get(masterAccountCode);
    const resolvedLinks = masterAccountCode == null
      ? links
      : preferred.length > 0
        ? preferred
        : Number.isSafeInteger(analyticalType)
          ? [{
              accountCode: masterAccountCode,
              accountName: accountNames.get(masterAccountCode) ?? masterAccountCode,
              analyticalAccountCode: String(row.CODE),
              analyticalAccountName: row.NAME_AR ?? String(row.CODE),
              analyticalType,
              currencyCodes: accountCurrencies.get(masterAccountCode) ?? [],
            }]
          : [];
    return {
      code: String(row.CODE), nameAr: row.NAME_AR ?? String(row.CODE), nameEn: row.NAME_EN ?? null,
      phone: row.PHONE ?? null,
      linkedAccounts: resolvedLinks,
    };
  };
  const confirmedIas20191Link = (category, row) => {
    if (schema !== 'IAS20191') return null;
    const confirmed = ias20191ConfirmedPartyLinks[category]?.get(String(row.CODE));
    if (!confirmed) return null;
    return {
      accountCode: confirmed.accountCode,
      accountName: accountNames.get(confirmed.accountCode) ?? confirmed.accountCode,
      analyticalAccountCode: String(row.CODE),
      analyticalAccountName: row.NAME_AR ?? String(row.CODE),
      analyticalType: confirmed.analyticalType,
      currencyCodes: accountCurrencies.get(confirmed.accountCode) ?? [],
    };
  };
  const collectors = rows.collectors.map((row) => ({
    code: String(row.CODE), nameAr: row.NAME_AR ?? String(row.CODE), nameEn: row.NAME_EN ?? null,
    accountCode: row.ACCOUNT_CODE == null ? null : String(row.ACCOUNT_CODE),
    analyticalAccountCode: row.ANALYTICAL_ACCOUNT_CODE == null ? null : String(row.ANALYTICAL_ACCOUNT_CODE),
    analyticalType: row.ANALYTICAL_TYPE == null ? null : Number(row.ANALYTICAL_TYPE),
    commissionPercent: row.COMMISSION_PERCENT == null ? null : Number(row.COMMISSION_PERCENT),
  }));
  const collectorByCode = new Map(collectors.map((row) => [row.code, row]));
  const customers = rows.customers.map((row) => {
    const customer = party(schema === 'IAS20191'
      ? { ...row, MASTER_ACCOUNT_CODE: ias20191CustomerAccountCode }
      : row);
    if (schema === 'IAS20191') {
      customer.linkedAccounts = customer.linkedAccounts
        .filter((link) => link.accountCode === ias20191CustomerAccountCode);
    }
    if (schema === 'IAS20191' && customer.linkedAccounts.length === 0) {
      customer.linkedAccounts = [{
        accountCode: ias20191CustomerAccountCode,
        accountName: accountNames.get(ias20191CustomerAccountCode) ?? ias20191CustomerAccountCode,
        analyticalAccountCode: String(row.CODE),
        analyticalAccountName: row.NAME_AR ?? String(row.CODE),
        analyticalType: ias20191CustomerAnalyticalType,
        currencyCodes: customerCurrencies.get(String(row.CODE)) ?? [],
      }];
    }
    const configuredCurrencies = customerCurrencies.get(String(row.CODE)) ?? [];
    customer.linkedAccounts = customer.linkedAccounts.map((link) => ({
      ...link,
      currencyCodes: configuredCurrencies,
    }));
    return {
      ...customer,
      assignedCollector: row.COLLECTOR_CODE == null ? null : (collectorByCode.get(String(row.COLLECTOR_CODE)) ?? {
      code: String(row.COLLECTOR_CODE), nameAr: row.COLLECTOR_NAME ?? String(row.COLLECTOR_CODE),
      nameEn: null, accountCode: null, analyticalAccountCode: null, analyticalType: null,
      commissionPercent: row.COMMISSION_PERCENT == null ? null : Number(row.COMMISSION_PERCENT),
      }),
    };
  }).sort((left, right) => compareCodeAscending(left.code, right.code));
  const vendors = rows.vendors.map((row) => {
    const vendor = party(row);
    const confirmedLink = confirmedIas20191Link('vendors', row);
    return {
      ...vendor,
      linkedAccounts: confirmedLink ? [confirmedLink] : vendor.linkedAccounts
        .filter((link) => hierarchy?.vendors.has(link.accountCode)),
    };
  }).sort((left, right) => compareCodeAscending(left.code, right.code));
  const employeeMasterAccount = hierarchy?.employees.size === 1 ? [...hierarchy.employees][0] : null;
  const employees = rows.employees.map((row) => {
    const employee = party(employeeMasterAccount
      ? { ...row, MASTER_ACCOUNT_CODE: employeeMasterAccount }
      : row);
    const confirmedLink = confirmedIas20191Link('employees', row);
    return {
      ...employee,
      linkedAccounts: confirmedLink ? [confirmedLink] : employee.linkedAccounts
        .filter((link) => hierarchy?.employees.has(link.accountCode)),
    };
  }).sort((left, right) => compareCodeAscending(left.code, right.code));
  const assignedLinkKeys = new Set([...customers, ...vendors, ...employees].flatMap((row) =>
    row.linkedAccounts.map((link) => `${link.accountCode}|${link.analyticalAccountCode}`)));
  const unassignedRows = rows.analyticalAccounts.filter((row) =>
    !assignedLinkKeys.has(`${String(row.ACCOUNT_CODE)}|${String(row.CODE)}`));
  const genericParties = (accountCodes, inverted = false, candidateRows = unassignedRows) => {
    const selected = candidateRows.filter((row) =>
      inverted !== accountCodes.has(String(row.ACCOUNT_CODE)));
    const codes = [...new Set(selected.map((row) => String(row.CODE)))]
      .sort(compareCodeAscending);
    return codes.map((code) => {
      const selectedAccounts = new Set(selected
        .filter((row) => String(row.CODE) === code)
        .map((row) => String(row.ACCOUNT_CODE)));
      const row = selected.find((candidate) => String(candidate.CODE) === code);
      return {
        code, nameAr: row?.NAME_AR ?? code, nameEn: row?.NAME_EN ?? null,
        phone: row?.PHONE ?? null,
        linkedAccounts: (linksByCode.get(code) ?? [])
          .filter((link) => selectedAccounts.has(link.accountCode)),
      };
    });
  };
  const categorizedAccounts = new Set([
    ...(hierarchy?.banks ?? []),
    ...(hierarchy?.debtors ?? []),
    ...(hierarchy?.creditors ?? []),
    ...(hierarchy?.custodies ?? []),
  ]);
  const locations = (items, accountCodes) => items
    .filter((row) => flag(row[permissionField]))
    .filter((row) => !accountCodes?.size || accountCodes.has(String(row.ACCOUNT_CODE)))
    .map((row) => ({
      code: String(row.CODE), nameAr: row.NAME_AR ?? String(row.CODE), nameEn: row.NAME_EN ?? null,
      accountCode: row.ACCOUNT_CODE == null ? null : String(row.ACCOUNT_CODE),
      currencyCodes: row.ACCOUNT_CODE == null ? [] : (accountCurrencies.get(String(row.ACCOUNT_CODE)) ?? []),
    }))
    .sort((left, right) => compareCodeAscending(left.code, right.code));
  const bankAccounts = locations(rows.banks, hierarchy?.banks)
    .filter((row) => row.accountCode && Number.isSafeInteger(accountAnalyticalTypes.get(row.accountCode)))
    .map((row) => ({
      code: row.code,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      phone: null,
      linkedAccounts: [{
        accountCode: row.accountCode,
        accountName: accountNames.get(row.accountCode) ?? row.accountCode,
        accountGroupNameAr: 'حسابات البنوك',
        analyticalAccountCode: row.code,
        analyticalAccountName: row.nameAr,
        analyticalType: accountAnalyticalTypes.get(row.accountCode),
        currencyCodes: accountCurrencies.get(row.accountCode) ?? [],
      }],
    }));
  const mainAccountParties = rows.accounts
    .filter((row) => platformJournalMainAccounts[schema]?.has(String(row.CODE)))
    .filter((row) => Number(row.ANALYTICAL_TYPE) === 0)
    .map((row) => ({
      code: String(row.CODE),
      nameAr: row.NAME_AR ?? String(row.CODE),
      nameEn: null,
      phone: null,
      linkedAccounts: [{
        accountCode: String(row.CODE),
        accountName: row.NAME_AR ?? String(row.CODE),
        accountGroupNameAr: 'حسابات القيود العامة',
        analyticalAccountCode: '',
        analyticalAccountName: 'دون حساب تحليلي',
        analyticalType: 0,
        currencyCodes: accountCurrencies.get(String(row.CODE)) ?? [],
      }],
    }));
  return {
    mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema, purpose, oracleUserId,
    currencyMapping: rows.currencyMapping ?? { complete: true, missingSources: [] },
    cashboxes: locations(rows.cashboxes, hierarchy?.cashboxes),
    banks: locations(rows.banks, hierarchy?.banks),
    accountHierarchy: {
      cashboxes: [...(hierarchy?.cashboxes ?? [])], banks: [...(hierarchy?.banks ?? [])],
      employees: [...(hierarchy?.employees ?? [])], vendors: [...(hierarchy?.vendors ?? [])],
      debtors: [...(hierarchy?.debtors ?? [])],
      creditors: [...(hierarchy?.creditors ?? [])],
      custodies: [...(hierarchy?.custodies ?? [])],
    },
    collectors,
    parties: {
      customers, vendors, employees,
      debtors: genericParties(hierarchy?.debtors ?? new Set(), false, rows.analyticalAccounts),
      creditors: genericParties(hierarchy?.creditors ?? new Set(), false, rows.analyticalAccounts),
      custodies: genericParties(hierarchy?.custodies ?? new Set(), false, rows.analyticalAccounts),
      bank_accounts: bankAccounts,
      other: [...mainAccountParties, ...genericParties(categorizedAccounts, true)]
        .sort((left, right) => compareCodeAscending(left.code, right.code)),
    },
  };
}

function requirePilotSchema(schema) {
  if (schema !== 'IAS20191') throw new RequestError('Direct test lookups are restricted to IAS20191');
}

function createdRequest(row) {
  const inactive = flag(row.INACTIVE);
  const masterApproved = Number(row.MASTER_APPROVED || 0);
  const approvalCode = row.APPROVAL_CODE == null ? null : Number(row.APPROVAL_CODE);
  const status = inactive ? 'inactive'
    : masterApproved === 1 || approvalCode === 1 ? 'approved'
      : approvalCode != null && approvalCode < 0 ? 'rejected'
        : 'pending_approval';
  return {
    kind: row.REQUEST_KIND,
    requestNo: row.REQUEST_NO,
    requestSerial: row.REQUEST_SERIAL,
    description: row.DESCRIPTION ?? null,
    collectorNo: row.COLLECTOR_NO == null ? null : String(row.COLLECTOR_NO),
    platformCustomerCode: row.PLATFORM_CUSTOMER_CODE == null ? null : String(row.PLATFORM_CUSTOMER_CODE),
    status,
    masterApproved,
    inactive,
    createdAt: row.CREATED_AT ?? null,
    approval: row.APPROVAL_LEVEL == null ? null : {
      level: Number(row.APPROVAL_LEVEL),
      code: approvalCode,
      userId: row.APPROVAL_USER_ID ?? null,
      date: row.APPROVAL_DATE ?? null,
      description: row.APPROVAL_DESCRIPTION ?? null,
    },
  };
}

function inventoryCountResponse(schema, masterRow, typeRow, detailRows) {
  const packageSize = (row) => row.PACKAGE_SIZE == null ? null : Number(row.PACKAGE_SIZE);
  const lines = detailRows.map((row) => {
    const proven = packageSize(row) === 1;
    const counted = row.COUNTED_QUANTITY == null ? null : Number(row.COUNTED_QUANTITY);
    const available = row.AVAILABLE_QUANTITY == null ? null : Number(row.AVAILABLE_QUANTITY);
    return {
      lineNo: Number(row.LINE_NUMBER),
      itemCode: row.ITEM_CODE,
      itemNameAr: row.ITEM_NAME_AR ?? row.ITEM_CODE,
      itemNameEn: row.ITEM_NAME_EN ?? null,
      unitCode: row.UNIT_CODE,
      warehouseCode: row.WAREHOUSE_CODE,
      countedQuantity: decimal(row.COUNTED_QUANTITY),
      packageSize: decimal(row.PACKAGE_SIZE),
      packageQuantity: decimal(row.PACKAGE_QUANTITY),
      availableQuantity: decimal(row.AVAILABLE_QUANTITY),
      differenceQuantity: proven && counted != null && available != null ? decimal(counted - available) : null,
      conversionProven: proven,
      processedAdjustment: flag(row.PROCESSED_ADJUSTMENT),
    };
  });
  return {
    mode: 'SELECT_ONLY',
    oracleWrite: 'NONE',
    schema,
    inventoryType: typeRow ? {
      code: String(typeRow.INVENTORY_TYPE),
      nameAr: typeRow.NAME_AR ?? String(typeRow.INVENTORY_TYPE),
      nameEn: typeRow.NAME_EN ?? null,
      addAllowed: flag(typeRow.ADD_ALLOWED),
      viewAllowed: flag(typeRow.VIEW_ALLOWED),
    } : null,
    document: masterRow ? {
      number: masterRow.INVENTORY_NUMBER,
      type: masterRow.INVENTORY_TYPE,
      serial: masterRow.INVENTORY_SERIAL,
      date: masterRow.INVENTORY_DATE ?? null,
      description: masterRow.DESCRIPTION ?? null,
      annual: flag(masterRow.ANNUAL),
      processed: flag(masterRow.PROCESSED),
      externalPost: flag(masterRow.EXTERNAL_POST),
      branchNo: masterRow.BRANCH_NUMBER == null ? null : Number(masterRow.BRANCH_NUMBER),
      branchYear: masterRow.BRANCH_YEAR == null ? null : Number(masterRow.BRANCH_YEAR),
      companyNo: masterRow.COMPANY_NUMBER == null ? null : Number(masterRow.COMPANY_NUMBER),
    } : null,
    lines,
  };
}

function customerOrderKind(documentType) {
  if (String(documentType) === '1') return 'cash';
  if (String(documentType) === '4') return 'credit';
  return 'other';
}

function customerOrderLine(row) {
  return {
    lineNo: Number(row.LINE_NO), itemCode: String(row.ITEM_CODE),
    itemName: row.ITEM_NAME ?? String(row.ITEM_CODE), unitCode: row.UNIT_CODE ?? null,
    quantity: decimal(row.QUANTITY), packageSize: decimal(row.PACKAGE_SIZE),
    packageQuantity: decimal(row.PACKAGE_QUANTITY), unitPrice: decimal(row.UNIT_PRICE),
    warehouseCode: row.WAREHOUSE_CODE == null ? null : String(row.WAREHOUSE_CODE),
    vatAmount: decimal(row.VAT_AMOUNT), otherAmount: decimal(row.OTHER_AMOUNT),
    cancelled: flag(row.CANCELED), externalPost: flag(row.EXTERNAL_POST),
  };
}

function customerOrderResponse(row, lines) {
  const kind = customerOrderKind(row.BILL_DOCUMENT_TYPE);
  const customerCode = row.CUSTOMER_CODE == null ? null : String(row.CUSTOMER_CODE);
  const customerName = row.CUSTOMER_NAME?.trim() || null;
  const customerBindingStatus = kind === 'credit'
    ? customerCode ? 'linked_by_code' : 'missing_required_code'
    : customerCode ? 'optional_code_present' : customerName ? 'cash_name_only' : 'missing_name';
  return {
    orderType: row.SALES_ORDER_TYPE == null ? null : String(row.SALES_ORDER_TYPE),
    orderNo: String(row.ORDER_NO), orderSerial: String(row.ORDER_SERIAL), orderDate: row.ORDER_DATE ?? null,
    kind, billDocumentType: String(row.BILL_DOCUMENT_TYPE), currencyCode: row.CURRENCY_CODE ?? null,
    exchangeRate: decimal(row.EXCHANGE_RATE), amount: decimal(row.ORDER_AMOUNT),
    customerCode, customerName, customerMobile: row.CUSTOMER_MOBILE ?? null,
    customerAddress: row.CUSTOMER_ADDRESS ?? null, customerCodeRequired: kind === 'credit',
    customerBindingStatus, description: row.DESCRIPTION ?? null,
    warehouseCode: row.WAREHOUSE_CODE == null ? null : String(row.WAREHOUSE_CODE),
    approved: flag(row.APPROVED), processed: flag(row.PROCESSED), inactive: flag(row.INACTIVE),
    createdAt: row.CREATED_AT ?? null, updatedAt: row.UPDATED_AT ?? null,
    companyNo: row.COMPANY_NO == null ? null : String(row.COMPANY_NO),
    branchNo: row.BRANCH_NO == null ? null : String(row.BRANCH_NO),
    branchYear: row.BRANCH_YEAR == null ? null : String(row.BRANCH_YEAR),
    branchUser: row.BRANCH_USER == null ? null : String(row.BRANCH_USER),
    lines,
  };
}

function createHandler(config, db) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, {
          status: 'ok', mode: 'SELECT_ONLY', schema: config.schema,
          capabilities: [
            'request-catalog', 'accounting-currencies', 'created-requests',
            'inventory-lookups', 'transfer-validation', 'customer-orders',
          ],
        });
      }
      if (!authorized(request, config.apiKeys ?? config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method !== 'GET') return json(response, 405, { message: 'Only GET is allowed' });
      const schema = resolveSchema(config, url.searchParams.get('schema'));

      if (url.pathname === '/hr/statement') {
        let query;
        try { query = hrStatementQuery(schema, Object.fromEntries(url.searchParams)); }
        catch (error) { throw new RequestError(error.message); }
        const result = await db.select(query.sql, query.binds);
        if (!result.rows?.length) throw new Error('Missing HR statement summary');
        if (Number(result.rows[0].TOTAL) > 5000) return json(response, 422, { message: 'كشف الموظف يتجاوز 5000 حركة؛ لم تُرسل بيانات جزئية' });
        return json(response, 200, { mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          source: 'IAS_POST_DTL', coverageStart: '2026-10-01', coverageEnd: '2026-12-31',
          readAt: new Date().toISOString(), rows: result.rows });
      }

      if (url.pathname === '/accounting/statement') {
        let query;
        try {
          query = accountStatementQuery(schema, Object.fromEntries(url.searchParams));
        } catch (error) { throw new RequestError(error.message); }
        const result = await db.select(query.sql, query.binds);
        if (!result.rows?.length) throw new Error('Missing statement summary');
        if (Number(result.rows[0].TOTAL) > 5000) {
          return json(response, 422, { message: 'الفترة تحتوي أكثر من 5000 حركة؛ اختر فترة أقصر، وسيبقى الرصيد الافتتاحي محسوبًا من كامل التاريخ.' });
        }
        return json(response, 200, { mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          source: 'IAS_V_POST_DTL_YR', coverageStart: '2020-01-01', coverageEnd: '2026-12-31',
          readAt: new Date().toISOString(), rows: result.rows });
      }

      if (url.pathname === '/health/compatibility') {
        const check = queries.compatibility(schema);
        const result = await db.select(check.sql, check.binds);
        const actual = new Map();
        for (const row of result.rows) {
          if (!actual.has(row.TABLE_NAME)) actual.set(row.TABLE_NAME, new Set());
          actual.get(row.TABLE_NAME).add(row.COLUMN_NAME);
        }
        const missing = Object.entries(check.required).flatMap(([table, columns]) =>
          columns.filter((column) => !actual.get(table)?.has(column)).map((column) => `${table}.${column}`));
        return json(response, missing.length ? 503 : 200, { compatible: missing.length === 0, schema, missing });
      }

      if (url.pathname === '/quotations' || /^\/quotations\/\d{1,38}$/.test(url.pathname)) {
        if (schema !== 'IAS20261') throw new RequestError('Quotations require IAS20261');
        const serial = url.pathname.split('/')[2];
        const envelope = { mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema };
        if (serial) {
          const query = quotationQueries.quotationLines(serial);
          const result = await db.select(query.sql, query.binds);
          return json(response, 200, { ...envelope, lines: result.rows });
        }
        const limit = Number(url.searchParams.get('limit') || 25);
        let query;
        try {
          query = quotationQueries.quotationList({ limit,
            search: url.searchParams.get('search') || '',
            afterSerial: url.searchParams.get('afterSerial') || null });
        } catch (error) { throw new RequestError(error.message); }
        const result = await db.select(query.sql, query.binds);
        const items = result.rows.slice(0, limit);
        return json(response, 200, { ...envelope, items,
          nextAfterSerial: result.rows.length > limit ? items.at(-1).SERIAL : null });
      }

      if (url.pathname === '/customer-orders/metadata') {
        if (schema !== 'IAS20261') throw new RequestError('Customer-order reading is restricted to IAS20261');
        const check = queries.customerOrdersMetadata(schema);
        const result = await db.select(check.sql, check.binds);
        const tables = Object.fromEntries(['SALES_ORDER', 'ORDER_DETAIL'].map((tableName) => [
          tableName,
          result.rows.filter((row) => row.TABLE_NAME === tableName),
        ]));
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema, tables,
        });
      }

      if (url.pathname === '/customer-orders/profile') {
        if (schema !== 'IAS20261') throw new RequestError('Customer-order reading is restricted to IAS20261');
        const result = await db.select(queries.customerOrdersProfile(schema));
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          documentTypes: result.rows.map((row) => ({
            billDocumentType: String(row.BILL_DOCUMENT_TYPE),
            orderCount: Number(row.ORDER_COUNT || 0),
            withoutCustomerCode: Number(row.WITHOUT_CUSTOMER_CODE || 0),
            withCustomerCode: Number(row.WITH_CUSTOMER_CODE || 0),
            withoutCustomerName: Number(row.WITHOUT_CUSTOMER_NAME || 0),
            firstOrderDate: row.FIRST_ORDER_DATE ?? null,
            lastOrderDate: row.LAST_ORDER_DATE ?? null,
          })),
        });
      }

      if (url.pathname === '/customer-orders') {
        if (schema !== 'IAS20261') throw new RequestError('Customer-order reading is restricted to IAS20261');
        const kind = url.searchParams.get('kind')?.trim() || 'all';
        if (!['all', 'cash', 'credit'].includes(kind)) throw new RequestError('Invalid customer-order kind');
        const afterSerial = url.searchParams.get('afterSerial')?.trim() || null;
        if (afterSerial && !/^\d{1,38}$/.test(afterSerial)) throw new RequestError('Invalid afterSerial');
        const limit = Number(url.searchParams.get('limit') || 200);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RequestError('limit must be between 1 and 200');
        const search = url.searchParams.get('search')?.trim() || null;
        if (search && search.length > 100) throw new RequestError('search is too long');
        const masterQuery = queries.customerOrders(schema, { kind, afterSerial, limit, search });
        const masters = await db.select(masterQuery.sql, masterQuery.binds);
        const serials = masters.rows.map((row) => String(row.ORDER_SERIAL));
        const detailQuery = queries.customerOrderDetails(schema, serials);
        const details = detailQuery ? await db.select(detailQuery.sql, detailQuery.binds) : { rows: [] };
        const linesBySerial = new Map();
        for (const row of details.rows) {
          const serial = String(row.ORDER_SERIAL);
          if (!linesBySerial.has(serial)) linesBySerial.set(serial, []);
          linesBySerial.get(serial).push(customerOrderLine(row));
        }
        const items = masters.rows.map((row) => customerOrderResponse(
          row, linesBySerial.get(String(row.ORDER_SERIAL)) ?? [],
        ));
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema, items,
          nextAfterSerial: items.length === limit ? items.at(-1)?.orderSerial ?? null : null,
        });
      }

      const customerOrderMatch = url.pathname.match(/^\/customer-orders\/(\d{1,38})$/);
      if (customerOrderMatch) {
        if (schema !== 'IAS20261') throw new RequestError('Customer-order reading is restricted to IAS20261');
        const orderSerial = customerOrderMatch[1];
        const masterQuery = queries.customerOrders(schema, { exactSerial: orderSerial, limit: 1 });
        const master = await db.select(masterQuery.sql, masterQuery.binds);
        if (!master.rows[0]) return json(response, 404, { message: 'Customer order not found' });
        const detailQuery = queries.customerOrderDetails(schema, [orderSerial]);
        const details = await db.select(detailQuery.sql, detailQuery.binds);
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          item: customerOrderResponse(master.rows[0], details.rows.map(customerOrderLine)),
        });
      }

      if (url.pathname === '/health/transfer-draft-readiness') {
        if (schema !== 'IAS20261') throw new RequestError('Transfer draft readiness is restricted to IAS20261');
        const check = queries.transferDraftReadiness(schema);
        const [columns, objects] = await Promise.all([
          db.select(check.columns, check.columnBinds),
          db.select(check.objects, check.objectBinds),
        ]);
        const actual = new Map();
        for (const row of columns.rows) {
          if (!actual.has(row.TABLE_NAME)) actual.set(row.TABLE_NAME, new Set());
          actual.get(row.TABLE_NAME).add(row.COLUMN_NAME);
        }
        const missing = Object.entries(check.required).flatMap(([table, names]) =>
          names.filter((name) => !actual.get(table)?.has(name)).map((name) => `${table}.${name}`));
        const objectSet = new Set(objects.rows.map((row) => `${row.OBJECT_NAME}:${row.OBJECT_TYPE}:${row.STATUS}`));
        const requiredObjects = [
          'IAS_OUT_REQUEST_MST:TABLE:VALID',
          'IAS_OUT_REQUEST_DTL:TABLE:VALID',
          'S_APPRVD_MOV:TABLE:VALID',
          'IAS_DOC_SEQ_OTHR:SEQUENCE:VALID',
        ];
        const missingObjects = requiredObjects.filter((name) => !objectSet.has(name));
        return json(response, missing.length || missingObjects.length ? 503 : 200, {
          compatible: missing.length === 0 && missingObjects.length === 0,
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema, missing, missingObjects,
          columns: columns.rows,
          objects: objects.rows,
        });
      }

      if (url.pathname === '/accounting/currencies') {
        const result = await db.select(queries.currencies(schema), {});
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          currencies: result.rows.map((row) => ({
            number: String(row.CUR_NO), code: row.CUR_CODE, nameAr: row.CUR_NAME,
            nameEn: row.CUR_E_NAME, rate: String(row.CUR_RATE), local: Number(row.L_F) === 1,
            stockCurrency: Number(row.STOCK_CUR) === 1,
            minRate: row.MIN_CUR_RATE == null ? null : String(row.MIN_CUR_RATE),
            maxRate: row.MAX_CUR_RATE == null ? null : String(row.MAX_CUR_RATE),
            fractionDigits: Number(row.CUR_FRC_NO), rateUpdatedAt: row.RATE_UPDATED_AT,
          })),
        });
      }

      if (url.pathname === '/accounting/advances') {
        if (schema !== 'IAS20261') throw new RequestError('Advance-account reads are restricted to IAS20261');
        const result = await db.select(queries.advanceAccounts(schema), {});
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          sourceAccountCodes: ['113101001', '113101002'],
          items: result.rows.map((row) => ({
            sourceAccountCode: String(row.ACCOUNT_CODE),
            accountNumber: String(row.CODE),
            nameAr: row.NAME_AR,
            nameEn: row.NAME_EN ?? null,
            analyticalType: Number(row.ANALYTICAL_TYPE),
            currencyCode: row.CURRENCY_CODE,
            amountLocal: Number(row.AMOUNT_LOCAL || 0),
            amountForeign: Number(row.AMOUNT_FOREIGN || 0),
          })),
        });
      }

      if (url.pathname === '/requests/catalog') {
        const purpose = requiredParam(url, 'purpose', /^(receipt|payment)$/);
        const oracleUserId = Number(requiredParam(url, 'oracleUserId', /^\d{1,9}$/));
        const branchNo = Number(requiredParam(url, 'branchNo', /^\d{1,9}$/));
        const hierarchy = requestAccountHierarchy[schema];
        const prioritizedAccountCodes = [
          ...(schema === 'IAS20191' ? ['112101001'] : []),
          ...(hierarchy?.employees ?? []),
          ...(hierarchy?.vendors ?? []),
          ...(hierarchy?.banks ?? []),
          ...(hierarchy?.debtors ?? []),
          ...(hierarchy?.creditors ?? []),
          ...(hierarchy?.custodies ?? []),
        ];
        const sql = queries.requestCatalog(schema, prioritizedAccountCodes);
        const [cashboxes, banks, collectors, customers, vendors, employees, accounts, analyticalAccounts] = await Promise.all([
          db.select(sql.cashboxes, { oracleUserId, branchNo }),
          db.select(sql.banks, { oracleUserId, branchNo }),
          db.select(sql.collectors, { oracleUserId }),
          db.select(sql.customers, { branchNo }),
          db.select(sql.vendors, { branchNo }),
          db.select(sql.employees, { branchNo }),
          db.select(sql.accounts, {}),
          db.select(sql.analyticalAccounts, { branchNo }),
        ]);
        const missingCurrencySources = [];
        const optionalCurrencySelect = async (statement, source) => {
          try { return await db.select(statement, {}); }
          catch (error) {
            if (Number(error?.errorNum) !== 942) throw error;
            missingCurrencySources.push(source);
            return { rows: [] };
          }
        };
        const [customerCurrencies, accountCurrencies] = await Promise.all([
          optionalCurrencySelect(sql.customerCurrencies, 'CUSTOMER_CURR'),
          optionalCurrencySelect(sql.accountCurrencies, 'ACCOUNT_CURR'),
        ]);
        const result = requestCatalogResponse(schema, purpose, oracleUserId, {
          cashboxes: cashboxes.rows, banks: banks.rows, collectors: collectors.rows,
          customers: customers.rows, vendors: vendors.rows, employees: employees.rows,
          accounts: accounts.rows, analyticalAccounts: analyticalAccounts.rows,
          customerCurrencies: customerCurrencies.rows, accountCurrencies: accountCurrencies.rows,
          currencyMapping: { complete: missingCurrencySources.length === 0, missingSources: missingCurrencySources.sort() },
        });
        return json(response, 200, result);
      }

      if (url.pathname === '/requests/created') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
        if (!Number.isInteger(limit)) throw new RequestError('Invalid limit');
        const kind = url.searchParams.get('kind')?.trim() || '';
        if (schema === 'IAS20261') {
          if (!['purchase', 'receipt', 'payment', 'journal', 'inventory_count', 'inventory_transfer'].includes(kind)) {
            throw new RequestError('IAS20261 created-request lookup is restricted to supported request kinds');
          }
        } else {
          requirePilotSchema(schema);
        }
        const sql = queries.createdRequests(schema);
        const statementByKind = {
          purchase: sql.purchases,
          receipt: sql.vouchers,
          payment: sql.vouchers,
          voucher: sql.vouchers,
          journal: sql.journals,
          inventory_count: sql.inventoryCounts,
          inventory_transfer: sql.inventoryTransfers,
        };
        if (kind && !Object.prototype.hasOwnProperty.call(statementByKind, kind)) {
          throw new RequestError('Invalid request kind');
        }
        const statements = kind ? [statementByKind[kind]] : Object.values(sql);
        const results = await Promise.all(statements.map((statement) => db.select(statement, { rowLimit: limit })));
        const items = results.flatMap((result) => result.rows.map(createdRequest))
          .filter((item) => !['receipt', 'payment'].includes(kind) || item.kind === kind)
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
          .slice(0, limit);
        return json(response, 200, { mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema, items });
      }

      const purchaseRequestMatch = url.pathname.match(/^\/requests\/purchases\/(\d{1,30})$/);
      if (purchaseRequestMatch) {
        if (schema !== 'IAS20261') throw new RequestError('Purchase readback is restricted to IAS20261');
        const requestSerial = purchaseRequestMatch[1];
        const sql = queries.purchaseRequest(schema);
        const [master, details, approval] = await Promise.all([
          db.select(sql.master, { requestSerial }),
          db.select(sql.details, { requestSerial }),
          db.select(sql.approval, { requestSerial }),
        ]);
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          request: master.rows[0] ?? null,
          lines: details.rows,
          approvals: approval.rows,
        });
      }

      const receiptRequestMatch = url.pathname.match(/^\/requests\/receipts\/(\d{1,30})$/);
      if (receiptRequestMatch) {
        if (schema !== 'IAS20261') throw new RequestError('Receipt readback is restricted to IAS20261');
        const requestSerial = receiptRequestMatch[1];
        const sql = queries.voucherRequest(schema);
        const [master, details, approval] = await Promise.all([
          db.select(sql.master, { requestSerial }),
          db.select(sql.details, { requestSerial }),
          db.select(sql.approval, { requestSerial }),
        ]);
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          request: master.rows[0] ?? null,
          lines: details.rows,
          approvals: approval.rows,
        });
      }

      const paymentRequestMatch = url.pathname.match(/^\/requests\/payments\/(\d{1,30})$/);
      if (paymentRequestMatch) {
        if (schema !== 'IAS20261') throw new RequestError('Payment readback is restricted to IAS20261');
        const requestSerial = paymentRequestMatch[1];
        const sql = queries.voucherRequest(schema, 2);
        const [master, details, approval] = await Promise.all([
          db.select(sql.master, { requestSerial }),
          db.select(sql.details, { requestSerial }),
          db.select(sql.approval, { requestSerial }),
        ]);
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          request: master.rows[0] ?? null,
          lines: details.rows,
          approvals: approval.rows,
        });
      }

      const journalRequestMatch = url.pathname.match(/^\/requests\/journals\/(\d{1,30})$/);
      if (journalRequestMatch) {
        if (schema !== 'IAS20261') throw new RequestError('Journal readback is restricted to IAS20261');
        const requestSerial = journalRequestMatch[1];
        const sql = queries.journalRequest(schema);
        const [master, details, approval] = await Promise.all([
          db.select(sql.master, { requestSerial }),
          db.select(sql.details, { requestSerial }),
          db.select(sql.approval, { requestSerial }),
        ]);
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          request: master.rows[0] ?? null,
          lines: details.rows,
          approvals: approval.rows,
        });
      }

      const inventoryTransferMatch = url.pathname.match(/^\/requests\/inventory-transfers\/(\d{1,30})$/);
      if (inventoryTransferMatch) {
        if (schema !== 'IAS20261') throw new RequestError('Inventory-transfer readback is restricted to IAS20261');
        const requestSerial = inventoryTransferMatch[1];
        const sql = queries.inventoryTransferRequest(schema);
        const [master, details, approval] = await Promise.all([
          db.select(sql.master, { requestSerial }),
          db.select(sql.details, { requestSerial }),
          db.select(sql.approval, { requestSerial }),
        ]);
        return json(response, 200, {
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema,
          request: master.rows[0] || null,
          lines: details.rows,
          approvals: approval.rows,
        });
      }

      const inventoryCountMatch = url.pathname.match(/^\/inventory\/counts\/(\d+)$/);
      if (inventoryCountMatch) {
        if (!['IAS20191', 'IAS20261'].includes(schema)) throw new RequestError('Inventory-count readback is restricted to IAS20191 or IAS20261');
        const documentNo = Number(inventoryCountMatch[1]);
        const inventoryType = Number(requiredParam(url, 'inventoryType', /^\d{1,9}$/));
        const branchNo = Number(requiredParam(url, 'branchNo', /^\d{1,9}$/));
        const branchYear = Number(requiredParam(url, 'branchYear', /^\d{4}$/));
        const oracleUserId = Number(requiredParam(url, 'oracleUserId', /^\d{1,9}$/));
        if (![documentNo, inventoryType, branchNo, branchYear, oracleUserId].every(Number.isSafeInteger)) {
          throw new RequestError('Invalid inventory count parameters');
        }
        const sql = queries.inventoryCount(schema);
        const [master, inventoryTypeResult] = await Promise.all([
          db.select(sql.master, { documentNo, inventoryType, branchNo, branchYear }),
          db.select(sql.type, { oracleUserId, inventoryType }),
        ]);
        const masterRow = master.rows[0] ?? null;
        const details = masterRow
          ? await db.select(sql.details, {
            inventorySerial: masterRow.INVENTORY_SERIAL, inventoryType, branchNo, branchYear,
          })
          : { rows: [] };
        return json(response, 200, inventoryCountResponse(
          schema, masterRow, inventoryTypeResult.rows[0] ?? null, details.rows,
        ));
      }

      if (url.pathname === '/inventory/warehouses') {
        const result = await db.select(queries.warehouses(schema), {});
        return json(response, 200, {
          snapshotRunId: `live:${schema}`,
          items: result.rows.map((row) => ({
            externalWarehouseCode: row.WAREHOUSE_CODE, nameAr: row.NAME_AR, nameEn: row.NAME_EN ?? null,
            locationText: row.LOCATION_TEXT ?? null, phone: row.PHONE ?? null, isInactive: flag(row.INACTIVE),
            keeperName: row.KEEPER_NAME ?? null, externalGroupCode: row.GROUP_CODE ?? null,
            warehouseType: row.WAREHOUSE_TYPE == null ? null : Number(row.WAREHOUSE_TYPE), noSale: flag(row.NO_SALE),
            checkAvailableQuantity: flag(row.CHECK_AVAILABLE_QUANTITY), externalBranchCode: row.BRANCH_CODE ?? null,
            warehouseGroup: null, _count: { stockRows: 0 }, branchMapping: null,
          })),
        });
      }

      if (url.pathname === '/inventory/items/labels') {
        const itemCodes = requiredParam(url, 'itemCodes', null, 8000).split(',');
        const query = queries.itemLabels(schema, itemCodes);
        const result = query ? await db.select(query.sql, query.binds) : { rows: [] };
        return json(response, 200, result.rows.map((row) => ({ externalItemCode: row.ITEM_CODE, nameAr: row.NAME_AR })));
      }

      if (url.pathname === '/inventory/items') {
        const search = url.searchParams.get('search')?.trim() || '';
        if (search.length > 100) throw new RequestError('Invalid search');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20), 1), 20);
        if (!Number.isInteger(limit)) throw new RequestError('Invalid limit');
        const query = queries.items(schema, search, limit);
        const { rowLimit: _rowLimit, ...searchBinds } = query.binds;
        const [count, rows] = await Promise.all([
          db.select(query.count, searchBinds),
          db.select(query.rows, query.binds),
        ]);
        const total = Number(count.rows[0]?.TOTAL || 0);
        return json(response, 200, {
          page: 1, limit, total, totalPages: Math.ceil(total / limit), snapshotRunId: `live:${schema}`,
          items: rows.rows.map((row) => ({
            externalItemCode: row.ITEM_CODE, nameAr: row.NAME_AR, externalGroupCode: row.GROUP_CODE ?? '',
            referencePrimaryCost: decimal(row.PRIMARY_COST), referenceWeightedAverageCost: decimal(row.WEIGHTED_AVERAGE_COST),
            isInactive: false, isService: flag(row.SERVICE_ITEM), sourceUpdatedAt: row.SOURCE_UPDATED_AT ?? null,
            group: { nameAr: '', nameEn: null }, _count: { units: Number(row.UNIT_COUNT || 0) },
          })),
        });
      }

      const itemMatch = url.pathname.match(/^\/inventory\/items\/([^/]+)$/);
      if (itemMatch) {
        const itemCode = decodeURIComponent(itemMatch[1]).trim();
        if (!itemCode || itemCode.length > 80) throw new RequestError('Invalid itemCode');
        const query = queries.item(schema);
        const [details, units, stock, movements] = await Promise.all([
          db.select(query.details, { itemCode }), db.select(query.units, { itemCode }),
          db.select(query.stock, { itemCode }), db.select(query.movements, { itemCode }),
        ]);
        const row = details.rows[0];
        if (!row) return json(response, 404, { message: 'Item not found' });
        const salePriceByUnit = new Map();
        for (const balance of stock.rows) {
          if (balance.SALE_PRICE != null && !salePriceByUnit.has(String(balance.UNIT_NAME))) {
            salePriceByUnit.set(String(balance.UNIT_NAME), decimal(balance.SALE_PRICE));
          }
        }
        const mappedMovements = movements.rows.map((movement) => ({
          id: `${movement.DOCUMENT_SERIAL}:${movement.DOCUMENT_SEQUENCE}`,
          sourceFingerprint: `${movement.DOCUMENT_SERIAL}:${movement.DOCUMENT_SEQUENCE}`,
          movementDate: movement.MOVEMENT_DATE,
          documentType: movement.DOCUMENT_TYPE,
          documentNumber: movement.DOCUMENT_NUMBER,
          documentSequence: movement.DOCUMENT_SEQUENCE,
          unitName: movement.UNIT_NAME,
          packageSize: '1', itemQuantity: decimal(movement.ITEM_QUANTITY) ?? '0', freeQuantity: '0',
          primaryQuantity: decimal(movement.PRIMARY_QUANTITY) ?? '0', primaryFreeQuantity: '0',
          itemCost: decimal(movement.ITEM_COST), stockCost: decimal(movement.STOCK_COST),
          currencyCode: platformCurrency(movement.CURRENCY_CODE), inOut: Number(movement.IN_OUT),
          externalWarehouseCode: movement.WAREHOUSE_CODE, description: movement.DESCRIPTION ?? null,
          referenceNumber: null, publishedAt: null, customer: null,
        }));
        const pricesBy = (direction) => {
          const groups = new Map();
          for (const movement of mappedMovements.filter((entry) => entry.inOut === direction && entry.itemCost != null && entry.currencyCode)) {
            const rows = groups.get(movement.currencyCode) ?? [];
            rows.push(movement);
            groups.set(movement.currencyCode, rows);
          }
          return groups;
        };
        const salesByCurrency = pricesBy(-1);
        const suppliesByCurrency = pricesBy(1);
        const lastSalePrices = [...salesByCurrency.entries()].map(([currencyCode, rows]) => ({
          currencyCode, price: rows[0].itemCost, movementDate: rows[0].movementDate, unitName: rows[0].unitName,
        }));
        const averageSalePrices = [...salesByCurrency.entries()].flatMap(([currencyCode, rows]) => {
          const totals = rows.reduce((sum, movement) => {
            const quantity = Math.abs(Number(movement.itemQuantity));
            const price = Number(movement.itemCost);
            return Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price)
              ? { value: sum.value + price * quantity, quantity: sum.quantity + quantity } : sum;
          }, { value: 0, quantity: 0 });
          return totals.quantity > 0 ? [{ currencyCode, price: String(totals.value / totals.quantity), movementCount: rows.length }] : [];
        });
        const lastSupplyPrices = [...suppliesByCurrency.entries()].map(([currencyCode, rows]) => ({
          currencyCode, price: rows[0].itemCost, movementDate: rows[0].movementDate, unitName: rows[0].unitName,
        }));
        const preferredSaleUnit = units.rows.find((unit) => flag(unit.SALE_UNIT) && salePriceByUnit.has(String(unit.UNIT_NAME)))
          ?? units.rows.find((unit) => salePriceByUnit.has(String(unit.UNIT_NAME)));
        return json(response, 200, {
          snapshotRunId: `live:${schema}`, externalItemCode: row.ITEM_CODE, nameAr: row.NAME_AR,
          externalGroupCode: row.GROUP_CODE ?? '', referencePrimaryCost: decimal(row.PRIMARY_COST),
          referenceWeightedAverageCost: decimal(row.WEIGHTED_AVERAGE_COST), isInactive: flag(row.INACTIVE),
          isService: flag(row.SERVICE_ITEM), sourceUpdatedAt: row.SOURCE_UPDATED_AT ?? null,
          group: { nameAr: '', nameEn: null },
          units: units.rows.map((unit) => ({
            unitName: unit.UNIT_NAME, packageSize: decimal(unit.PACKAGE_SIZE) ?? '0', isMainUnit: flag(unit.MAIN_UNIT),
            isSaleUnit: flag(unit.SALE_UNIT), isPurchaseUnit: flag(unit.PURCHASE_UNIT), isStockUnit: flag(unit.STOCK_UNIT),
            isPriceUnit: false, noSale: flag(unit.NO_SALE), barcode: unit.BARCODE ?? null,
            unitLevel: unit.UNIT_LEVEL == null ? null : Number(unit.UNIT_LEVEL), usesSerialNumber: flag(unit.USES_SERIAL_NUMBER),
            isInactive: flag(unit.INACTIVE), inactiveReason: null,
            salePrice: salePriceByUnit.get(String(unit.UNIT_NAME)) ?? null,
          })),
          stockRows: stock.rows.map((balance) => ({
            unitName: balance.UNIT_NAME, packageSize: decimal(balance.PACKAGE_SIZE) ?? '0',
            externalWarehouseCode: balance.WAREHOUSE_CODE, availableQuantity: decimal(balance.AVAILABLE_QUANTITY) ?? '0',
            primaryCost: null, weightedAverageCost: null, isInactive: flag(balance.WAREHOUSE_INACTIVE),
            warehouse: { nameAr: balance.WAREHOUSE_NAME ?? balance.WAREHOUSE_CODE, externalBranchCode: balance.BRANCH_CODE ?? null },
          })), movements: mappedMovements,
          pricing: {
            lastSupplyCost: lastSupplyPrices.length === 1 ? lastSupplyPrices[0].price : null,
            lastSupplyPrices,
            weightedAverageCost: decimal(row.WEIGHTED_AVERAGE_COST),
            salePrice: preferredSaleUnit ? salePriceByUnit.get(String(preferredSaleUnit.UNIT_NAME)) : null,
            salePriceUnit: preferredSaleUnit?.UNIT_NAME ?? null,
            lastSalePrice: lastSalePrices.length === 1 ? lastSalePrices[0].price : null,
            averageSalePrice: averageSalePrices.length === 1 ? averageSalePrices[0].price : null,
            lastSalePrices, averageSalePrices,
            noteAr: 'سعر البيع الافتراضي من INVI008، والأسعار التاريخية مجمعة لكل عملة دون خلط العملات.',
          },
        });
      }

      const warehouseMatch = url.pathname.match(/^\/inventory\/warehouses\/([^/]+)$/);
      if (warehouseMatch) {
        const warehouseCode = decodeURIComponent(warehouseMatch[1]);
        if (!warehouseCode || warehouseCode.length > 80) throw new RequestError('Invalid warehouseCode');
        const result = await db.select(queries.warehouseExists(schema), { warehouseCode });
        return json(response, 200, { exists: result.rows.length > 0 });
      }

      if (url.pathname === '/inventory/stock') {
        const warehouseCode = requiredParam(url, 'warehouseCode');
        const itemCode = requiredParam(url, 'itemCode');
        const unitCode = requiredParam(url, 'unitCode', null, 40);
        const sql = queries.stock(schema);
        const [warehouse, item, unit, available] = await Promise.all([
          db.select(queries.warehouseExists(schema), { warehouseCode }),
          db.select(sql.itemExists, { itemCode }),
          db.select(sql.unit, { itemCode, unitCode }),
          db.select(sql.available, { warehouseCode, itemCode, unitCode }),
        ]);
        const unitRow = unit.rows[0];
        return json(response, 200, {
          warehouseExists: warehouse.rows.length > 0,
          itemExists: item.rows.length > 0,
          unitExists: Boolean(unitRow),
          packageSize: unitRow?.PACKAGE_SIZE == null ? null : Number(unitRow.PACKAGE_SIZE),
          availableQuantity: Number(available.rows[0]?.AVAILABLE_QUANTITY || 0),
        });
      }

      if (url.pathname === '/inventory/transfers/evidence') {
        const sourceTransferSerial = requiredParam(url, 'sourceTransferSerial', /^\d{1,20}$/, 20);
        const sourceWarehouseCode = requiredParam(url, 'sourceWarehouseCode');
        const destinationWarehouseCode = requiredParam(url, 'destinationWarehouseCode');
        const itemCodes = requiredParam(url, 'itemCodes', null, 8000).split(',').map((code) => code.trim());
        const sql = queries.transferEvidence(schema, itemCodes);
        const [source, destinations, movements] = await Promise.all([
          db.select(sql.source, { sourceTransferSerial, sourceWarehouseCode, destinationWarehouseCode }),
          db.select(sql.destinations, { sourceTransferSerial, destinationWarehouseCode }),
          db.select(sql.movements, { sourceTransferSerial, ...sql.itemBinds }),
        ]);
        return json(response, 200, {
          source: mapSource(source.rows[0]),
          destinationDocuments: destinations.rows.map((row) => ({
            transferSerial: row.TRANSFER_SERIAL,
            sourceTransferSerial: row.SOURCE_TRANSFER_SERIAL,
            warehouseCode: row.WAREHOUSE_CODE,
          })),
          movements: movements.rows.map((row) => ({
            documentSerial: row.DOCUMENT_SERIAL,
            documentType: Number(row.DOCUMENT_TYPE),
            itemCode: row.ITEM_CODE,
            warehouseCode: row.WAREHOUSE_CODE,
          })),
        });
      }

      if (url.pathname === '/inventory/transfers/by-out-request') {
        const outReqSer = requiredParam(url, 'outReqSer', /^\d{1,20}$/, 20);
        const result = await db.select(queries.transferByOutRequest(schema), { outReqSer });
        return json(response, 200, {
          requestSerial: outReqSer,
          documents: result.rows.map(mapSource),
        });
      }

      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError || /schema/i.test(error.message)) {
        return json(response, 400, { message: error.message });
      }
      console.error('Oracle Read API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'Oracle read is temporarily unavailable' });
    }
  };
}

async function main() {
  const config = loadConfig();
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  const server = http.createServer(createHandler(config, db));
  server.listen(config.port, config.host, () => {
    console.log(`Oracle Read API listening on http://${config.host}:${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    await db.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Oracle Read API failed to start', { name: error.name, message: error.message, errorNum: error.errorNum });
    process.exitCode = 1;
  });
}

module.exports = { createHandler };
