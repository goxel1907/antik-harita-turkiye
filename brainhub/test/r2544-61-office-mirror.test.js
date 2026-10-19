'use strict';
// R2544.61 (user 19.10 video): the chart list followed the old JEV lane, not İlk 3 / top 24; a 300 USDT İlk 3 margin
// with a 151.58 USDT TEST wallet blocked every entry silently (ARCUSDT 17:30 TOP3_MARGIN_ABOVE_FREE_BALANCE).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
function fnSrc(name){const i=html.indexOf('function '+name+'(');let d=0,j=html.indexOf('{',i);for(let k=j;k<html.length;k++){if(html[k]==='{')d++;else if(html[k]==='}'){d--;if(!d)return html.slice(i,k+1);}}}

test('R2544.61 mirror list: open positions, then İlk 3 coins, then the top 24 ladder; old JEV plans only while OTO runs',()=>{
  const mirrorCandidates=new Function(fnSrc('mirrorCandidates')+';return mirrorCandidates;')();
  const s={positions:{data:{open:[{symbol:'XUSDT'}]}},top3:{active:[{symbol:'AAAUSDT'}],lastScan5:{signals:[{symbol:'SIGUSDT'}],nearMisses:[{symbol:'NEARUSDT'}]},recentSignals:[{symbol:'RECUSDT'}]},
    ladder:{gainerLadder:{rows:[{symbol:'BRUSDT',rank:1},{symbol:'GTCUSDT',rank:2},{symbol:'AAAUSDT',rank:5}]}},plans:[{symbol:'OLDPLANUSDT'}],
    status:{data:{leaderAuto:{analysisLifecycle:{rows:[{symbol:'OLDROWUSDT'}]}},tradingMode:{run:{lanes:{normal:{active:false}}}}}}};
  assert.deepEqual(mirrorCandidates(s),['XUSDT','AAAUSDT','SIGUSDT','NEARUSDT','RECUSDT','BRUSDT','GTCUSDT']);
  s.status.data.tradingMode.run.lanes.normal.active=true;
  const on=mirrorCandidates(s);assert.ok(on.includes('OLDPLANUSDT')&&on.includes('OLDROWUSDT'),'normal system on: its coins too');
  assert.deepEqual(mirrorCandidates({}),['BTCUSDT']);
});

test('R2544.61 İlk 3 margin above 95 % of the free balance shows a warning (after html is declared)',()=>{
  const r=fnSrc('renderTop3');assert.ok(r,'renderTop3 found');
  const w=r.indexOf('R2544.61_MARGIN_WARN'),h=r.indexOf('let html=');
  assert.ok(w>h&&h>0,'warning appended after let html');
  assert.match(r,/mq>av\*0\.95/);assert.match(r,/İlk 3 işlem AÇAMAZ/);
  assert.match(html,/rankOf\.has\(x\)\?'#'/,'options show the ladder rank');
});
