'use strict';
// R2544.142 (kullanıcı 10.11: en üstte cüzdan + marj/kaldıraç + açık pozisyonlar kartı, dolar cinsinden, Kapat düğmesi, animasyon)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8'),os=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8'),sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('R2544.142 the wallet card sits at the top (before the command center) and renders on every snapshot',()=>{
  assert.ok(h.indexOf('id="walletCard"')>0&&h.indexOf('id="walletCard"')<h.indexOf('id="ccCard"'));
  assert.match(h,/try\{renderWallet\(s\);\}catch\(e\)\{console\.warn\('wallet',e\);\}/);
  for(const k of ['Cüzdan','Özsermaye','Kullanılabilir','Açık kâr / zarar'])assert.ok(h.includes(`'${k}'`),k);
});
test('R2544.171 explicit versioned collateral saves independently from LIVE entry permission',()=>{
  for(const n of ['Normal sistem (JEV)','Vur-kaç','İlk 3 Avcısı','ZİRVE-5','KEŞİF-SÖZ'])assert.ok(h.includes("name:'"+n+"'"),n);
  assert.match(h,/Number.isFinite\(m\)&&m>0/);
  assert.match(os,/'\/api\/control\/sizing': '\/live\/sizing'/);
  const save=h.slice(h.indexOf('async function wcSave('),h.indexOf('\n}\n',h.indexOf('async function wcSave('))+2);
  assert.ok(!save.includes('secondPress('));assert.ok(!save.includes("confirm='LIVE'"));
  assert.match(save,/expectedRevision/);assert.match(save,/x\.d\.marginQuote/);
});
test('R2544.142 open lots in dollars (entry, mark, stop and target with their dollar value) and a Kapat button: second press, LIVE confirm, core route',()=>{
  assert.match(h,/const atS=q&&st&&e\?\(st-e\)\*q\*sg:null,atT=q&&tp&&e\?\(tp-e\)\*q\*sg:null/);
  assert.match(h,/if\(!secondPress\(b\.id,/);assert.match(h,/wcPost\('\/api\/control\/close',\{id,\.\.\.\(live\?\{confirm:'LIVE'\}:\{\}\)\}\)/);
  assert.match(os,/'\/api\/control\/close': '\/live\/position\/close'/);assert.match(os,/'\/api\/control\/close': b => \(\{ id: \/\^\[A-Za-z0-9:_-\]\{4,80\}\$\/\.test/);
  assert.match(sv,/u\.pathname==='\/live\/position\/close'/);assert.match(sv,/await live\.userCloseLot\(\{id:body\?\.id,confirm:body\?\.confirm\}\)/);
});
test('R2544.142 the animation respects reduced motion',()=>{
  assert.match(h,/@keyframes wcSpin/);assert.match(h,/@media \(prefers-reduced-motion:reduce\)\{\.wcard:before,\.wcard:after,\.wc-mode:before/);
});
test('R2544.142 the wallet card stays in the compact view (it was hidden by the compact keep-list in the first sandbox look)',()=>{
  assert.match(h,/const keep=new Set\(\['demoBanner','modeBar','walletCard','ccCard',/);
});

test('R2544.142 the card shows the paper account in TEST, the real Binance wallet on its own line, and fades in only new lots',()=>{
  const os=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(os,/'\/live\/real-wallet'/);assert.match(os,/realWallet: realWallet \?/);
  assert.match(sv,/u\.pathname==='\/live\/real-wallet'\)\{[^\n]*\n\s*const out=await live\.realWalletSummary\(\);/);
  assert.match(h,/tradingMode\?\.mode==='TEST'\?s\?\.status\?\.data\?\.tradingMode\?\.paper:null/,'TEST tiles = the paper account');
  assert.match(h,/Binance gerçek cüzdan:/);assert.match(h,/\.wc-lot\.new\{animation:wcIn/);assert.ok(!/padding:10px 12px;animation:wcIn/.test(h),'no replay on every redraw');
});

test('R2544.142 five lane switches on the card (5 dk scalp, 15 dk ana işlem, vur-kaç, İlk 3, ZİRVE-5) through the lanes route; LIVE ON needs a second press + LIVE',()=>{
  assert.match(h,/<div class="wc-lanes" id="wcLanes"[^>]*><\/div>\n\s*<div class="wc-sizes" id="wcSizes">/);
  for(const k of ['scalp5m','trade15m','burst','top3','zirve5'])assert.ok(h.includes(`{k:'${k}',name:`),k);
  const i=h.indexOf('async function wcLane(k){'),j=h.indexOf('async function wcClose(b){');assert.ok(i>0&&j>i);const f=h.slice(i,j);
  assert.match(f,/wcPost\('\/api\/control\/lanes',body\)/);assert.match(f,/if\(on&&WC\.live\)\{if\(!secondPress\(id,/);assert.match(f,/body\.confirm='LIVE'/);
  assert.match(h,/if\(on&&!nOn\)\{body\.normal=true;for\(const x of WC_LANES\)if\(x\.sub&&x\.k!==k\)body\[x\.k\]=false;\}/,'only the chosen sub-lane runs');
  assert.match(h,/if\(!on&&!WC_LANES\.some\(x=>x\.sub&&x\.k!==k&&st\[x\.k\]\)\)body\.normal=false;/,'the last sub-lane off turns the normal system off');
  assert.match(h,/try\{renderWcLanes\(s\);\}catch/);assert.match(h,/kuralın \(en çok 20x\) üstünde/);
});
