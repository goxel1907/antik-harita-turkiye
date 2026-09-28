'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8');
const source=html.slice(html.indexOf('function renderOffice('),html.indexOf('\nfunction renderCpuPolicy('));
test('Office renders idle, approved, intent and safety stages without obsolete variables',()=>{
 for(const armed of [false,true])for(const health of [{},{qualified:1},{qualified:1,intentBuilt:1},{qualified:1,intentBuilt:1,safetyReady:1}]){
  const walkers={};
  const context={ROUTES:[['brain','jev',1],['jev','risk',1],['risk','exec',1],['exec','positions',1]],STATUS_TR:{},$:()=>({textContent:''}),trUi:x=>x,shortSym:x=>x||'',setDesk(){},setEdge(){},setGate(){},setBubble(){},setWalker:(id,on)=>{walkers[id]=on;}};
  vm.createContext(context);vm.runInContext(source,context);
  assert.doesNotThrow(()=>context.renderOffice({status:{data:{armed,leaderAuto:{health}}}},{phase:'IDLE'}));
  assert.equal(walkers['wt-risk-exec'],!health.intentBuilt&&!!health.qualified);
  assert.equal(walkers['wt-exec-positions'],!!health.safetyReady||(!armed&&!!health.qualified));
 }
});
