'use strict';
// R2544.75 (user 23.10: "neredeyse hiç işlem yok ... ölç ... beyini daha fazla eğit ... 50 dolar bakiye 30 dolar marj 10x ile canlıya").
//  - ZİRVE-5 confirmation body 50 % -> 30 % (harness/zirve5/z5_conf.js: n36 +0.22R -> n44 +0.31R, both halves positive, 5/5 weeks);
//  - JEV reads what was measured for each lane (research priors; İlk 3 v2 had none);
//  - Office shows what ONE stop costs with a fixed margin (before LIVE).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Z=require('../zirve5');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('R2544.75 ZİRVE-5 confirmation: body >= 30 % (volume 1.5x and the sweep requirement unchanged)',()=>{
  assert.equal(Z.DEFAULT_CONFIG.bodyMin,0.3);assert.equal(Z.DEFAULT_CONFIG.volMult,1.5);assert.equal(Z.DEFAULT_CONFIG.requireSweep,true);
  const c=[];for(let i=0;i<100;i++)c.push({open:100,high:100.2,low:99.8,close:100,quoteVolume:1000});
  const zone={side:'SHORT',top:100.5,bottom:99.5};
  c.push({open:100.2,high:100.3,low:99.9,close:100.07,quoteVolume:2000});   // body 0.13 / range 0.4 = 33 %
  assert.equal(Z.confirmation(c,100,zone).ok,true);
  c[100]={...c[100],close:100.12};                                          // body 0.08 / 0.4 = 20 %
  assert.equal(Z.confirmation(c,100,zone).ok,false);
});
test('R2544.75 JEV research priors: ZİRVE-5 states the measured +0.31R rule; İlk 3 v2 has one per sub-strategy and names the sweep requirement',()=>{
  const j=src('jev-decision.js');
  assert.match(j,/n 44, \+0\.31R per trade, both halves of the month positive/);assert.ok(!j.includes('n 62, about -0.02R per trade'),'the outdated prior is gone');
  assert.match(j,/TOP SHORT with the SFP sweep requirement, live signals 14\.10-22\.10 replayed with the live plan: n 16/);
  assert.match(j,/EARLY LONG, live signals 14\.10-22\.10 replayed with the live plan: n 22/);
  assert.match(j,/after a liquidity sweep \(SFP: a wick beyond a swing high and a close back below\)/);
});
test('R2544.75 Office: one stop with a fixed margin is shown in USDT and % of the account before LIVE; the ZİRVE-5 text shows the new measurement',()=>{
  const h=src('office-dashboard/public/office.html');
  assert.match(h,/function stopRiskLine\(margin,lev,medStop,maxStop,avail,lane\)/);
  assert.match(h,/stopRiskLine\(zs\.marginQuote,zs\.leverage,0\.055,0\.079,av,'ZİRVE-5'\)/);assert.match(h,/stopRiskLine\(st\.marginQuote,st\.leverage,0\.028,0\.06,/);
  assert.match(h,/44 işlem \(günde ~1,4\), <b>\+0,31 R\/işlem<\/b>/);
  // the line itself: 30 USDT x 10x on a 50 USDT account, median stop 5.5 % -> 16.5 USDT = 33 % (red)
  const fn=h.slice(h.indexOf('function stopRiskLine'),h.indexOf('function mtfTr'));
  const esc=x=>String(x);const line=new Function('esc',fn+';return stopRiskLine;')(esc)(30,10,0.055,0.079,50,'ZİRVE-5');
  assert.match(line,/≈ <b>16\.5 USDT<\/b> \(hesabın %33’i\)/);assert.match(line,/class="bad"/);assert.match(line,/23\.7 USDT \(hesabın %47’i\)/);
  assert.match(new Function('esc',fn+';return stopRiskLine;')(esc)(30,10,0.028,0.06,50,'İlk 3'),/ortanca stop %2,8 → ≈ <b>8\.4 USDT<\/b> \(hesabın %17’i\)/,'no float noise (%2,8000000000000003)');
});
