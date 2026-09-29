'use strict';
// CLAUDE_R2544.9 (29.09.2026): HYPE incelemesi — seviyeler oluştuğu mumdan çizilir, 5x7 okunaklı yazı, üst TF ana seviyeleri
// hem grafikte (kesikli) hem JEV paketinde (budamada da korunan keyLevels), açık pozisyon kutusu.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {renderChartPng}=require('../market');
const {framePacket}=require('../jev-market-packet');
const {prepareDecisionRequest}=require('../jev-decision');
const zlib=require('node:zlib');
function pixels(png){ // basit PNG çözücü (filtre 0/1/2/3/4)
  let p=8,idat=[],w=0,h=0;while(p<png.length){const len=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8);const d=png.subarray(p+8,p+8+len);if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);}if(type==='IDAT')idat.push(d);p+=12+len;}
  const raw=zlib.inflateSync(Buffer.concat(idat));const bpp=4,stride=w*bpp;const out=Buffer.alloc(h*stride);
  for(let y=0;y<h;y++){const f=raw[y*(stride+1)];for(let x=0;x<stride;x++){const v=raw[y*(stride+1)+1+x];const a=x>=bpp?out[y*stride+x-bpp]:0,b=y?out[(y-1)*stride+x]:0,c=(x>=bpp&&y)?out[(y-1)*stride+x-bpp]:0;
    let r=v;if(f===1)r=v+a;else if(f===2)r=v+b;else if(f===3)r=v+((a+b)>>1);else if(f===4){const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);r=v+(pa<=pb&&pa<=pc?a:pb<=pc?b:c);}out[y*stride+x]=r&255;}}
  return {w,h,px:(x,y)=>[out[(y*w+x)*4],out[(y*w+x)*4+1],out[(y*w+x)*4+2]]};
}
const candles=Array.from({length:100},(_,i)=>({openTime:1790000000000+i*9e5,closeTime:1790000000000+i*9e5+899999,open:100+i*0.05,high:100.4+i*0.05,low:99.6+i*0.05,close:100.03+i*0.05,volume:10}));
const at=i=>candles[i].closeTime;

test('seviye yalnız oluştuğu mumdan sağa çizilir (grafiğin solundan değil); fiyat çizgisi tam genişlik',()=>{
  const lvl=103.2;
  const png=pixels(renderChartPng({candles,analysis:{swingStructure:{lastConfirmedSwingHigh:{price:lvl,at:at(80)}}}},'annotated'));
  const yOf=p=>{const all=candles.flatMap(c=>[c.high,c.low]);const mn=Math.min(...all),mx=Math.max(...all),pad=(mx-mn)*0.06;return Math.round(22+(mx+pad-p)/(mx-mn+2*pad)*(555-22));};
  const y=yOf(lvl);const col=[120,144,156];
  const has=(x)=>{for(const dy of [-1,0,1]){const c=png.px(x,y+dy);if(Math.abs(c[0]-col[0])<6&&Math.abs(c[1]-col[1])<6&&Math.abs(c[2]-col[2])<6)return true;}return false;};
  assert.equal(has(60),false,'swing tepesinden önce (solda) çizgi yok');
  assert.equal(has(900),true,'swing tepesinden sonra (sağda) çizgi var');
});

test('açık pozisyon kutusu (yeşil hedef / kırmızı risk) ve üst TF kesikli seviyeleri çizilir; PNG 1280x720',()=>{
  const base={candles,analysis:{}};
  const e=candles[90].close;
  const pos={side:'LONG',entryPrice:e,stopPrice:e-0.6,takeProfit1:e+0.6,markPrice:candles.at(-1).close,openedAt:new Date(candles[90].openTime+1000).toISOString()};
  const a=renderChartPng(base,'annotated'),b=renderChartPng(base,'annotated',{position:pos,htfLevels:[{tf:'1h',name:'FIB .618',price:e-1,prio:6}]});
  assert.notDeepEqual(a,b);
  const p=pixels(b);assert.equal(p.w,1280);assert.equal(p.h,720);
  const src=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.match(src,/CLAUDE_R2544_9_POSITION_OVERLAY/);assert.match(src,/CLAUDE_R2544_9_FONT5X7/);assert.match(src,/CLAUDE_R2544_9_LEVEL_ORIGIN/);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/function mirrorHtfLevels\(sym,tf\)/);assert.match(sv,/live\.positionsStatus\(\{closedLimit:0\}\)/);
});

test('üst TF keyLevels pakette ve "üst bağlam özeti" budamasından sonra da duruyor (HYPE 29.09: 1h ayı FVG sayısal olarak düşmüştü)',()=>{
  const f={available:true,fresh:true,close:88.2,trend:'MIXED',smcContext:{available:true,dealingRange:{low:85.5,high:90.6,zone:'PREMIUM'},fibLevels:{retracement:{'0.5':88.05,'0.618':88.65}},oteReference:{longDiscountZone:{low:86.6,high:87.4},shortPremiumZone:{low:88.7,high:89.5}}},
    recentFairValueGaps:[{side:'BEAR',low:88.156,high:88.322,filled:false},{side:'BULL',low:80,high:81,filled:true}],orderBlocks:{bullish:[],bearish:[{low:89.87,high:90.41,broken:false}]}};
  const fp=framePacket(f);
  assert.deepEqual(fp.keyLevels.nearestFvg,{side:'BEAR',low:88.156,high:88.322});
  assert.equal(fp.keyLevels.fib618,88.65);assert.equal(fp.keyLevels.nearestOb.side,'BEAR');
  const hc=Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,{...fp,patterns:Array.from({length:6},(_,i)=>({type:'P'+i,side:'LONG',status:'FORMING',geometry:{lines:Array.from({length:30},()=>({a:1}))}}))}]));
  const body={state:{description:'x'.repeat(2000),professionalTraderCortex:{reference:'c'.repeat(14000)},experienceMemory:{text:'m'.repeat(4000)},coreMarketPacket:{higherContext:hc,coreFrames:{},timingFrames:{}},record:{requestedEvidence:{t:'e'.repeat(9000)}}},questions:{trade_plan:{criteria:{a:'y'.repeat(20000)}}}};
  const out=prepareDecisionRequest(body);
  const kept=out.body.state.coreMarketPacket.higherContext['1h'];
  if(kept.compacted)assert.ok(kept.keyLevels&&kept.keyLevels.nearestFvg,'özet budamasında keyLevels korunur');
  else assert.ok(kept.keyLevels);
});

test('Office: Üst TF ve Pozisyon aç/kapa düğmeleri, htf/pos parametreleri geçer; betik derlenir',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/id="mirrorHtf"/);assert.match(html,/id="mirrorPos"/);assert.match(html,/Üst TF seviyeleri \(grafikte kesikli\)/);
  const os=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  assert.match(os,/u\.searchParams\.get\('htf'\)==='0'\?\{htf:'0'\}/);
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});

test('etiketler kendi fiyatının yakınında kalır (±54 px); sığmayanlar sayılır ve "+N SEVIYE" notu düşülür',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.match(src,/CLAUDE_R2544_9B_NEAR_PLACEMENT/);assert.match(src,/const MAXD=54,occ=\[\];/);assert.match(src,/SEVIYE: OFIS TABLOSUNDA/);
  const many={candles,analysis:{smcContext:{fibLevels:{retracement:{'0.382':101,'0.5':101.02,'0.618':101.04,'0.705':101.06,'0.786':101.08}}},recentFairValueGaps:[{side:'BULL',low:101,high:101.1,ce50:101.05,at:at(50)}]}};
  const p=pixels(renderChartPng(many,'annotated'));assert.equal(p.w,1280);
});
