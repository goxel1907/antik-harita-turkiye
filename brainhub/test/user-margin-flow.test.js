'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const S=require('../user-sizing'),T=require('../top3-hunter'),Z=require('../zirve5'),{writeTradingMode}=require('../binance-live-transport');
function setup(mode='LIVE'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-margin-flow-'));fs.mkdirSync(path.join(root,'config'));
 const put=(n,x)=>fs.writeFileSync(path.join(root,'config',n),JSON.stringify(x));
 put('live-policy.json',{armMinutes:1440,expectedLeverage:10,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}});
 put('leader-auto.json',{enabled:false,marginQuote:40,leverage:10,maxOpenPositions:2,allowLong:true,allowShort:true,burstMarginQuote:50,burstMaxLeverage:10});
 put('top3-hunter.json',{enabled:false,marginQuote:30,leverage:10});
 put('zirve5.json',{enabled:false,marginQuote:40,leverage:10});
 writeTradingMode(root,{mode,changedAt:'2026-11-15T10:00:00.000Z',testAutoRun:false});
 let fetches=0,learning=0;const events=[];
 const make=()=>require('../live-controller').createLiveController({root,clock:()=>Date.UTC(2026,10,15,17),store:{journal:(k,s,p)=>events.push({k,p}),recordLearning:()=>learning++},
 scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:{apiKey:'fake-only',apiSecret:'fake-only'},fetchImpl:async()=>{fetches++;throw Error('NO_NETWORK');},
 paperAutoTick:false,defaultTradingMode:mode,market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
 return {root,c:make(),make,events,stats:()=>({fetches,learning})};
}
for(const mode of ['TEST','LIVE'])for(const lane of S.LANES)for(const margin of [15,20,100,1000])
 test(mode+' '+lane+' accepts '+margin+' at zero balance and survives controller restart',()=>{
 const f=setup(mode),before=f.c.userSizingStatus(),state=f.c.status(),q=f.c.configureUserSizing({lane,marginQuote:margin,expectedRevision:before[lane].revision,source:'APK'});
 a.equal(q.ok,true,JSON.stringify(q));a.equal(q.marginQuote,margin);
 const next=f.make(),after=next.userSizingStatus();a.equal(after[lane].marginQuote,margin);a.equal(after[lane].leverage,before[lane].leverage);
 for(const l of S.LANES.filter(l=>l!==lane))a.equal(after[l].marginQuote,before[l].marginQuote,l);
 a.equal(next.status().tradingMode.mode,state.tradingMode.mode);a.equal(next.status().armed,state.armed);
 a.deepEqual(f.stats(),{fetches:0,learning:0});a.equal(f.events.filter(x=>x.k==='USER_SIZING_ACCEPTED').at(-1).p.marginQuote,margin);
 if(lane==='top3')a.equal(T.readTop3Config(f.root).marginQuote,margin);
 if(lane==='zirve5')a.equal(Z.readConfig(f.root).marginQuote,margin);
 if(lane==='normal')a.equal(next.leaderAutoStatus().marginQuote,margin);
 if(lane==='burst')a.equal(next.leaderAutoStatus().burstMarginQuote,margin);
});
test('KEŞİF retains its old effective amount when the İlk3 user preference changes',()=>{
 const f=setup(),old=f.c.userSizingStatus();a.equal(old.kesif.marginQuote,30);
 a.equal(f.c.configureUserSizing({lane:'top3',marginQuote:1000,expectedRevision:old.top3.revision,source:'OFFICE'}).ok,true);
 a.equal(f.c.userSizingStatus().kesif.marginQuote,30);a.equal(f.c.userSizingStatus().top3.marginQuote,1000);
});
test('stale APK and Office dialogs are rejected after a newer save in either direction',()=>{
 const f=setup(),old=f.c.userSizingStatus().top3;
 const first=f.c.configureUserSizing({lane:'top3',marginQuote:40,expectedRevision:old.revision,source:'OFFICE'});a.equal(first.ok,true);
 const stale=f.c.configureUserSizing({lane:'top3',marginQuote:15,expectedRevision:old.revision,source:'APK'});
 a.equal(stale.ok,false);a.equal(stale.current.marginQuote,40);a.equal(f.c.userSizingStatus().top3.marginQuote,40);
});
test('insufficient balance produces calculated reserve requirements without changing requested collateral',()=>{
 const f=setup(),old=f.c.userSizingStatus().top3;
 f.c.configureUserSizing({lane:'top3',marginQuote:1000,expectedRevision:old.revision,source:'OFFICE'});
 for(const available of [0,15,999,1000]){
 const q=S.balanceRequirement(1000,available);a.equal(q.ok,false);a.equal(q.requestedMarginQuote,1000);
 a.equal(q.requiredAvailable,1000/0.95);a.equal(q.availableBalance,available);
 }a.equal(S.balanceRequirement(1000,1100).ok,true);a.equal(f.c.userSizingStatus().top3.marginQuote,1000);
});
test('Office filter preserves lane, exact value and revision and cannot smuggle mode switches',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../office-dashboard/office-server.js'),'utf8');
 const i=s.indexOf('const CONTROL_BODY ='),e=s.indexOf('\n};',i)+3,ctx={};vm.createContext(ctx);
 vm.runInContext(s.slice(i,e)+';this.body=CONTROL_BODY;',ctx);
 const q=ctx.body['/api/control/sizing']({lane:'top3',marginQuote:1000,expectedRevision:'draft',enabled:true,confirm:'LIVE',source:'FORGED'});
 a.equal(q.marginQuote,1000);a.equal(q.lane,'top3');a.equal(q.source,'OFFICE');a.equal(q.expectedRevision,'draft');
 a.equal('enabled' in q,false);a.equal('confirm' in q,false);
});
test('real API handler serializes accepted preferences through the controller without an account call',async()=>{
 const f=setup(),s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const i=s.indexOf("    if(req.method==='POST'&&u.pathname==='/live/sizing')"),e=s.indexOf("    if(req.method==='POST'&&u.pathname==='/live/top3')",i);
 const body={lane:'top3',marginQuote:40,expectedRevision:f.c.userSizingStatus().top3.revision,source:'APK'};
 let response;const ctx={req:{method:'POST'},u:{pathname:'/live/sizing'},res:{},live:f.c,JSON,readBody:async()=>JSON.stringify(body),send:(res,status,data)=>response={status,data}};
 vm.createContext(ctx);await vm.runInContext('(async()=>{'+s.slice(i,e)+'})()',ctx);
 a.equal(response.status,200);a.equal(JSON.parse(JSON.stringify(response.data)).marginQuote,40);
 a.equal(f.c.userSizingStatus().top3.marginQuote,40);a.equal(f.stats().fetches,0);
});
