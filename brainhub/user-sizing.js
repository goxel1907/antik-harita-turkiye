'use strict';
// User preferences are independent of account availability and entry permission.
// Only this versioned store accepts external sizing writes. It never places orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LANES=['normal','burst','top3','zirve5','kesif'];
const file=root=>path.join(String(root),'config','user-sizing.json');
function load(root){
 if(!fs.existsSync(file(root)))return {version:1,lanes:{}};
 try {const x=JSON.parse(fs.readFileSync(file(root),'utf8'));if(x.version!==1||!x.lanes||typeof x.lanes!=='object'||Array.isArray(x.lanes))throw Error();return x;}
 catch {throw Error('SIZING_STORE_UNREADABLE');}
}
function positive(x){return typeof x==='number'&&Number.isFinite(x)&&x>0;}
function view(store,lane,fallback){
 if(!LANES.includes(lane))throw Error('SIZING_LANE_INVALID');
 const saved=store.lanes[lane],x=saved||fallback||{};
 if(saved&&(!positive(x.marginQuote)||!Number.isSafeInteger(x.seq)||x.seq<1))throw Error('SIZING_STORE_UNREADABLE');
 const marginQuote=x.marginQuote??null,leverage=x.leverage??null,seq=saved?.seq||0;
 const hash=crypto.createHash('sha256').update(JSON.stringify([marginQuote,leverage])).digest('hex').slice(0,16);
 return {marginQuote,leverage,revision:seq+'-'+hash};
}
function readSizing(root,lane,fallback={}){return view(load(root),lane,fallback);}
function writeSizing(root,p={},fallback={},seed={}){
 if(!LANES.includes(p.lane))return {ok:false,reasons:['SIZING_LANE_INVALID']};
 let store,current;try{store=load(root);current=view(store,p.lane,fallback);}catch{return {ok:false,reasons:['SIZING_STORE_UNREADABLE']};}
 const reject=reason=>({ok:false,reasons:[reason],current,lane:p.lane});
 if(!['OFFICE','APK'].includes(p.source)||typeof p.expectedRevision!=='string')return reject('SIZING_REFRESH_REQUIRED');
 if(p.expectedRevision!==current.revision)return reject('SIZING_CONFLICT');
 if(!positive(p.marginQuote))return reject('SIZING_MARGIN_INVALID');
 const leverage=p.leverage===undefined?current.leverage:p.leverage;
 const maxLeverage=p.lane==='normal'?125:p.lane==='burst'?25:20;
 if(leverage!==null&&(!Number.isInteger(leverage)||leverage<1||leverage>maxLeverage))return reject('SIZING_LEVERAGE_INVALID');
 // Snapshot existing legacy lane preferences once before changing one lane.
 // In particular a legacy KEŞİF preference must not follow a later İlk3 save.
 for(const [lane,x] of Object.entries(seed))if(LANES.includes(lane)&&!store.lanes[lane]&&positive(x.marginQuote))
   store.lanes[lane]={marginQuote:x.marginQuote,leverage:x.leverage??null,seq:1,source:'LEGACY_SNAPSHOT'};
 const seq=(store.lanes[p.lane]?.seq||0)+1;
 store.lanes[p.lane]={marginQuote:p.marginQuote,leverage,seq,source:p.source,updatedAt:new Date().toISOString()};
 const tmp=file(root)+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
 try{fs.mkdirSync(path.dirname(tmp),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(store,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(tmp,file(root));}
 catch{return reject('SIZING_WRITE_FAILED');}
 return {ok:true,lane:p.lane,...view(store,p.lane,fallback)};
}
function balanceRequirement(marginQuote,availableBalance){
 const valid=positive(marginQuote),available=typeof availableBalance==='number'&&Number.isFinite(availableBalance)?availableBalance:null;
 const requiredAvailable=valid?marginQuote/0.95:null;
 return {ok:valid&&available!==null&&available>=requiredAvailable,requestedMarginQuote:marginQuote,availableBalance:available,requiredAvailable,
 reserveFraction:0.05,reason:!valid?'SIZING_MARGIN_REQUIRED':available===null?'ACCOUNT_UNAVAILABLE':available<requiredAvailable?'MARGIN_ABOVE_FREE_BALANCE':null};
}
module.exports={LANES,readSizing,writeSizing,balanceRequirement};
