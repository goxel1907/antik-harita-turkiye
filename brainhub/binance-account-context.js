'use strict';

const SECRET_KEYS = /^(api[_-]?key|secret|secret[_-]?key|token|passphrase|signature|private[_-]?key)$/i;

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanSymbol(v) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z0-9]{5,28}$/.test(s) ? s : null;
}

function sanitizePosition(x) {
  const symbol = cleanSymbol(x?.symbol);
  const side = String(x?.side || x?.positionSide || '').toUpperCase();
  const notionalQuote = finite(x?.notionalQuote ?? x?.notional);
  const entryPrice = finite(x?.entryPrice);
  const markPrice = finite(x?.markPrice);
  const unrealizedPnl = finite(x?.unrealizedPnl ?? x?.unRealizedProfit);
  const leverage = finite(x?.leverage);

  if (!symbol || !['LONG','SHORT'].includes(side)) return null;
  return {
    symbol,
    side,
    notionalQuote,
    entryPrice,
    markPrice,
    unrealizedPnl,
    leverage
  };
}

function sanitizeAccountContext(raw = {}) {
  const equity = finite(raw?.equity ?? raw?.marginBalance ?? raw?.totalMarginBalance);
  const walletBalance = finite(raw?.walletBalance ?? raw?.totalWalletBalance);
  const availableBalance = finite(raw?.availableBalance ?? raw?.availableQuote);
  const unrealizedPnl = finite(raw?.unrealizedPnl ?? raw?.totalUnrealizedProfit);
  const dailyRealizedPnl = finite(raw?.dailyRealizedPnl);
  const positions = Array.isArray(raw?.positions)
    ? raw.positions.map(sanitizePosition).filter(Boolean).slice(0, 100)
    : [];

  const reasons = [];
  if (equity === null || equity < 0) reasons.push('ACCOUNT_EQUITY_UNKNOWN');
  if (availableBalance === null || availableBalance < 0) reasons.push('AVAILABLE_BALANCE_UNKNOWN');
  if (dailyRealizedPnl === null) reasons.push('DAILY_REALIZED_PNL_UNKNOWN');

  return {
    ok:reasons.length === 0,
    source:'SANITIZED_BINANCE_FUTURES_ACCOUNT_CONTEXT',
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    account:{
      available:reasons.length === 0,
      equity,
      walletBalance,
      availableBalance,
      unrealizedPnl,
      dailyRealizedPnl,
      openPositions:positions.length,
      positions
    },
    reasons
  };
}

function assessApiPermissionDeclaration(declaration = {}) {
  const reasons = [];
  const configured = declaration?.configured === true;
  const futuresTradingEnabled = declaration?.futuresTradingEnabled === true;
  const withdrawalsEnabled = declaration?.withdrawalsEnabled;
  const ipRestricted = declaration?.ipRestricted === true;

  if (!configured) reasons.push('API_KEY_NOT_CONFIGURED');
  if (!futuresTradingEnabled) reasons.push('FUTURES_TRADING_PERMISSION_REQUIRED');
  if (withdrawalsEnabled !== false) reasons.push('WITHDRAWALS_MUST_BE_DISABLED');
  if (!ipRestricted) reasons.push('IP_RESTRICTION_REQUIRED');

  return {
    ok:reasons.length === 0,
    declarationKnown:configured,
    futuresTradingEnabled,
    withdrawalsEnabled:withdrawalsEnabled === false ? false : null,
    ipRestricted,
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    futureLiveSetupEligible:reasons.length === 0,
    reasons
  };
}

function containsSecretLikeKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSecretLikeKey);
  return Object.entries(value).some(([k,v]) => SECRET_KEYS.test(k) || containsSecretLikeKey(v));
}

module.exports = {
  sanitizeAccountContext,
  assessApiPermissionDeclaration,
  containsSecretLikeKey
};
