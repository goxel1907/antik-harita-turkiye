'use strict';
// R2544.116 (kullanıcı 03.11: "hakkını ver, sen onun boğazını sıkıyorsun"; "düşük R olsa bile kaldıracı artırıp girsin"; "10x kaldıracın
// altına asla düşmeyecek"; "marj da küçülmeyecek, canlıda ve testte ne belirlendi ise o olacak"; "R hesaplaması saçma, gördüğü her
// fırsata girecek o kadar ve öğrenecek"): the rule's soft checks are warnings, not drops; only mechanics stop a trade.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const T3=require('../top3-hunter'),Z5=require('../zirve5'),TB=require('../trader-brain');
const cfg=T3.DEFAULT_CONFIG||T3.readTop3Config('C:/__none__');
test('R2544.116 İlk 3 plans: a stop outside the band / a close zone / an unswept level is a WARNING (advisory); strict mode unchanged; mechanics stay',()=>{
  const trig={ok:true,level:100,retestLow:99.4};const lv={pdh:101,pwh:200,pmh:300};
  const strict=T3.earlyLongPlan(100.05,trig,lv,cfg);assert.equal(strict.ok,false);assert.equal(strict.reason,'V2_STOP_OUT_OF_RANGE','0.95 % stop < 1.2 % band');
  const a=T3.earlyLongPlan(100.05,trig,lv,cfg,{advisory:true});assert.equal(a.ok,true);
  assert.deepEqual(a.flags.map(f=>f.code),['V2_STOP_OUT_OF_RANGE','V2_ZONE_TOO_CLOSE'],'tight stop + level 1R away: both warnings, the trade still opens');
  assert.ok(a.targetR>0.3&&a.targetR<1,'a 0.47R target is fine now (no R filter), got '+a.targetR);
  assert.equal(T3.earlyLongPlan(100.05,{ok:true,level:100,retestLow:90},lv,cfg,{advisory:true}).ok,false,'10 % stop: behind the 10x liquidation -> no trade');
  const sh=T3.topShortPlan(100,{ok:true,top:100.2},{pdh:100.5,pwh:150},cfg,{advisory:true});assert.equal(sh.ok,true);
  assert.deepEqual(sh.flags.map(f=>f.code),['V2_STOP_OUT_OF_RANGE','V2_UNSWEPT_ZONE_ABOVE','V2_WEEKLY_NOT_SWEPT']);
  assert.equal(T3.topShortPlan(100,{ok:true,top:100.2},{pdh:100.5,pwh:150},cfg).ok,false,'strict unchanged');
});
test('R2544.116 ZİRVE-5 plan: stop band is a warning; 9.5 % stays the mechanical limit',()=>{
  const zc=Z5.DEFAULT_CONFIG;const p=Z5.plan(100,{side:'LONG',stopPrice:91,liquidity:120},zc,{advisory:true});
  assert.equal(p.ok,true);assert.equal(p.flags[0].code,'ZIRVE5_STOP_OUT_OF_BAND');
  assert.equal(Z5.plan(100,{side:'LONG',stopPrice:90,liquidity:120},zc,{advisory:true}).ok,false);
  assert.equal(Z5.plan(100,{side:'LONG',stopPrice:99.9,liquidity:120},zc,{advisory:true}).ok,false,'a 0.1 % stop: fees eat it');
  assert.equal(Z5.plan(100,{side:'LONG',stopPrice:91,liquidity:120},zc).ok,false,'strict unchanged');
});
test('R2544.116 the committee screen says what the rule objected to, and that the trader decides',()=>{
  const b=TB.briefing({side:'LONG',rule:'LONG_EARLY_RETEST',plan:{stop:99,target:101,targetR:1,stopDistancePct:0.95},tfs:{},levels:[],btc:null,P:x=>x,R:()=>null,
    flags:[{code:'V2_STOP_OUT_OF_RANGE',stopPct:0.0095,band:[0.012,0.045]},{code:'V2_ZONE_TOO_CLOSE',zoneR:1.05,minRoomR:2}]});
  assert.match(b.ruleWarnings[0],/^stop 0\.95% is tighter than the rule's usual 1\.2-4\.5% band - the margin stays as set and the leverage rises/);
  assert.match(b.ruleWarnings[1],/only 1\.05R away/);
  assert.equal(TB.briefing({side:'LONG',rule:'LONG_EARLY_RETEST',plan:{stop:99,target:103,targetR:3,stopDistancePct:1},tfs:{},levels:[],btc:null,P:x=>x,R:()=>null}).ruleWarnings,'none: the signal passed every check of the rule');
  assert.match(TB.ENTRY_SYSTEM,/YOU are the trader and decide \(the margin is fixed; leverage is 10x or more for a tight stop\)/);
});
test('R2544.116 wiring: every signal opens (no entry vote wait, opt-in committeeEntryVeto), margin as set, leverage >= 10x and up to 20x for a tight stop',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/const adv=true;ef\.trig=x\.trig;/);assert.match(lc,/if\(cfg\.committeeEntryVeto===true&&pl0\?\.ok\)\{/);assert.match(lc,/if\(cfg\.committeeEntryVeto===true\)\{const pz=z5Lib\.plan/);
  assert.match(lc,/maxHoldMs:R\.maxHoldH\*TOP3_HOUR,advisory:true\}/);assert.match(lc,/maxHoldMs:cfg\.maxHoldH\*TOP3_HOUR,advisory:z5Adv\}/);
  assert.match(lc,/LEV_FLOOR=10;/);assert.match(lc,/Math\.max\(LEV_FLOOR,Math\.min\(refStop>0\?Math\.max\(cfg\.leverage,Math\.ceil\(cfg\.leverage\*refStop\/pre\.stopPct\)\):cfg\.leverage,exchangeMax,safeMax,maxLev\)\)/);
  assert.doesNotMatch(lc,/notional=Math\.min\(notional,margin\*cfg\.leverage\*refStop/,'the margin is never cut');
  assert.match(lc,/TOP3_STOP_BEYOND_LIQUIDATION_AT_10X/);assert.match(lc,/TOP3_BRACKET_UNDER_10X/);
  assert.equal(T3.readTop3Config('C:/__none__').committeeEntryVeto,false);assert.equal(Z5.readConfig('C:/__none__').committeeEntryVeto,false);
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');assert.match(html,/⚠ kural uyarısıyla açıldı/);
});
