'use strict';
// R2544.143 (10.11 16:58: "PHAROS kapatılmadı: ECONNRESET" - the core was up, the request never reached it). A socket reset is retried
// once for requests that are safe twice (close / lanes / sizing / strategy settings); mode / run / arm / system never.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
test('R2544.143 Office retries a reset connection once for the close; never for a mode switch',async t=>{
  const hits={};
  const brain=http.createServer((req,res)=>{const p=req.url.split('?')[0];hits[p]=(hits[p]||0)+1;
    if(hits[p]===1&&(p==='/live/position/close'||p==='/live/mode')){req.socket.destroy();return;}  // the core drops the connection
    let b='';req.on('data',c=>b+=c);req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,path:p}));});});
  await new Promise(r=>brain.listen(0,'127.0.0.1',r));t.after(()=>brain.close());
  process.env.BRAINHUB_URL='http://127.0.0.1:'+brain.address().port;process.env.BRAINHUB_CLIENT_TOKEN='fake-office-token-r143';
  process.env.BRAINHUB_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'r143-'));delete process.env.OFFICE_KEY;
  const office=require('../office-dashboard/office-server.js');
  await new Promise(r=>office.server.listen(0,'127.0.0.1',r));t.after(()=>office.server.close());
  const base='http://127.0.0.1:'+office.server.address().port;
  const post=(p,body)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json','x-jev-office-control':'1'},body:JSON.stringify(body)});
  const c=await post('/api/control/close',{id:'t33bedd5e3ae7592'});assert.equal(c.status,200,'the close went through on the second try');
  assert.equal(hits['/live/position/close'],2);
  const m=await post('/api/control/mode',{mode:'TEST',confirm:'TEST'});assert.notEqual(m.status,200,'a mode switch is never resent');
  assert.equal(hits['/live/mode'],1);
});
test('R2544.143 the card says a reset changed nothing and asks for another press',()=>{
  const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(h,/bağlantı bir anlık koptu, hiçbir şey yapılmadı; tekrar bas/);
});

test('R2544.144 a saved margin / leverage shows at once (the card refreshes right after Kaydet)',()=>{
  const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  const i=h.indexOf('async function wcSave(r){'),j=h.indexOf('\n}',i);assert.ok(i>0&&j>i);
  assert.match(h.slice(i,j+2),/finally\{WC\.busy=false;\}\n  try\{await tick\(\);\}catch\{\}/);
});

test('R2544.145 positions read: exit evidence picked once (was 126 543 rows x 460 closes, ~1.2 s core stall per call); same result',()=>{
  const op=require('../office-performance');
  const recs=[];for(let i=0;i<5000;i++)recs.push({kind:'R2542_OFFICE_EVENT',id:'e'+i,ts:i,symbol:'X',payload:{}});
  const row={id:'c1',symbol:'ABCUSDT',side:'LONG',openedAt:'2026-11-01T00:00:00.000Z',closedAt:'2026-11-01T01:00:00.000Z',exitType:'EXTERNAL_CLOSE',netPnl:-1};
  recs.push({kind:'CLOSE_EXIT_EVIDENCE',id:'v1',ts:9,symbol:'ABCUSDT',payload:{closedId:'c1',openedAt:row.openedAt,closedAt:row.closedAt,evidence:{confirmed:true,exitType:'STOP'}}});
  const out=op.enrichCloses([row],recs)[0];assert.equal(out.exitType,'STOP','evidence still applied');
  const src=fs.readFileSync(path.join(__dirname,'..','office-performance.js'),'utf8');assert.match(src,/const evidence=records\.filter\(x=>x\.kind==='CLOSE_EXIT_EVIDENCE'\);/);assert.match(src,/exitCorrectionFor\(row,evidence\)/);
  const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');assert.match(h,/kart son bilinen değerleri gösteriyor/);
});

test('R2544.146 the phone 60 s sizing copy (no source) never overwrites a size typed in Office; Office Kaydet names its source',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),os2=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  const i=sv.indexOf("u.pathname==='/live/leader-auto'){\n      let body;"),j=sv.indexOf('const out=live.configureLeaderAuto(otoBody);',i);assert.ok(i>0&&j>i);
  assert.match(sv.slice(i,j),/if\(!otoSource\)for\(const k of \['marginQuote','leverage','maxOpenPositions','burstMarginQuote','burstMaxLeverage','burstFreeMarginFraction'\]\)delete otoBody\[k\];/);
  const k=os2.indexOf("'/api/control/sizing': b =>"),l=os2.indexOf("'/api/control/close': b =>",k);assert.match(os2.slice(k,l),/out\.source = 'OFFICE';/);
});

test('R2544.146 no Office key form (kullanıcı 10.11: "officeden api girme olmasın"); the phone route exists; phone lots carry their id',()=>{
  const os2=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8'),sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.ok(!/\/live\/credentials/.test(os2),'Office cannot reach the key route');
  assert.match(sv,/u\.pathname==='\/live\/credentials'\)\{[\s\S]{0,300}live\.updateCredentials\(/);
  const ms=fs.readFileSync(path.join(__dirname,'..','mobile-status.js'),'utf8');assert.match(ms,/pick\(a,\['id','symbol',/);
});
