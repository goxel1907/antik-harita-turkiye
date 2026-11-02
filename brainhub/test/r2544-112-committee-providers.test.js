'use strict';
// R2544.112 (kullanıcı 02.11: "Kiro'nun aylık limiti çok çabuk doluyor, çıkaralım; kotası dolmayanları ekle, router ayarlarımız boşa gitmesin")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const MC=require('../model-committee');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const CAND=JSON.parse(sv.match(/const ROUTER_CANDIDATES=(\[[\s\S]*?\]);/)[1].replace(/'/g,'"'));
test('R2544.112 Kiro ve Gemini CLI kurulda yer tutmaz (JEV ayarına dokunulmaz)',()=>{
  assert.ok(sv.includes(String.raw`const COMMITTEE_DROP=/^ROUTER:(kr|gc)\//;`));
  assert.ok(sv.includes('const fixed=traderRouterMembers().filter(m=>!COMMITTEE_DROP.test(m.id))'));
  assert.ok(!CAND.some(m=>/^(kr|gc)\//.test(m)));
  const out=MC.pickRouterExtras(['kr/claude-sonnet-4.5','gc/gemini-2.5-pro','gemini/gemini-3.6-flash'],{strong:/./,candidates:CAND});
  assert.ok(!out.some(m=>/^(kr|gc)\//.test(m)));
});
test('R2544.112 Gemini her model ayrı günlük kota: 5 koltuğa kadar; GitHub Models ve Cloudflare bağlanınca aday',()=>{
  assert.equal(MC.PROVIDER_CAP.gemini,8); // R2544.115 every Gemini image model
  const out=MC.pickRouterExtras([],{strong:/./,perProvider:3,max:28,candidates:CAND}); // R2544.115: all 7 Gemini candidates, NVIDIA up to 4
  assert.equal(out.filter(m=>m.startsWith('gemini/')).length,7);
  assert.equal(out.filter(m=>m.startsWith('nvidia/')).length,4,'NVIDIA 4 (R2544.115)');assert.equal(out.filter(m=>m.startsWith('github/')).length,2,'GitHub = Copilot plan: 2');
  assert.ok(CAND.includes('github/claude-sonnet-4.6')&&CAND.includes('cloudflare-ai/deepseek-v4.1-flash-1017'));
  assert.ok(out.length<=28);
});
