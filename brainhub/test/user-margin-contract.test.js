'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../user-sizing');
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'jev-user-margin-'));
const base={marginQuote:30,leverage:10};
const put=(r,l,m,rev,extra={})=>S.writeSizing(r,{lane:l,marginQuote:m,expectedRevision:rev,source:'OFFICE',...extra},base);
for(const m of [0.1,15,20,40,100,1000])test('positive collateral '+m+' persists exactly without any account',()=>{
 const r=root(),v=S.readSizing(r,'top3',base); const q=put(r,'top3',m,v.revision);
 a.equal(q.ok,true);a.equal(q.marginQuote,m);a.equal(S.readSizing(r,'top3',base).marginQuote,m);a.equal(q.leverage,10);
});
test('a new process/restart reads the accepted preference',()=>{
 const r=root(),q=put(r,'top3',100,S.readSizing(r,'top3',base).revision);
 delete require.cache[require.resolve('../user-sizing')];
 a.deepEqual(require('../user-sizing').readSizing(r,'top3',base),S.readSizing(r,'top3',base));a.equal(q.ok,true);
});
test('old phone cannot overwrite a newer Office save, nor the reverse',()=>{
 const r=root(),old=S.readSizing(r,'top3',base),p=put(r,'top3',40,old.revision);
 a.equal(p.ok,true); const stale=put(r,'top3',15,old.revision,{source:'APK'});
 a.equal(stale.ok,false);a.deepEqual(stale.reasons,['SIZING_CONFLICT']);a.equal(stale.current.marginQuote,40);
 const fresh=put(r,'top3',20,p.revision,{source:'APK'});a.equal(fresh.ok,true);
 a.equal(put(r,'top3',100,p.revision).ok,false);a.equal(S.readSizing(r,'top3',base).marginQuote,20);
});
test('ABA values still invalidate old dialogs',()=>{
 const r=root(),old=S.readSizing(r,'top3',base),v=put(r,'top3',40,old.revision),back=put(r,'top3',30,v.revision);
 a.notEqual(back.revision,old.revision);a.equal(put(r,'top3',100,old.revision).ok,false);
});
test('all five lanes are independent',()=>{
 const r=root(),lanes=['normal','burst','top3','zirve5','kesif'];
 lanes.forEach((l,i)=>a.equal(put(r,l,[15,20,40,100,1000][i],S.readSizing(r,l,base).revision).ok,true));
 a.deepEqual(lanes.map(l=>S.readSizing(r,l,base).marginQuote),[15,20,40,100,1000]);
});
test('legacy unversioned or periodic messages cannot write sizing',()=>{
 const r=root();a.equal(put(r,'top3',40,undefined).ok,false);
 a.equal(put(r,'top3',40,S.readSizing(r,'top3',base).revision,{source:undefined}).ok,false);
 a.equal(S.readSizing(r,'top3',base).marginQuote,30);
});
for(const m of [0,-1,NaN,Infinity,null,'',true])test('reject invalid margin '+String(m)+' without changing stored choice',()=>{
 const r=root();a.equal(put(r,'top3',m,S.readSizing(r,'top3',base).revision).ok,false);
 a.equal(S.readSizing(r,'top3',base).marginQuote,30);
});
test('setting a margin never changes collateral into leveraged notional',()=>{
 const r=root(),q=put(r,'top3',100,S.readSizing(r,'top3',base).revision);
 a.equal(q.marginQuote,100);a.equal(q.leverage,10);a.equal(q.marginQuote*q.leverage,1000);
});
test('corrupt canonical preference fails closed instead of falling back silently',()=>{
 const r=root();fs.mkdirSync(path.join(r,'config'));fs.writeFileSync(path.join(r,'config','user-sizing.json'),'{broken');
 a.throws(()=>S.readSizing(r,'top3',base),/SIZING_STORE_UNREADABLE/);
});

test('changing only normal collateral preserves an existing valid leverage preference',()=>{
 const r=root(),fallback={marginQuote:30,leverage:50},old=S.readSizing(r,'normal',fallback);
 const q=S.writeSizing(r,{lane:'normal',marginQuote:1000,expectedRevision:old.revision,source:'APK'},fallback);
 a.equal(q.ok,true);a.equal(q.leverage,50);a.equal(q.marginQuote,1000);
});
