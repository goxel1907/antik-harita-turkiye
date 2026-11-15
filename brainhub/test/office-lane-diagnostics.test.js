'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {derive}=require('../office-dashboard/office-server');
function snap(normal){return {status:{ok:true,data:{armed:true,featureVersion:'9.5.114-CLAUDE',jevSovereign:{enabled:true},tradingMode:{run:{lanes:{normal:{selected:normal,active:normal},top3:{selected:true,active:true},zirve5:{selected:false,active:false},kesif:{selected:true,active:true}}}},leaderAuto:{enabled:normal,health:{deepAnalyses:12,sovereignPass1Calls:0,qualified:3,intentBuilt:0}}}},health:{data:{}},positions:{data:{open:[]}},kesif:{soz:{enabled:true}}};}
test('Normal and OTO off are intentional inactivity, not a JEV choke for other lanes',()=>{
 const d=derive(snap(false));a.equal(d.normalEntryActive,false);
 a.equal(d.blockers.some(x=>['JEV_PASS1_MISSING','JEV_FINAL_MISSING','NO_INTENT'].includes(x.code)),false);
 a.equal(d.blockers.find(x=>x.code==='AUTO_DISABLED').level,'info');
 a.equal(d.entryLanes.top3.active,true);a.equal(d.entryLanes.kesif.active,true);a.equal(d.entryLanes.zirve5.active,false);
});
test('active Normal with missing JEV calls remains a real diagnostic',()=>{const d=derive(snap(true));a.equal(d.normalEntryActive,true);a.ok(d.blockers.some(x=>x.code==='JEV_PASS1_MISSING'));});
test('recorded provider access failure remains visible even with Normal off and is labelled as last record',()=>{
 const s=snap(false);s.status.data.jev={provider:{lastError:{httpStatus:401,at:'2026-11-15T00:00:00Z',category:'AUTH'}}};
 const d=derive(s),b=d.blockers.find(x=>x.code==='JEV_PROVIDER_ACCESS');a.ok(b);a.match(b.title,/Son|son/);a.match(b.detail,/Normal.*kapalı/);
});
test('Office funnel does not paint a choke for disabled Normal but preserves the measured counters',()=>{
 const h=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8'),i=h.indexOf('function renderBlockers('),end=h.indexOf('\nfunction stageInfo(',i),els={blockers:{},pipe:{}};
 const box={$:id=>els[id.slice(1)],esc:x=>String(x)};vm.runInNewContext(h.slice(i,end)+';this.render=renderBlockers;',box);
 const s={derived:{normalEntryActive:false,blockers:[],funnel:[{label:'Radar',value:24},{label:'JEV',value:0}]}};
 box.render(s);a.doesNotMatch(els.pipe.innerHTML,/choke/);a.match(els.pipe.innerHTML,/Normal.*kapalı/);a.match(els.pipe.innerHTML,/24/);
 s.derived.normalEntryActive=true;box.render(s);a.match(els.pipe.innerHTML,/choke/);
});
