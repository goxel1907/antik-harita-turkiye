'use strict';
// CLAUDE_V109 regresyon testleri — Claude (Anthropic, Cowork), v9.5.109-CLAUDE.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v109 = require('../claude-v109');
const { withTriggerSpec, triggerCandidatesForPlan, visionPlanContract } = require('../pipeline');
const { applyDynamicSizingGuards } = require('../live-controller');
const { accountRiskCaps } = require('../risk-gate');

function frame(over = {}) {
  return { available:true, fresh:true, close:101, atrPct:1.2, prior20High:100, prior20Low:95, breakOfStructure:'UP', breakoutExecution:{ status:'ACCEPTED', allowed:true }, ...over };
}
function unified(over = {}) {
  return {
    symbol:'AAAUSDT', livePrice:101.2, dataQuality:{ advisoryUsable:true },
    frames:{ '5m':frame({ breakOfStructure:null, breakoutExecution:{ status:'NO_ACTIVE_BREAKOUT' } }), '15m':frame(), '1h':frame({ breakOfStructure:null, breakoutExecution:null, prior20High:104, prior20Low:90 }) },
    opportunityPaths:{ LONG:{ originTF:'15m', ownerTF:'1h', continuity:[
      { frame:'5m', immediateEligible:true }, { frame:'15m', immediateEligible:true }, { frame:'1h', immediateEligible:true }
    ] }, SHORT:{ continuity:[] } },
    ...over
  };
}
function watchPlan(over = {}) {
  return { valid:true, status:'WATCH', side:'LONG', originTF:'15m', ownerTF:'1h', waitFor:'NONE — somut koşul yok', vetoTFs:[], supportTFs:['15m'], confidence:61, ...over };
}

test('marker metadata is visible for ChatGPT and the updater', () => {
  assert.equal(v109.marker, 'CLAUDE_V109');
  assert.equal(v109.featureVersion, '9.5.109-CLAUDE-VISION');
  assert.equal(v109.androidVersionName, '9.5.109-CLAUDE');
  assert.ok(v109.features.includes('CLAUDE_V109_BUILD'));
  assert.match(v109.builtBy, /Claude/);
});

test('QUALIFIED accepts NONE-prefixed wait text, WATCH treats it as non-concrete', () => {
  for (const w of ['NONE', 'NONE — tetik oluştu', 'NONE (kapanış teyitli)', 'YOK - bekleme yok']) {
    assert.equal(v109.qualifiedWaitIsNone(w), true, w);
    assert.equal(v109.nonConcreteWait(w), true, w);
  }
  assert.equal(v109.qualifiedWaitIsNone('15m kapanışı 100 üstünde'), false);
  assert.equal(v109.nonConcreteWait('15m kapanışı 100 üstünde'), false);
});

test('trigger candidates exist only when full frames are supplied (ChatGPT finalize-context bug)', () => {
  const full = triggerCandidatesForPlan(unified(), 'LONG');
  assert.ok(full.some(x => x.tf === '15m' && x.id === 'PRIOR20_HIGH' && x.price === 100));
  const stripped = { frames:{ '15m':{ available:true, fresh:true, close:101, trend:'UP' } } };
  assert.deepEqual(triggerCandidatesForPlan(stripped, 'LONG'), [], 'stripped finalize frames carry no levels');
});

test('trigger autoselect repairs missing model IDs and writes a numeric WATCH wait', () => {
  const p = withTriggerSpec(watchPlan(), unified());
  assert.equal(p.triggerSpec.valid, true);
  assert.equal(p.triggerSpec.autoSelected, true);
  assert.equal(p.triggerTF, '15m');
  assert.equal(p.triggerLevelId, 'PRIOR20_HIGH');
  assert.equal(p.invalidationLevelId, 'PRIOR20_LOW');
  assert.match(p.waitFor, /^15m kapanışı 100 üstünde/);
  assert.equal(p.modelWaitFor, 'NONE — somut koşul yok');
  assert.equal(p.waitForRepairedBy, 'CLAUDE_V109_NUMERIC_WAIT_FALLBACK');
});

test('trigger autoselect keeps a valid model trigger ID', () => {
  const p = withTriggerSpec(watchPlan({ triggerTF:'1h', triggerLevelId:'PRIOR20_HIGH', invalidationLevelId:'PRIOR20_LOW', waitFor:'1h kapanışı 104 üstünde' }), unified());
  assert.equal(p.triggerSpec.valid, true);
  assert.equal(p.triggerSpec.autoSelected, undefined);
  assert.equal(p.triggerTF, '1h');
  assert.equal(p.waitFor, '1h kapanışı 104 üstünde');
});

test('REJECT and REVIEW plans are never given a trigger', () => {
  const p = withTriggerSpec(watchPlan({ status:'REJECT' }), unified());
  assert.equal(p.claudeTriggerAutoSelect, undefined);
  assert.equal(p.triggerSpec.valid, false);
});

test('deterministic trigger detects accepted closed-candle breakout but respects model vetoes', () => {
  const dt = v109.deterministicTrigger({ plan:watchPlan(), candidate:{ side:'LONG' }, unified:unified() });
  assert.equal(dt.ok, true);
  assert.equal(dt.tf, '15m');
  assert.equal(dt.ownerTF, '1h');
  assert.equal(dt.level, 100);
  const veto = v109.deterministicTrigger({ plan:watchPlan({ vetoTFs:['1h'] }), candidate:{ side:'LONG' }, unified:unified() });
  assert.equal(veto.ok, false);
  assert.ok(veto.reasons.some(r => r.startsWith('DT_MODEL_ORIGIN_OWNER_VETO')));
  const side = v109.deterministicTrigger({ plan:watchPlan(), candidate:{ side:'SHORT' }, unified:unified() });
  assert.equal(side.ok, false);
  const reject = v109.deterministicTrigger({ plan:watchPlan({ status:'REJECT' }), candidate:{ side:'LONG' }, unified:unified() });
  assert.equal(reject.ok, false);
  const back = v109.deterministicTrigger({ plan:watchPlan(), candidate:{ side:'LONG' }, unified:unified({ livePrice:99.5 }) });
  assert.deepEqual(back.reasons, ['DT_PRICE_BACK_INSIDE_RANGE']);
});

test('deterministic trigger BINDING upgrade keeps advisory execution and full trigger spec IDs', () => {
  const dt = v109.deterministicTrigger({ plan:watchPlan(), candidate:{ side:'LONG' }, unified:unified() });
  const q = v109.applyDeterministicTrigger(watchPlan(), dt);
  assert.equal(q.status, 'QUALIFIED');
  assert.equal(q.waitFor, 'NONE');
  assert.equal(q.previousStatus, 'WATCH');
  assert.equal(q.triggerLevelId, 'PRIOR20_HIGH');
  assert.equal(q.invalidationLevelId, 'PRIOR20_LOW');
  assert.equal(q.execution, 'ADVISORY_ONLY');
  assert.equal(q.claudeDeterministicTrigger.applied, true);
});

test('config defaults to SHADOW and V108 Jev policy; BINDING only when explicitly configured', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v109-cfg-'));
  const prev = process.env.BRAINHUB_ROOT;
  try {
    process.env.BRAINHUB_ROOT = root;
    v109.resetConfigCache();
    assert.equal(v109.readConfig().deterministicTriggerMode, 'SHADOW');
    assert.equal(v109.readConfig().jevVetoPolicy, 'V108_ANY_065');
    fs.mkdirSync(path.join(root, 'config'), { recursive:true });
    fs.writeFileSync(path.join(root, 'config', 'claude-v109.json'), JSON.stringify({ deterministicTriggerMode:'binding', jevVetoPolicy:'CLAUDE_V109_ROLE_WEIGHTED', chaseCapPct:99 }));
    v109.resetConfigCache();
    const c = v109.readConfig();
    assert.equal(c.deterministicTriggerMode, 'BINDING');
    assert.equal(c.jevVetoPolicy, 'CLAUDE_V109_ROLE_WEIGHTED');
    assert.equal(c.chaseCapPct, 5, 'cap is clamped');
  } finally {
    if (prev === undefined) delete process.env.BRAINHUB_ROOT; else process.env.BRAINHUB_ROOT = prev;
    v109.resetConfigCache();
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Jev role-weighted rule: single soft 0.66 does not veto, hard/critical/2x soft do', () => {
  const base = { structuralVeto:0.2, formingDependency:0.2, dataQualityInsufficient:0.1, directionConflict:0.1, symbolPackageIntegrity:0.05, originOwnerContinuity:0.2, tfConflict:0.2, smcLiquidityConflict:0.2, microstructureReliability:0.2, closedCandleConfirmation:0.2, visualDataConsistency:0.2, waitRequired:0.66 };
  const plan = { originTF:'15m', ownerTF:'1h' };
  assert.equal(v109.jevRoleWeightedVeto({ probabilities:base, timeframeConflicts:{ '4h':0.7 }, plan }).veto, false);
  assert.equal(v109.jevRoleWeightedVeto({ probabilities:{ ...base, dataQualityInsufficient:0.7 }, plan }).veto, true);
  assert.equal(v109.jevRoleWeightedVeto({ probabilities:base, timeframeConflicts:{ '15m':0.7 }, plan }).veto, true);
  assert.equal(v109.jevRoleWeightedVeto({ probabilities:{ ...base, waitRequired:0.8, tfConflict:0.8 }, plan }).veto, true);
  assert.equal(v109.jevRoleWeightedVeto({ probabilities:{ ...base, waitRequired:0.93 }, plan }).veto, true);
});

test('annotateJevDecision is shadow by default and binding only on request', () => {
  const decision = { ok:true, called:true, veto:true, vetoReasons:['JEV_WAIT_REQUIRED'], probabilities:{ waitRequired:0.66 }, timeframeConflicts:{} };
  const shadow = v109.annotateJevDecision(decision, { originTF:'15m', ownerTF:'1h' }, 'V108_ANY_065');
  assert.equal(shadow.veto, true);
  assert.equal(shadow.claudeRoleWeighted.veto, false);
  assert.equal(shadow.vetoPolicy, 'V108_ANY_065');
  const binding = v109.annotateJevDecision(decision, { originTF:'15m', ownerTF:'1h' }, 'CLAUDE_V109_ROLE_WEIGHTED');
  assert.equal(binding.veto, false);
  assert.equal(binding.v108Veto, true);
  assert.equal(binding.vetoPolicy, 'CLAUDE_V109_ROLE_WEIGHTED');
  const failed = v109.annotateJevDecision({ ok:false, called:true, veto:true, reason:'JEV_KEY_UNAVAILABLE' }, {}, 'CLAUDE_V109_ROLE_WEIGHTED');
  assert.equal(failed.veto, true, 'transport/schema failures stay fail-closed');
});

test('chase gate: ATR-scaled distance from trigger, back-inside and runaway blocks', () => {
  const cfg = { chaseAtrMultiple:1, chaseCapPct:3 };
  // 15m kırılım mumu tetikten %0,9 yukarıda: ChatGPT'nin %0,5 kuralı düşürürdü, ATR %1,2 ile geçer.
  const ok = v109.chaseGate({ side:'LONG', freshPrice:100.9, triggerPrice:100, atrPct:1.2, maxEntryDeviationPct:0.5, config:cfg });
  assert.equal(ok.ok, true);
  assert.equal(ok.reference, 'TRIGGER');
  const far = v109.chaseGate({ side:'LONG', freshPrice:101.5, triggerPrice:100, atrPct:1.2, maxEntryDeviationPct:0.5, config:cfg });
  assert.equal(far.reason, 'CLAUDE_V109_TRIGGER_CHASE_TOO_FAR');
  const inside = v109.chaseGate({ side:'LONG', freshPrice:99.9, triggerPrice:100, atrPct:1.2, config:cfg });
  assert.equal(inside.reason, 'CLAUDE_V109_PRICE_BACK_INSIDE_TRIGGER');
  const shortOk = v109.chaseGate({ side:'SHORT', freshPrice:99.4, triggerPrice:100, atrPct:1, config:cfg });
  assert.equal(shortOk.ok, true);
  const runaway = v109.chaseGate({ side:'LONG', freshPrice:102, analyzedPrice:100, atrPct:1, maxEntryDeviationPct:0.5, config:cfg });
  assert.equal(runaway.reason, 'CLAUDE_V109_PRICE_RAN_AWAY_SINCE_ANALYSIS');
  const against = v109.chaseGate({ side:'LONG', freshPrice:98, analyzedPrice:100, atrPct:1, maxEntryDeviationPct:0.5, config:cfg });
  assert.equal(against.reason, 'CLAUDE_V109_PRICE_MOVED_AGAINST_SINCE_ANALYSIS');
  const capped = v109.chaseGate({ side:'LONG', freshPrice:103.5, triggerPrice:100, atrPct:8, config:cfg });
  assert.equal(capped.reason, 'CLAUDE_V109_TRIGGER_CHASE_TOO_FAR', 'cap 3% even on very volatile frames');
});

test('risk authority: default panel-exact passes the real 80 USDT / 25x10 setup, STRICT_POLICY_CAP blocks', () => {
  const limits = { maxRiskPctPerTrade:1, maxNotionalPctPerTrade:25, maxDailyLossPct:5, maxOpenPositions:1, maxFamilyExposurePct:100 };
  const accountRisk = {
    account:{ available:true, equity:80.54, availableBalance:80.54, dailyRealizedPnl:0, openPositions:0 },
    intent:{ family:'ALL_USDT_PERP', riskQuote:4, notionalQuote:250, familyExposureAfterQuote:250 },
    limits
  };
  const settings = { dynamic:true, marginQuote:25, leverage:10, maxOpenPositions:2 };
  const panel = applyDynamicSizingGuards(accountRisk, settings, { expectedLeverage:3, limits });
  assert.equal(panel.sizing.riskAuthority, 'USER_PANEL_EXACT');
  assert.equal(accountRiskCaps(panel.accountRisk).ok, true);
  const strict = applyDynamicSizingGuards(accountRisk, settings, { expectedLeverage:3, limits, riskAuthority:'STRICT_POLICY_CAP' });
  assert.equal(strict.sizing.riskAuthority, 'STRICT_POLICY_CAP');
  assert.equal(accountRiskCaps(strict.accountRisk).ok, false);
});

test('v109 WATCH plan with valid numeric trigger passes the contract even when model wait text was NONE', () => {
  const plan = withTriggerSpec({
    ...watchPlan(), planCode:'LH_UNIFIED_9TF', setup:'breakout', execPath:'retest', why:'neden', riskNote:'risk',
    visionSummary:'özet', formingContext:'bağlam', supportTFsDeclared:true, vetoTFsDeclared:true,
    timeframeDiagnostics:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf => [tf, { summary:'x', why:'x', wait:'NONE', role:'NEUTRAL', forming:'x', risk:'x' }]))
  }, unified());
  const c = visionPlanContract(plan);
  assert.equal(c.missing.includes('WATCH_WAIT_FOR_NOT_CONCRETE'), false, JSON.stringify(c));
  assert.equal(c.missing.includes('TRIGGER_LEVEL_SELECTION_INVALID'), false, JSON.stringify(c));
});

test('PC updater copies every local module the server needs (ChatGPT v109 missed wait-condition.js)', () => {
  const dir = path.join(__dirname, '..');
  const manage = fs.readFileSync(path.join(dir, 'manage.ps1'), 'utf8');
  const m = manage.match(/\$files\s*=\s*@\(([^)]*)\)/);
  assert.ok(m, 'manage.ps1 $files list not found');
  const listed = new Set([...m[1].matchAll(/'([^']+\.js)'/g)].map(x => x[1]));
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const r of src.matchAll(/require\('\.\/([^']+)'\)/g)) walk(r[1].endsWith('.js') ? r[1] : r[1] + '.js');
  };
  walk('server.js');
  const missing = [...seen].filter(f => !listed.has(f));
  assert.deepEqual(missing, [], 'manage.ps1 $files is missing: ' + missing.join(', '));
});
