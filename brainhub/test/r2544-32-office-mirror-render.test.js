'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8');
const source=html.slice(html.indexOf('function mirrorFmt('),html.indexOf('\nlet last=null;'));

for(const tf of ['5m','15m'])test(`R32 Office ${tf} renders actual mirror table including recorded trend trace`,async()=>{
 const nodes={};
 function node(id){
  if(!nodes[id]){
   const n={style:{},className:'',textContent:'',innerHTML:''};
   Object.defineProperty(n,'src',{set(){queueMicrotask(()=>n.onload());}});
   nodes[id]=n;
  }
  return nodes[id];
 }
 const evidence={available:true,events:[{type:'CLOSE_BREAK_FAILED',direction:'UP',level:12,barsAgo:1,stillInside:true}]};
 const trendLines={upSupport:{kind:'UP_SUPPORT',active:true,from:{price:10},to:{price:11},projected:{price:11.5}}};
 const overlay={rangeLow:10,rangeHigh:12,fib618:11,breakoutEvidence:evidence,trendLines};
 const packet={livePrice:11,coreFrames:{[tf]:{}},chartOverlayLevels:{[tf]:overlay}};
 const context={mirrorTf:tf,mirrorSeq:0,mirrorOpts:{htf:true,pos:true},Date,Promise,
  $:node,num:x=>x==null?null:Number(x),esc:x=>String(x),trUi:x=>x,
  syncMirrorSymbol:()=> 'TESTUSDT',mirrorQuery:x=>'?'+new URLSearchParams(x),renderPreEntryMicro(){},
  fetch:async()=>({ok:true,json:async()=>({ok:true,snapshotId:'test',packet,parity:{ok:true,compared:3},
   latestDecision:{ts:1,ageMs:1000,jevSeen:{livePrice:11,chartOverlayLevels:{[tf]:overlay}}}})})};
 vm.createContext(context);vm.runInContext(source,context);
 await context.renderMirror({});
 assert.match(node('#mirrorParity').textContent,/YAPISAL UYUM OK/);
 assert.match(node('#mirrorKv').innerHTML,/Sahte kırılım kanıtı/);
 assert.match(node('#mirrorKv').innerHTML,/Kapanış kırılımı geri alındı/);
 assert.match(node('#mirrorKv').innerHTML,/HL destek/);
 assert.match(node('#mirrorKv').innerHTML,new RegExp(`Kayıtlı ${tf}:`));
 assert.match(node('#mirrorKv').innerHTML,/Son JEV paketinin kırılım \/ trend izi/);
 assert.equal(node('#mirrorAnnotated').style.opacity,'1');
});
