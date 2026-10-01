'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const TL=require('../trade-lessons');

const root=path.resolve(__dirname,'..');
const src=f=>fs.readFileSync(path.join(root,f),'utf8');

function close({symbol,side='LONG',openedAt,closedAt,net,r=0.5,exit='JEV_EXIT_NOW',trend5='UP',trend15='UP',chaseLong='LOW',chaseShort='LOW',stretch='NORMAL'}){
  return {
    id:symbol+closedAt,symbol,side,openedAt,closedAt,netPnl:net,rMultiple:r,riskQuote:10,initialQuantity:100,stopDistancePct:1,
    exitType:exit,holdMinutes:10,tradeLane:'5M_SCALP',
    entryContext:{
      setupFamily:'TEST_SETUP',entryTiming:'MARKET_NOW',
      marketSignature:{
        regime5m:{trend:trend5,readout:{chaseLong,chaseShort,stretchState:stretch}},
        regime15m:{trend:trend15,readout:{chaseLong,chaseShort,stretchState:stretch}}
      }
    }
  };
}

test('R2544.17 MOVR/SOON tipi hızlı rotasyonu ve kazanç geri-verimini öğrenme bağlamına taşır',()=>{
  const rows=[
    close({symbol:'SOONUSDT',openedAt:'2026-09-30T10:20:00Z',closedAt:'2026-09-30T10:49:00Z',net:7.11,r:0.76,exit:'TP1_RUNNER_TRAIL'}),
    close({symbol:'MOVRUSDT',openedAt:'2026-09-30T10:51:00Z',closedAt:'2026-09-30T11:01:00Z',net:-13.51,r:-0.42,exit:'JEV_EXIT_NOW'})
  ];
  const cards=TL.buildCards(rows);
  const movr=cards[1];
  assert.ok(movr.tags.includes('QUICK_SYMBOL_SWITCH_AFTER_WIN'));
  assert.ok(movr.tags.includes('WIN_GIVEBACK_SEQUENCE'));
  const d=TL.digest(cards,{candidate:{symbol:'SOONUSDT'},symbol:'SOONUSDT',now:Date.parse('2026-09-30T11:03:00Z')});
  assert.equal(d.sequence.quickSwitchAfterLoss,true);
  assert.equal(d.sequence.returnToRecentSymbol,true);
  assert.equal(d.sequence.recent60.symbolSwitches,1);
  assert.equal(d.sequence.recent60.net,-6.4);
});

test('R2544.17 aynı sembolde hızlı yön terslemeyi etiketler',()=>{
  const rows=[
    close({symbol:'AAAUSDT',side:'LONG',openedAt:'2026-09-30T10:00:00Z',closedAt:'2026-09-30T10:10:00Z',net:4,r:0.7,exit:'TP1_RUNNER_TRAIL'}),
    close({symbol:'AAAUSDT',side:'SHORT',openedAt:'2026-09-30T10:15:00Z',closedAt:'2026-09-30T10:25:00Z',net:-5,r:-0.8})
  ];
  const c=TL.buildCards(rows)[1];
  assert.ok(c.tags.includes('SAME_SYMBOL_DIRECTION_FLIP_AFTER_WIN'));
});

test('R2544.17 rejim bağlamı trend ile yön ilişkisini ve chase/stretch bilgisini korur',()=>{
  const k=TL.regimeKeyFromSignature({
    regime5m:{trend:'UP',readout:{chaseLong:'HIGH',stretchState:'EXTENDED'}},
    regime15m:{trend:'UP',readout:{chaseLong:'MEDIUM',stretchState:'NORMAL'}}
  },'LONG');
  assert.match(k,/TREND_UP_ALIGNED/);
  assert.match(k,/WITH_TREND/);
  assert.match(k,/CHASE_HIGH/);
  assert.match(k,/STRETCHED/);
});

test('R2544.17 Office kartı canlı 60dk ile lifetime kapanışları ayırır',()=>{
  const html=src('office-dashboard/public/office.html');
  assert.match(html,/CANLI — SON 60 DK/);
  assert.match(html,/KAPANMIŞ İŞLEMLER — TÜM GEÇMİŞ \/ İŞLEM SÖZLEŞMESİ/);
  assert.match(html,/R2542 etiketi runtime sürümü değil işlem telemetrisi sözleşmesidir/);
});

test('R2544.17 9Router cooldown sonrası denenmiş başarısız modeli untested diye gizlemez',()=>{
  const server=src('server.js');
  assert.match(server,/function textModelStatus\(model\)/);
  assert.match(server,/return blocked\(model\)\?'cooldown':'failed'/);
  assert.match(server,/const attempts=Number\(st\.attempts\|\|\(\(text\|\|vision\)\?1:0\)\)/);
});

test('R2544.17 curated OSS registry karar kalitesi araştırma kaynaklarını içerir',()=>{
  const k=src('knowledge-research.js');
  for(const repo of ['microsoft/qlib','online-ml/river','nkaz001/hftbacktest','AgentJDrew/backtest-guard','landtml/purgedcv'])assert.ok(k.includes(repo),repo);
});

test('R2544.26 sürüm kimliği',()=>{
  assert.match(src('server.js'),/const RUNTIME_RELEASE='R2544\.26-RESEARCH-HARDENING'/);
  assert.match(src('office-dashboard/office-server.js'),/OFFICE_VERSION = '2\.5\.6-R2544\.26-JEV-Brain'/);
});
