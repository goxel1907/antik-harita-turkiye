'use strict';
// R2544.88 GRAFİK OKUMASI (kullanıcı 27.10: "price action, fvg, fibo, trend kısacası grafik okumayı hangi model yapacak"): grafiği kod
// (engine.js, JEV ile aynı, yalnız kapanmış mumlar) hesaplar; kurulda "price action" koltuğu (Claude Sonnet 4.5) yorumlar; 5 koltuk.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const TB=require('../trader-brain');
const H=3600000,T0=Date.UTC(2026,9,20,12,0,0);
// up-leg then pull-back: swings, a fib leg and FVG history exist; Binance raw rows incl. closeTime and taker quote
function raw(n,ms,end){const out=[];for(let i=0;i<n;i++){const t=end-(n-i)*ms,base=i<n*0.6?100+i*0.8:100+n*0.48-(i-n*0.6)*0.5,w=Math.sin(i/2.3)*1.2,o=base+w,c=base-w*0.6;
  out.push([t,o,Math.max(o,c)+0.9,Math.min(o,c)-0.9,c,1000+i,t+ms-1,(1000+i)*base,10,500,(500)*base]);}return out;}
test('R2544.88 chart reading: computed by code on CLOSED candles only, scaled to the screen, distances in R (+ = trade direction)',()=>{
  const k=raw(90,H,T0);k.push([T0,150,400,1,300,9e9,T0+H-1,1,1,1,1]); // a candle still open at t: must be ignored
  const P=x=>+(x*100/140).toFixed(3),R=p=>+((p-140)/5).toFixed(2);
  const r=TB.chartReading(k,'1h',{t:T0,P,R});
  assert.ok(r,'available');for(const f of ['trend','swing','events','openFvg','fib','dealingRange','orderBlocks','patterns','liquidity','momentum'])assert.ok(f in r,f);
  assert.ok(!JSON.stringify(r).includes('285.714'),'the open candle (close 400 -> 285.714) is not read');
  if(r.fib)for(const v of Object.values(r.fib.levels))assert.equal(v.R,+(((v.price*1.4)-140)/5).toFixed(2));
  assert.equal(TB.chartReading(raw(30,H,T0),'1h',{t:T0}),null,'fewer than 52 closed candles -> no reading, never invented');
  assert.deepEqual(TB.FETCH,{m5:80,m15:80,h1:80,h4:80,d1:80});
});
test('R2544.88 the screen carries a chartReading per timeframe and the system prompt tells models to trust it; 5 seats with a price-action seat',()=>{
  const end=T0,k={m5:raw(90,300000,end),m15:raw(90,900000,end),h1:raw(90,H,end),h4:raw(90,4*H,end),d1:raw(90,24*H,end),btc1h:raw(40,H,end)};
  const p=TB.entryPacket({k,plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:140,stop:135,target:155},t:T0});
  for(const tf of ['m5','m15','h1','h4','d1'])assert.ok(p.timeframes[tf].chartReading,tf);
  assert.match(TB.ENTRY_SYSTEM,/chartReading computed by code/);assert.match(TB.ENTRY_SYSTEM,/trust the chartReading numbers/);
  assert.deepEqual(TB.ENTRY_ROLES.map(r=>r.key),['1g/4sa','price action','5dk+akış','risk','1sa/15dk']);
  assert.match(TB.ENTRY_ROLES[1].text,/FVGs, Fibonacci\/OTE, premium\/discount, order blocks, patterns/);
  assert.ok(JSON.stringify(p).length<40000,'stays small for free models');
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/const chart=\{m15:TB\.chartReading\(k15\.raw,'15m',\{t:now,R:Rf\}\),h1:TB\.chartReading\(k1h\.raw,'1h',\{t:now,R:Rf\}\)\};/,'the desk sees it too');
  assert.match(lc,/m15:await get\(lot\.symbol,'15m',TB\.FETCH\.m15,end\)/,'live entry committee fetches enough candles');
});
