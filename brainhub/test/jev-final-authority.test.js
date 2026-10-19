'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { jevFinalAuthorityPreflight } = require('../live-controller');

test('JEV final authority preflight does not re-vote strategy after approval', () => {
  const plan = { valid:true, status:'QUALIFIED', side:'LONG', originTF:'1m', ownerTF:'15m' };
  const unified = {
    livePrice:100,
    dataQuality:{ advisoryUsable:true },
    frames:{
      '1m':{ available:true, fresh:true, breakoutExecution:{ status:'FAILED_BREAKOUT' } },
      '15m':{ available:true, fresh:true }
    },
    opportunityPaths:{ LONG:{ continuity:[] } }
  };
  const out = jevFinalAuthorityPreflight({ plan, unified });
  assert.equal(out.ok, true, JSON.stringify(out.reasons));
  assert.equal(out.finalAuthority, true);
  assert.deepEqual(out.reasons, []);
  assert.ok(out.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'));
  assert.ok(out.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'));
  assert.ok(out.remainingMandatoryControls.includes('KILL_SWITCH'));
  assert.ok(out.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'));
});

test('JEV final authority still fails closed on invalid approval integrity/context', () => {
  assert.equal(jevFinalAuthorityPreflight({
    plan:{ valid:false, status:'QUALIFIED', side:'LONG' },
    unified:{ livePrice:100, dataQuality:{ advisoryUsable:true } }
  }).ok, false);
  assert.equal(jevFinalAuthorityPreflight({
    plan:{ valid:true, status:'QUALIFIED', side:'LONG' },
    unified:{ livePrice:null, dataQuality:{ advisoryUsable:false } }
  }).ok, false);
});

test('live controller marks JEV final authority and skips second scanner vote only for approved final flow', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
  assert.match(src, /JEV_FINAL_APPROVAL_REQUIRED/);
  assert.match(src, /approved\?\.finalAuthority!==true/);
  assert.match(src, /stage:'SOFT_WARNING'/);
  assert.match(src, /stage:'HARD_BLOCK'/);
  assert.match(src, /jevFinalAuthority:true/);
});
