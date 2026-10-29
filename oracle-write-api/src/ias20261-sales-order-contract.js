'use strict';

// IAS_ONLINE_PKG.GET_DOC_SER and INSRT_RSRVD_TBL, supplied 2026-09-17.
// The first supported profile is IAS20261 / branch 1 / AR_SORDER_SERIAL=1.
// These are pure formatters: they never allocate document numbers or sequences.
function assertSalesOrderProfile(profile) {
  if (profile?.schema !== 'IAS20261' || String(profile.year) !== '2026'
      || String(profile.branch) !== '1' || String(profile.serialType) !== '1') {
    throw new Error('Unsupported sales-order numbering profile');
  }
}

function documentNumber(value) {
  // Keep serials as strings; accepting an already-rounded JS number loses identity.
  if (typeof value !== 'string' || !/^[1-9]\d{0,25}$/.test(value)) {
    throw new Error('Document number must be a positive integer string of at most 26 digits');
  }
  return value;
}

function salesOrderSerial(profile, number) {
  assertSalesOrderProfile(profile);
  return `202600000153${documentNumber(number)}`;
}

function salesOrderReservationSerial(profile, reservationNumber) {
  assertSalesOrderProfile(profile);
  return `20262000001${documentNumber(reservationNumber)}`;
}

// Allocate these independently, inside the same protected transaction as INSERT.
const NEXT_ORDER_NUMBER_SQL = `SELECT TO_CHAR(NVL(MAX(TO_NUMBER(ORDER_NO)),0)+1) DOCUMENT_NO
FROM IAS20261.SALES_ORDER WHERE BRN_NO=1`;
const NEXT_RESERVATION_NUMBER_SQL = `SELECT TO_CHAR(NVL(MAX(DOC_NO),0)+1) DOCUMENT_NO
FROM IAS20261.IAS_RESERVE_MST WHERE DOC_TYPE_REF=53`;

module.exports = { assertSalesOrderProfile, salesOrderSerial, salesOrderReservationSerial,
  NEXT_ORDER_NUMBER_SQL, NEXT_RESERVATION_NUMBER_SQL };
