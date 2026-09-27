'use strict';

function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

function normSide(v) {
  return text(v).toUpperCase();
}

function normSymbol(v) {
  return text(v).toUpperCase();
}

function closeEnough(a, b, relTolerance) {
  const x = finite(a);
  const y = finite(b);

  if (x === null || y === null) return null;

  const scale = Math.max(Math.abs(x), Math.abs(y), 1e-12);
  return Math.abs(x - y) / scale <= relTolerance;
}

/*
 * R2542 close identity rules:
 *
 * 1. Exact execution eventId always wins.
 * 2. Existing office-performance sameEntry remains accepted.
 * 3. Legacy/restart fallback requires:
 *      - same symbol
 *      - same side
 *      - opening timestamps within maxOpenSkewMs
 *      - both quantity and entry price are comparable
 *      - every comparable qty/entry-price field inside tolerance
 *
 * setup / TF / holdMinutes / netPnl are intentionally NOT identity fields.
 */
function sameExecutionClose(
  existing,
  identity,
  {
    eventId = null,
    sameEntry = null,
    maxOpenSkewMs = 120000,
    relTolerance = 0.0025
  } = {}
) {
  if (!existing || !identity) return false;

  const targetEventId = text(eventId||identity.eventId);
  const existingEventId = text(existing.eventId);

  if (targetEventId && existingEventId && targetEventId === existingEventId) {
    return true;
  }
  if (targetEventId && existingEventId) return false;
  if (!normSymbol(existing.symbol)||!normSymbol(identity.symbol)||!normSide(existing.side)||!normSide(identity.side)) return false;
  // An already-closed trade followed by a new entry is not a duplicate, even
  // when price and quantity happen to be similar within the legacy time window.
  if(Date.parse(existing.closedAt||'')<=Date.parse(identity.openedAt||''))return false;

  if (typeof sameEntry === 'function') {
    try {
      if (sameEntry(existing, identity)) return true;
    } catch {}
  }

  if (normSymbol(existing.symbol) !== normSymbol(identity.symbol)) {
    return false;
  }

  if (normSide(existing.side) !== normSide(identity.side)) {
    return false;
  }

  const a = Date.parse(existing.openedAt || '');
  const b = Date.parse(identity.openedAt || '');

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }

  if (Math.abs(a - b) > maxOpenSkewMs) {
    return false;
  }

  let comparable = 0;

  const qtyMatch = closeEnough(existing.quantity, identity.quantity, relTolerance);

  if (qtyMatch !== null) {
    comparable += 1;
    if (!qtyMatch) return false;
  }

  const priceMatch = closeEnough(existing.entryPrice, identity.entryPrice, relTolerance);

  if (priceMatch !== null) {
    comparable += 1;
    if (!priceMatch) return false;
  }

  return comparable === 2;
}

module.exports = {
  sameExecutionClose
};
