'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeAccountContext,
  assessApiPermissionDeclaration,
  containsSecretLikeKey
} = require('../binance-account-context');

test('sanitized Binance futures account context keeps only execution-safe fields', () => {
  const raw = {
    apiKey:'SHOULD_NEVER_LEAVE_RAW_INPUT',
    secretKey:'SHOULD_NEVER_LEAVE_RAW_INPUT',
    equity:'1000.50',
    walletBalance:'980.25',
    availableBalance:'620.10',
    unrealizedPnl:'20.25',
    dailyRealizedPnl:'-12.40',
    positions:[
      {
        symbol:'arbusdt',
        positionSide:'LONG',
        notional:'250.75',
        entryPrice:'0.50',
        markPrice:'0.52',
        unRealizedProfit:'10.02',
        leverage:'3',
        token:'DO_NOT_COPY'
      },
      { symbol:'bad symbol', positionSide:'LONG', notional:'100' }
    ]
  };

  const out = sanitizeAccountContext(raw);
  assert.equal(out.ok, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.equal(out.account.openPositions, 1);
  assert.equal(out.account.positions[0].symbol, 'ARBUSDT');
  assert.equal(out.account.positions[0].side, 'LONG');
  assert.equal(out.account.positions[0].notionalQuote, 250.75);
  assert.equal(out.account.positions[0].leverage, 3);
  assert.equal(containsSecretLikeKey(out), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out.account.positions[0], 'token'), false);
});

test('account context fails closed when mandatory deterministic balance fields are missing', () => {
  const out = sanitizeAccountContext({
    equity:null,
    availableBalance:'',
    positions:[]
  });

  assert.equal(out.ok, false);
  assert.equal(out.account.available, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('ACCOUNT_EQUITY_UNKNOWN'));
  assert.ok(out.reasons.includes('AVAILABLE_BALANCE_UNKNOWN'));
  assert.ok(out.reasons.includes('DAILY_REALIZED_PNL_UNKNOWN'));
});

test('API permission declaration rejects withdrawal access and missing IP restriction', () => {
  const out = assessApiPermissionDeclaration({
    configured:true,
    futuresTradingEnabled:true,
    withdrawalsEnabled:true,
    ipRestricted:false
  });

  assert.equal(out.ok, false);
  assert.equal(out.futureLiveSetupEligible, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('WITHDRAWALS_MUST_BE_DISABLED'));
  assert.ok(out.reasons.includes('IP_RESTRICTION_REQUIRED'));
});

test('minimal declared Futures permissions can be setup-eligible but never authorize LIVE by themselves', () => {
  const out = assessApiPermissionDeclaration({
    configured:true,
    futuresTradingEnabled:true,
    withdrawalsEnabled:false,
    ipRestricted:true
  });

  assert.equal(out.ok, true);
  assert.equal(out.futureLiveSetupEligible, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.deepEqual(out.reasons, []);
});

test('secret-like key detector catches nested credential-shaped fields', () => {
  assert.equal(containsSecretLikeKey({ nested:{ private_key:'x' } }), true);
  assert.equal(containsSecretLikeKey({ nested:[{ passphrase:'x' }] }), true);
  assert.equal(containsSecretLikeKey({ safe:{ equity:100, positions:[] } }), false);
});
