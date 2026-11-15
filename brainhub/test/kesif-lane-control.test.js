'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const old=path.join(__dirname,'r2544-57-lanes.test.js'),src=fs.readFileSync(old,'utf8'),box={require:createRequire(old),module:{exports:{}},__dirname};
vm.runInNewContext(src.slice(0,src.indexOf("\ntest("))+';module.exports=fixture;',box);
const fixture=box.module.exports;
const read=(r,n)=>JSON.parse(fs.readFileSync(path.join(r,'config',n),'utf8'));
test('KESIF-SOZ is an explicit lane in PC status and compact APK truth',()=>{
 const f=fixture({top3:{enabled:false},zirve5:{enabled:false}});
 const before=fs.existsSync(path.join(f.root,'config/kesif-soz.json'));
 const st=f.controller.laneStatus();a.equal(st.kesif.selected,true);a.equal(st.kesif.name,'KEŞİF-SÖZ');a.equal(st.kesif.active,false);
 a.equal(fs.existsSync(path.join(f.root,'config/kesif-soz.json')),before,'status read must not enable/persist a choice');
 const mobile=require('../mobile-status').mobileStatus({tradingMode:{run:{lanes:st}},kesif:f.controller.kesifStatus()});
 a.equal(mobile.tradingMode.run.lanes.kesif.selected,mobile.kesif.soz.e);
});
test('turning real entries off persists only soz.enabled and keeps independent margin, shadow learning and lots',()=>{
 const f=fixture({lanes:{normal:false},top3:{enabled:true},zirve5:{enabled:true}});
 fs.mkdirSync(path.join(f.root,'data'),{recursive:true});
 const learning=path.join(f.root,'data/kesif-state.json');fs.writeFileSync(learning,JSON.stringify({settings:{enabled:true},closed:[],open:[],matrix:{proof:'KEEP'},brainCheck:[{p:0.6}]}));
 fs.writeFileSync(path.join(f.root,'config/kesif-soz.json'),JSON.stringify({enabled:true,goxelExit:true,custom:'KEEP'}));
 fs.writeFileSync(path.join(f.root,'config/user-sizing.json'),JSON.stringify({version:1,lanes:{kesif:{marginQuote:1000,leverage:10,seq:4}}}));
 const before=fs.readFileSync(learning,'utf8'),sizing=fs.readFileSync(path.join(f.root,'config/user-sizing.json'),'utf8'),t=read(f.root,'top3-hunter.json'),z=read(f.root,'zirve5.json');
 f.controller._testTop3State().active.keep={id:'KEEP',symbol:'FAKEUSDT',lane:'KESIF'};
 const out=f.controller.selectLanes({kesif:false,source:'APK'});
 a.equal(out.ok,true);a.equal(out.lanes.kesif.selected,false);a.equal(out.lanes.kesif.gate,'KESIF_SOZ_DISABLED');
 a.deepEqual(read(f.root,'kesif-soz.json'),{enabled:false,goxelExit:true,custom:'KEEP'});
 a.equal(fs.readFileSync(learning,'utf8'),before);a.equal(fs.readFileSync(path.join(f.root,'config/user-sizing.json'),'utf8'),sizing);
 a.deepEqual(read(f.root,'top3-hunter.json'),t);a.deepEqual(read(f.root,'zirve5.json'),z);
 a.ok(f.controller._testTop3State().active.keep);a.equal(f.state.calls.length,0);
});
test('LIVE enabling requires explicit confirmation; OFF does not disarm or change other lanes',()=>{
 const f=fixture({mode:'LIVE',top3:{enabled:true},zirve5:{enabled:true}});
 a.equal(f.controller.selectLanes({kesif:true}).ok,false);
 const on=f.controller.selectLanes({kesif:true,confirm:'LIVE',source:'OFFICE'});a.equal(on.ok,true);
 const before=f.controller.status().armed,out=f.controller.selectLanes({kesif:false,source:'APK'});
 a.equal(out.ok,true);a.equal(f.controller.status().armed,before);a.equal(f.controller.laneStatus().top3.selected,true);
});
test('cannot report accepted OFF when persistent soz write failed',()=>{
 const f=fixture();fs.mkdirSync(path.join(f.root,'config/kesif-soz.json'));
 const out=f.controller.selectLanes({kesif:false});a.equal(out.ok,false);a.deepEqual(Array.from(out.reasons),['KESIF_SOZ_WRITE_FAILED']);
});
test('Office relay permits only the kesif lane flag and not a shadow/size side effect',()=>{
 const {CONTROL_BODY}=require('../office-dashboard/office-server');
 const out=CONTROL_BODY['/api/control/lanes']({kesif:false,enabled:false,soz:{goxelExit:false},marginQuote:15,providers:'WIDE'});
 a.deepEqual(out,{source:'OFFICE',kesif:false});
});
test('Office top lane list includes kesif without changing Normal/OTO',()=>{
 const h=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8');
 const declaration=h.match(/const WC_LANES=\[[\s\S]*?\];/)[0],start=h.indexOf('function wcLaneState('),end=h.indexOf('function renderWcLanes(',start);
 const ctx={};vm.runInNewContext(declaration+'\n'+h.slice(start,end)+';this.body=wcLaneBody;this.state=wcLaneState;',ctx);
 const ln={normal:{selected:false,sub:{}},top3:{selected:true},zirve5:{selected:true},kesif:{selected:false}};
 a.equal(ctx.state(ln).kesif,false);a.deepEqual(JSON.parse(JSON.stringify(ctx.body(ln,'kesif').body)),{kesif:true});
});
test('disabling real entries does not disable the independent Goxel open-lot management loop',async()=>{
 const s=fs.readFileSync(path.join(__dirname,'../live-controller.js'),'utf8'),i=s.indexOf('  async function goxelLiveTick('),e=s.indexOf('\n  // R2544.158',i);
 let managed=0;
 const ctx={gxLiveBusy:false,clock:()=>1000000,kesifInit:()=>({}),readSozConfig:()=>({enabled:false,goxelExit:true}),sozWired:()=>true,top3State:{active:{p:{lane:'KESIF'}}},finite:x=>Number.isFinite(x)?x:null,goxelLive:async()=>{managed++;return true;},saveKesif:()=>{}};
 vm.runInNewContext(s.slice(i,e)+';this.tick=goxelLiveTick;',ctx);await ctx.tick();a.equal(managed,1);
});

test('kesif OFF between rate permit and dispatch prevents a new entry without touching other lanes',async()=>{
 const {BinanceLiveTransport}=require('../binance-live-transport'),rate=require('../binance-rate-limit'),s=fs.readFileSync(path.join(__dirname,'../live-controller.js'),'utf8');
 const i=s.indexOf('  function top3EntryDispatchGuard(');a.ok(i>=0);const e=s.indexOf('\n  }',i)+4;
 let on=true;const ctx={sizingUnchanged:()=>({ok:true}),readSozConfig:()=>({enabled:on}),sozGate:c=>({ok:c.enabled})};
 vm.runInNewContext(s.slice(i,e)+';this.guard=top3EntryDispatchGuard;',ctx);
 const original=rate.acquire;let release,entered,fetches=0;const wait=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
 rate.acquire=async()=>{entered();await wait;return {release(){}}};
 const tr=new BinanceLiveTransport({registry:{consume(){}},fetchImpl:async()=>{fetches++;throw Error('NO_REAL_ORDER');}});
 try{const pending=tr._fetchJsonReal('POST','/fapi/v1/order',{validateSizing:()=>ctx.guard({soz:{}},'kesif','r')});await seen;on=false;release();
  await a.rejects(pending,e=>e.message==='KESIF_ENTRY_PERMISSION_REVOKED'&&e.requestSent===false);a.equal(fetches,0);
  a.equal(ctx.guard({},'top3','r').ok,true);
 }finally{rate.acquire=original;release();}
});
