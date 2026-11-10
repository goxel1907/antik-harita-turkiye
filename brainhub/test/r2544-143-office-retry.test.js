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
