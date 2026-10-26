'use strict';
// R2544.83 (kullanıcı 26.10: "hata var mı" - QNT ve ARIA açık lotlarında indikatör bilgisi / giriş bağlamı boştu): bilgi sinyal mumunun
// kapanış fiyatıyla hesaplanıyordu, orada stop aralık dışı (V2_STOP_OUT_OF_RANGE) kaldı. Artık lot açıldıktan sonra GERÇEK giriş ve ilk
// stopla yeniden hesaplanır; açık lotlar ve bilgisi başarısız kalmış dersler bir kez daha doldurulur. Yalnız bilgi: emirlere dokunmaz.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const AUTOPSY=require('../trade-autopsy');
const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
const fnBody=name=>{const i=lc.indexOf('async function '+name+'(');assert.ok(i>0,name);const j=lc.indexOf('\n  }\n',i);return lc.slice(i,j);};
test('R2544.83 info after open: computed from the REAL entry and first stop, only when missing, never touches orders',()=>{
  const b=fnBody('top3InfoAfterOpen');
  assert.match(b,/finite\(lot\.entryPrice\)/);assert.match(b,/finite\(lot\.initialStopPrice\)\?\?finite\(lot\.stopPrice\)/);
  assert.match(b,/if\(f\.ind\?\.ok&&f\.entryCtx\)return \{skipped:true\}/,'already complete -> nothing recomputed');
  assert.match(b,/if\(!f\.ind\?\.ok\)/);assert.match(b,/atEntry:true/);
  assert.match(b,/f\.experience=top3Lib\.experienceVerdict/);assert.match(b,/f\.similar=similarKeep/);
  assert.doesNotMatch(b,/placeAlgo|cancel|_signed|newOrder|stopPrice=|tpPrice=/,'information only');
  assert.match(b,/catch\{return null;\}/,'a failure never breaks the entry');
  // called right after a v2 lot opened, with the 5m tail of the signal
  assert.match(lc,/if\(opened\.ok\)\{top3State\.lastEntry=[^\n]*\n[^\n]*\n\s*await top3InfoAfterOpen\(Object\.values\(top3State\.active\|\|\{\}\)\.find\(a=>a&&a\.symbol===x\.symbol&&a\.lane!=='ZIRVE5'\),\{interval:'5m'[^\n]*tail:x\.k5tail\}\);\}/);
});
test('R2544.83 backfill: open lots once (entry-time candles and BTC), then lessons whose info FAILED get one more pass',()=>{
  const b=fnBody('lessonIndBackfillTick');
  assert.match(b,/a\.lane!=='ZIRVE5'&&top3Lib\.CAT_BUCKETS\[a\.rule\]&&!a\.entryFeatures\?\.ind\?\.ok&&!a\.info83Tried/,'only v2 rules (the ones with info tables)');
  assert.match(b,/a\.info83Tried=true/,'each open lot only once');
  assert.match(b,/k5Window\(a\.symbol,end-6\*M\+1,end\)/);assert.match(b,/k5Window\('BTCUSDT',end-12\*M\+1,end\)/);
  assert.match(b,/if\(st\.done&&st\.v!=='R2544\.83'\)\{st\.done=false;st\.v='R2544\.83';\}/);
  assert.match(b,/!l\.features\?\.ind\?\.ok&&!l\.indBackfillTried83/,'failed (ok:false) info is retried, not only missing info');
  assert.doesNotMatch(b,/placeAlgo|cancel|newOrder/);
});
test('R2544.83 entry context from the real entry: a stop the signal-close plan rejected still gives a context',()=>{
  const t0=1790000000000,M5=300000,k=[];for(let i=0;i<6;i++){const p=100+i*0.2;k.push([t0+i*M5,p,p+0.3,p-0.3,p+0.1,1000]);}
  const c=AUTOPSY.entryContext(k,'LONG',101.2,99.0,[]);
  assert.ok(c);assert.equal(c.stopPct,Number((2.2/101.2).toFixed(4)));assert.equal(c.btc1hWith,null,'no BTC candles -> null, not a guess');
  assert.equal(AUTOPSY.entryContext(k.slice(0,3),'LONG',101.2,99.0,[]),null,'too few candles');
});
