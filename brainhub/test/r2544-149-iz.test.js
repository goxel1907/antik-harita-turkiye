'use strict';
// R2544.149 İZ: the footprints of bots and market makers (public Binance data) become trace rules ("iz askerleri"); each one writes its own
// forecast and is scored forward in the KEŞİF karne next to the models and the brain. Shadow: nothing reaches the exchange.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const IZ=require('../iz');
const M5=300000,M15=900000,H=3600000;
const NOW=Math.floor(Date.UTC(2026,10,12,12,0)/M5)*M5+20000;
// candles [t,o,h,l,c,v,closeT,quote,n,takerBuyBase]; px(i) = close of candle i (oldest first)
const kl=(ms,n,px,{wick=null}={})=>Array.from({length:n},(_,i)=>{const t=Math.floor(NOW/ms)*ms-(n-i)*ms,c=px(i),o=i?px(i-1):c;let h=Math.max(o,c)*1.001,l=Math.min(o,c)*0.999;if(wick&&wick[i]){if(wick[i].l)l=wick[i].l;if(wick[i].h)h=wick[i].h;}return [t,String(o),String(h),String(l),String(c),'1000',t+ms-1,'100000',10,'500'];});
const flat=()=>100;
const hist=(n,f,key)=>Array.from({length:n},(_,i)=>({timestamp:Math.floor(NOW/M5)*M5-(n-i)*M5,[key]:String(f(i,n))}));
const neutral=()=>({m5:kl(M5,61,flat),m15:kl(M15,40,flat),h1:kl(H,30,flat),oi:hist(49,()=>1000,'sumOpenInterest'),whale:hist(13,()=>1.2,'longShortRatio'),crowd:hist(13,()=>1.6,'longShortRatio'),
  taker:Array.from({length:12},(_,i)=>({timestamp:NOW-(12-i)*M5,buyVol:'100',sellVol:'100'})),depth:{bids:Array.from({length:50},(_,i)=>[String(100-i*0.05),'10']),asks:Array.from({length:50},(_,i)=>[String(100.05+i*0.05),'10'])},fundingRate:0.0001,liq:null,now:NOW});
const names=r=>IZ.fire(r).map(f=>`${f.name}:${f.forecast.direction}`).sort();

test('R2544.149 neutral market: every trace is read, no trace rule fires', ()=>{
  const r=IZ.read(neutral());
  assert.equal(r.priceChg1hPct,0);assert.equal(r.oiChg1hPct,0);assert.equal(r.takerRatio1h,1);assert.ok(Math.abs(r.book.imb2)<0.05);assert.equal(r.sweep,null);assert.equal(r.liq1h,null);
  assert.deepEqual(names(r),[]);
  assert.equal(IZ.read({...neutral(),m5:kl(M5,5,flat)}),null,'too few closed candles = no reading');
});

test('R2544.149 SÜPÜRME: the 6 h low taken by a wick and closed back inside = a stop hunt -> LONG, stop beyond the wick; both sides or none = nothing', ()=>{
  const x=neutral();const wick={38:{l:98.4}};x.m15=kl(M15,40,i=>i<38?100:100.1,{wick});  // last closed candles: index 37,38 (39 is still open)
  const r=IZ.read(x);assert.equal(r.sweep.side,'LOW');assert.ok(r.sweep.depthPct>1);
  const f=IZ.fire(r).find(z=>z.name==='SUPURME');assert.equal(f.forecast.direction,'LONG');
  assert.ok(f.forecast.stopPct>=1.2&&f.forecast.stopPct<=8);assert.equal(f.forecast.targetPct,+(f.forecast.stopPct*2).toFixed(2));assert.equal(f.forecast.horizonH,6);
  const y=neutral();y.m15=kl(M15,40,i=>i<38?100:99.9,{wick:{38:{h:101.6}}});assert.equal(IZ.fire(IZ.read(y)).find(z=>z.name==='SUPURME').forecast.direction,'SHORT');
  const poke=neutral();poke.m15=kl(M15,40,i=>i<38?100:100.1,{wick:{38:{l:99.85}}});assert.equal(IZ.read(poke).sweep,null,'a poke under 0,1 % beyond the low is noise');
  const both=neutral();both.m15=kl(M15,40,flat,{wick:{38:{l:98.4,h:101.6}}});assert.equal(IZ.read(both).sweep,null,'both sides swept: no readable hunt');
  const far=neutral();far.m15=kl(M15,40,i=>i<38?100:100.1,{wick:{38:{l:80}}});assert.equal(IZ.fire(IZ.read(far)).find(z=>z.name==='SUPURME'),undefined,'a wick beyond the 8% stop band is not traded');
});

test('R2544.149 AKIŞ (trend) and TASFİYE (flush) read the same footprints the other way; BALİNA, KALABALIK, DUVAR fire on their own thresholds', ()=>{
  // price +2%/1h, OI +5%/1h, buyers 1.3x sellers -> new long money -> AKIS LONG
  const a=neutral();a.m5=kl(M5,61,i=>i<48?100:100+(i-48)*0.17);a.oi=hist(49,(i)=>i<36?1000:1000+(i-36)*4.5,'sumOpenInterest');a.taker=a.taker.map(t=>({...t,buyVol:'130'}));
  assert.deepEqual(names(IZ.read(a)),['AKIS:LONG']);
  // price -2.5%/1h, OI -3%, 80k $ of longs liquidated vs 5k shorts, the last 5m candle green and no new low -> TASFIYE LONG
  const t=neutral();t.m5=kl(M5,61,i=>i<48?100:i<59?100-(i-47)*0.25:i===59?97.1:97.3);t.oi=hist(49,(i)=>i<36?1000:1000-(i-36)*2.6,'sumOpenInterest');t.liq={longQ:80000,shortQ:5000};t.depth={bids:Array.from({length:50},(_,i)=>[String(97.3-i*0.05),'10']),asks:Array.from({length:50},(_,i)=>[String(97.35+i*0.05),'10'])};
  assert.deepEqual(names(IZ.read(t)),['TASFIYE:LONG']);
  t.liq={longQ:80000,shortQ:40000};assert.deepEqual(names(IZ.read(t)),[],'no side clearly flushed = nothing');
  // big accounts +8% long in 1h while the crowd turns 4% short -> BALINA LONG
  const b=neutral();b.whale=hist(13,(i)=>i<1?1.2:1.3,'longShortRatio');b.crowd=hist(13,(i)=>i<1?1.6:1.53,'longShortRatio');assert.deepEqual(names(IZ.read(b)),['BALINA:LONG']);
  // funding 0.08% + crowd 2.6 long/short + price stalled -> KALABALIK SHORT
  const k=neutral();k.fundingRate=0.0008;k.crowd=hist(13,()=>2.6,'longShortRatio');assert.deepEqual(names(IZ.read(k)),['KALABALIK:SHORT']);
  // bids 3x the asks inside 2% and buyers not weaker -> DUVAR LONG; the same wall with sellers in control -> nothing
  const d=neutral();d.depth={bids:d.depth.bids.map(([p])=>[p,'30']),asks:d.depth.asks};assert.deepEqual(names(IZ.read(d)),['DUVAR:LONG']);
  d.taker=d.taker.map(x=>({...x,buyVol:'90'}));assert.deepEqual(names(IZ.read(d)),[]);
  const thin=neutral();thin.depth={bids:Array.from({length:50},(_,i)=>[String(100-i*0.001),'30']),asks:Array.from({length:50},(_,i)=>[String(100.001+i*0.001),'10'])};const rt=IZ.read(thin);
  assert.equal(rt.book.imb2,null,'the book reaches 0,05 %: the 2 % window is not measured');assert.deepEqual(names(rt),[],'no DUVAR from a book that does not cover the window');
});

test('R2544.149 the brain learns the traces (iz: formations) and the models see them without the coin name; thresholds are fixed in the file', ()=>{
  const a=neutral();a.m5=kl(M5,61,i=>i<48?100:100+(i-48)*0.17);a.oi=hist(49,(i)=>i<36?1000:1000+(i-36)*4.5,'sumOpenInterest');a.taker=a.taker.map(t=>({...t,buyVol:'130'}));
  const r=IZ.read(a),f=IZ.feats(r);
  assert.ok(f.includes('iz:fiyat_oi:FIYAT_UP_OI_UP'));assert.ok(f.includes('iz:oi1s:SERT_ARTIS'));assert.ok(f.includes('iz:akis:SERT_ALIS'));assert.ok(f.includes('iz:asker:AKIS_LONG'));assert.ok(f.every(x=>x.startsWith('iz:')));
  const v=IZ.view(r);assert.deepEqual(v.traceRulesFiring,['AKIS LONG']);assert.equal(v.openInterestChange1hPct,r.oiChg1hPct);
  assert.ok(!JSON.stringify(v).includes('"price"'),'no absolute price on the screen');
  assert.deepEqual(IZ.DETECTORS.map(d=>d.name),['SUPURME','TASFIYE','BALINA','KALABALIK','AKIS','DUVAR']);
  assert.equal(IZ.THRESHOLDS.akis.oiRisePct,3);assert.equal(IZ.THRESHOLDS.tasfiye.minQuote,50000);assert.equal(IZ.TARGET_X,2);assert.equal(IZ.HORIZON_H,6);
});

test('R2544.149 deploy lists carry iz.js (a missing file keeps the core from starting)', ()=>{
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(src('manage.ps1'),/'kesif\.js','iz\.js'/);assert.match(src('jev-brain/JEV-DEPLOY.ps1'),/'kesif\.js','iz\.js'/);
  assert.match(src('live-controller.js'),/const IZ=require\('\.\/iz'\)/);
});

// --- end to end: the scan reads every candidate coin, a firing rule writes its forecast, the round coin's packet carries the traces ---
const {writeTradingMode}=require('../binance-live-transport');
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
test('R2544.149 a KEŞİF tick: every candidate coin is read, AKIS fires on the coin with new long money, the models see the traces, the brain gets iz formations; only GET', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r149-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:false}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-11-12T08:00:00.000Z',testStartedAt:null,testAutoRun:false});
  const st={now:NOW,calls:[],asked:[]};
  const up=(ms,n)=>kl(ms,n,i=>ms===M5?(i<48?100:100+(i-48)*0.17):100);
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET',sym=u.searchParams.get('symbol');st.calls.push({m,p,sym});
    if(p==='/fapi/v1/time')return ok({serverTime:st.now});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'UPUSDT',priceChangePercent:'42',quoteVolume:'90000000',closeTime:st.now},{symbol:'DOWNUSDT',priceChangePercent:'-25',quoteVolume:'50000000',closeTime:st.now}]);
    if(p==='/fapi/v1/premiumIndex')return ok({lastFundingRate:'0.0001',markPrice:'100',indexPrice:'100'});
    if(p==='/fapi/v1/klines'){const ms={'5m':M5,'15m':M15,'1h':H,'4h':4*H,'1d':24*H}[u.searchParams.get('interval')],n=Math.min(80,Number(u.searchParams.get('limit'))||80);return ok(sym==='UPUSDT'?up(ms,n):kl(ms,n,flat));}
    if(p==='/futures/data/openInterestHist')return ok(hist(49,(i)=>sym==='UPUSDT'&&i>=36?1000+(i-36)*4.5:1000,'sumOpenInterest'));
    if(p==='/futures/data/takerlongshortRatio')return ok(Array.from({length:12},(_,i)=>({timestamp:NOW-(12-i)*M5,buyVol:sym==='UPUSDT'?'130':'100',sellVol:'100'})));
    if(p.startsWith('/futures/data/'))return ok(hist(13,()=>1.4,'longShortRatio'));
    if(p==='/fapi/v1/depth')return ok(neutral().depth);
    return ok({});};
  const events=[];
  const committee={poll:async a=>{st.asked.push({...a,prompt:typeof a.prompt==='function'?a.prompt('OVH:m1'):a.prompt});return {ok:true,asked:1,votes:[{member:'OVH:m1',ok:true,vote:a.parse('{"direction":"LONG","stopPct":2,"targetPct":4,"horizonH":3}')}]};},decide:async()=>({ok:false}),status:()=>({members:[],team:[]})};
  const c=require('../live-controller').createLiveController({root,clock:()=>st.now,store:{journal:(k,s,p)=>events.push({k,s,p}),recordLearning:()=>{}},scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-test-key-r149',apiSecret:'fake-test-secret-r149'},fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',deskJudges:{committee},
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}},liquidationHistory:{clusters:()=>({available:true,coverageFromMs:5*H,longLiquidatedQuote:1000,shortLiquidatedQuote:900})}}});
  const out=await c._testKesifTick();
  assert.deepEqual(out.iz,{coins:2,read:2,fired:1,labels:2});
  const s=c._testKesifState(),iz=s.open.filter(r=>r.model.startsWith('IZ:'));
  assert.deepEqual(iz.map(r=>[r.model,r.symbol,r.side]),[['IZ:AKIS','UPUSDT','LONG']]);assert.equal(iz[0].entryAt,Math.ceil(NOW/M5)*M5,'entry = the next 5m open (written before the outcome)');
  assert.equal(events.filter(e=>e.k==='IZ_FIRE').length,1);
  const pk=JSON.parse(st.asked[0].prompt);assert.deepEqual(pk.traces.traceRulesFiring,['AKIS LONG']);assert.ok(!st.asked[0].prompt.includes('UPUSDT'));assert.match(st.asked[0].system,/footprints of bots and market makers/);
  const lab=s.open.find(r=>r.model==='_ETIKET');assert.ok(lab.feats.includes('iz:asker:AKIS_LONG'));assert.ok(lab.feats.some(f=>f.startsWith('m5:')),'the chart formations stay');
  const ks=c.kesifStatus();assert.equal(ks.iz.open,1);assert.equal(ks.iz.last.fired[0].d,'AKIS');assert.equal(ks.iz.detectors.length,6);
  assert.ok(!st.calls.some(x=>x.m!=='GET'),'only public GET requests');
  // next cadence: the same rule on the same coin is still open -> no second forecast
  st.now+=16*60000;await c._testKesifTick();assert.equal(c._testKesifState().open.filter(r=>r.model==='IZ:AKIS').length,1);
  // the karne treats a trace rule like any member (not hidden like the label)
  const K=require('../kesif');const kr=K.karne([{model:'IZ:AKIS',done:true,R:1.5,side:'LONG',closedAt:1,at:0}]);assert.equal(kr.rows[0].model,'IZ:AKIS');
  assert.equal(K.brief({},[],K.brainCall({},[]),kr).desk.rows[0].trader,'trace rule AKIS');
});

test('R2544.149 SANAL ORTAM hand-over: the sandbox state at data/kesif-sanal.json is merged once (results marked SANAL, open forecasts and labels kept, matrix added), the file is renamed, never deleted', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r149s-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:false}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-11-12T08:00:00.000Z',testStartedAt:null,testAutoRun:false});
  const seed={sanal:{startedAt:'2026-11-12T02:00:00.000Z'},closed:[{id:'a:IZ:AKIS',model:'IZ:AKIS',symbol:'XUSDT',side:'LONG',at:NOW-9*H,closedAt:NOW-3*H,done:true,outcome:'TARGET',R:1.9},
      {id:'b:IZ:AKIS',model:'IZ:AKIS',symbol:'YUSDT',side:'SHORT',at:NOW-8*H,closedAt:NOW-2*H,done:true,outcome:'STOP',R:-1.1},{id:'c:BEYIN',model:'BEYIN',symbol:'XUSDT',side:'NONE',at:NOW-9*H,done:true,outcome:'NONE',R:null}],
    open:[{id:'d:IZ:DUVAR',model:'IZ:DUVAR',symbol:'ZUSDT',side:'LONG',at:NOW-H,entryAt:NOW-H+M5,stopPct:2,targetPct:4,horizonH:6,done:false},{id:'e:_ETIKET',model:'_ETIKET',symbol:'ZUSDT',side:'LONG',at:NOW-H,entryAt:NOW-H+M5,stopPct:2,targetPct:2,horizonH:6,done:false,feats:['iz:akis:ALIS']}],
    matrix:{_total:{n:4,UP:2,DOWN:1,FLAT:1},f:{'iz:akis:ALIS':{n:4,UP:2,DOWN:1,FLAT:1,hUP:5,hDOWN:2}}}};
  fs.writeFileSync(path.join(root,'data','kesif-sanal.json'),JSON.stringify(seed));
  const fetchImpl=async(url,o={})=>{if((o.method||'GET')!=='GET')throw new Error('GET only');return ok(new URL(url).pathname==='/fapi/v1/time'?{serverTime:NOW}:[]);};
  const committee={poll:async()=>({ok:false,votes:[],asked:0}),decide:async()=>({ok:false}),status:()=>({members:[],team:[]})};const events=[];
  const c=require('../live-controller').createLiveController({root,clock:()=>NOW,store:{journal:(k,s,p)=>events.push({k,s,p}),recordLearning:()=>{}},scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-test-key-r149s',apiSecret:'fake-test-secret-r149s'},fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',deskJudges:{committee},market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  const out=await c._testKesifTick();
  assert.deepEqual({closed:out.seed.closed,scored:out.seed.scored,open:out.seed.open,labels:out.seed.labels},{closed:3,scored:2,open:1,labels:5});
  const s=c._testKesifState();assert.ok(s.closed.filter(r=>r.src==='SANAL').length===3);assert.ok(s.open.some(r=>r.id==='d:IZ:DUVAR'&&r.src==='SANAL'));assert.ok(s.open.some(r=>r.model==='_ETIKET'&&r.feats.includes('iz:akis:ALIS')));
  assert.equal(s.matrix._total.n,4);assert.equal(s.matrix.f['iz:akis:ALIS'].hUP,5);
  const row=c.kesifStatus().karne.rows.find(r=>r.model==='IZ:AKIS');assert.equal(row.n,2);assert.equal(c.kesifStatus().seed.scored,2);
  const files=fs.readdirSync(path.join(root,'data'));assert.ok(!files.includes('kesif-sanal.json'));assert.ok(files.some(f=>/^kesif-sanal\.imported-\d+\.json$/.test(f)),'renamed, not deleted');
  assert.equal(events.filter(e=>e.k==='KESIF_SEED_IMPORT').length,1);
  // the same file again: nothing is counted twice
  fs.writeFileSync(path.join(root,'data','kesif-sanal.json'),JSON.stringify(seed));await c._testKesifTick();
  assert.equal(c._testKesifState().closed.length,3);assert.equal(c._testKesifState().open.filter(r=>r.id==='d:IZ:DUVAR').length,1);assert.equal(c._testKesifState().matrix._total.n,4,'the matrix is not added twice');assert.equal(c.kesifStatus().seed.scored,2);
  // a broken file is set aside, the core goes on
  fs.writeFileSync(path.join(root,'data','kesif-sanal.json'),'{bozuk');await c._testKesifTick();assert.ok(fs.readdirSync(path.join(root,'data')).some(f=>/^kesif-sanal\.invalid-/.test(f)));
});

test('R2544.149 the brain\'s learning proof: its probability (written before) against the base rate; "öğreniyor" only with 30 labels and skill in both halves', ()=>{
  const K=require('../kesif');
  assert.equal(K.learningCheck([]).state,'KANIT_YOK');
  const rows=(f)=>Array.from({length:40},(_,i)=>{const y=i%3===0?0:1;return {at:i,y,b:0.5,p:f(i,y)};});
  const good=K.learningCheck(rows((i,y)=>y?0.7:0.3));assert.equal(good.state,'OGRENIYOR');assert.ok(good.all.skillPct>0&&good.first.skillPct>0&&good.second.skillPct>0);assert.equal(good.all.leanHitPct,100);
  const blind=K.learningCheck(rows(()=>0.5));assert.equal(blind.state,'OGRENMIYOR','a brain that only repeats 50/50 is not learning');
  const late=K.learningCheck(rows((i,y)=>i<20?(y?0.3:0.7):(y?0.7:0.3)));assert.equal(late.state,'OGRENMIYOR','wrong in the old half: not proven yet');assert.ok(late.second.skillPct>0);
  assert.equal(K.learningCheck(rows((i,y)=>y?0.7:0.3).slice(0,29)).state,'KANIT_YOK');
});

test('R2544.149 BAKİYE ZAMANI: 40 forward results, average, without the best, lower bound and both halves above zero; 1R in $ from margin x leverage x stop', ()=>{
  const K=require('../kesif');const rec=(m,i,R,stop=2)=>({model:m,done:true,R,stopPct:stop,closedAt:i,at:i,side:'LONG'});
  const lucky=[...Array.from({length:39},(_,i)=>rec('IZ:SUPURME',i,-0.2)),rec('IZ:SUPURME',40,12)];
  const steady=Array.from({length:40},(_,i)=>rec('IZ:AKIS',i,i%2?1.2:-0.8,i%5?2:4));
  const short=Array.from({length:39},(_,i)=>rec('BEYIN',i,i%2?1.2:-0.8));
  const r=K.readiness([...lucky,...steady,...short,rec('_ETIKET',1,1)],{marginQuote:30,leverage:10});
  assert.equal(r.state,'HAZIR');assert.deepEqual(r.ready.map(x=>x.model),['IZ:AKIS']);
  const a=r.ready[0];assert.equal(a.oneR.medianUsd,6,'30 $ x 10 x 2 %');assert.equal(a.oneR.widestUsd,12);assert.equal(a.worstLosingStreak,1);
  const l=r.near.find(x=>x.model==='IZ:SUPURME');assert.equal(l.checks.exBest,false,'one lucky +12R does not make it ready');
  assert.equal(r.near.find(x=>x.model==='BEYIN').checks.n,false);
  assert.equal(K.readiness([]).state,'DEGIL');assert.match(K.readiness(short).tr,/henüz değil/);
});
