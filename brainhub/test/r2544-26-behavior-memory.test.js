'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const lessons=require('../trade-lessons');

test('R2544.26 behavior memory is soft and captures MFE giveback/NONE_WAIT without veto',()=>{
  const c=lessons.lessonCard({
    id:'x',symbol:'ALICEUSDT',side:'LONG',netPnl:-7.49,rMultiple:-1.63,riskQuote:5,initialQuantity:1,
    stopDistancePct:1.2,holdMinutes:35,exitType:'STOP_LOSS',openedAt:'2026-09-30T01:00:00Z',closedAt:'2026-09-30T01:35:00Z',
    entryContext:{setupFamily:'NONE_WAIT',entryTiming:'NONE_WAIT',lane:'15M_TRADE'},
    outcomePath:{mfeR:0.25,maeR:-1.1,timeToMfeMin:4,timeToMaeMin:8,rMultiple:-1.63}
  });
  assert.equal(c.exitAuthority,'SYSTEM');
  assert.equal(c.outcome.maeR,-1.1);
  assert.ok(c.tags.includes('NONE_WAIT_LOSS'));
  assert.equal(c.tags.includes('MFE_GIVEBACK_GE_1R'),true);
  assert.match(c.lesson,/otomatik veto değildir/);
  assert.equal('canVeto' in c,false);
});

test('R2544.26 external close is not attributed to JEV exit authority',()=>{
  assert.equal(lessons.exitAuthorityOf('EXTERNAL_CLOSE'),'EXTERNAL');
  assert.equal(lessons.exitAuthorityOf('JEV_PARTIAL_THEN_EXTERNAL_CLOSE'),'JEV_PARTIAL_THEN_EXTERNAL');
  assert.equal(lessons.exitAuthorityOf('JEV_EXIT_NOW'),'JEV');
});
