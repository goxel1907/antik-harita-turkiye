'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),S=require('../user-sizing');
const src=fs.readFileSync(path.join(__dirname,'../live-controller.js'),'utf8');
const extract=name=>{const i=src.indexOf('  '+name),e=src.indexOf('\n  }',i)+4;return src.slice(i,e)};
test('normal entry refuses stale or non-dynamic amounts when a canonical preference exists',()=>{
 const ctx={userSizingStatus:()=>({normal:{marginQuote:15,revision:'2-current'}})};vm.createContext(ctx);
 vm.runInContext(extract('function normalSizingGuard(')+';this.guard=normalSizingGuard;',ctx);
 for(const settings of [{dynamic:true,marginQuote:1000},{dynamic:false,marginQuote:null}])a.equal(ctx.guard(settings).ok,false);
 a.equal(ctx.guard({dynamic:true,marginQuote:15}).ok,true);
 a.equal(ctx.guard({dynamic:true,marginQuote:15},'1-old').ok,false);
});
test('first preference saved during a legacy entry invalidates the old revision',()=>{
 let revision='0-old';const ctx={userSizingStatus:()=>({normal:{marginQuote:15,revision}})};vm.createContext(ctx);
 vm.runInContext(extract('function normalSizingGuard(')+extract('function sizingUnchanged(')+';this.guard=normalSizingGuard;this.same=sizingUnchanged;',ctx);
 const captured=ctx.guard({dynamic:true,marginQuote:1000});a.equal(captured.ok,true);
 revision='1-current';a.equal(ctx.same('normal',captured.revision).ok,false);
});
for(const margin of [15,20,100,1000,15.123456789])test('actual burst preparation preserves own collateral '+margin+' and existing leverage',async()=>{
 const ctx={root:'isolated-test-only',userSizingStatus:()=>({burst:{revision:'2-current'}}),currentCredentials:()=>({}),credentialsReady:()=>true,readPolicy:()=>({ok:true}),
 readLeaderAutoConfig:()=>({ok:true,config:{marginQuote:1000,burstMarginQuote:margin,burstMaxLeverage:10}}),testTopUp:async()=>{},
 accountSummary:async()=>({ok:true,availableBalance:10000}),finite:n=>Number.isFinite(Number(n))?Number(n):null,userSizing:S,
 transport:{_fetchJson:async()=>[{symbol:'FAKEUSDT',brackets:[{notionalFloor:0,notionalCap:1e9,initialLeverage:20}]}]},BURST_LEVERAGE_CEILING:25,Math,Number};
 vm.createContext(ctx);vm.runInContext(extract('async function burstLeverageAndSizing(')+';this.prepare=burstLeverageAndSizing;',ctx);
 const q=await ctx.prepare('FAKEUSDT','LONG',null,10,2,true,null);
 a.equal(q.ok,true);a.equal(q.marginQuote,margin);a.equal(q.leverage,10);a.equal(q.sizingRevision,'2-current');
});
