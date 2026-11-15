'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {BinanceLiveTransport}=require('../binance-live-transport'),rate=require('../binance-rate-limit');
for(const mode of ['changed','unreadable','asynchronous'])test('actual fetch dispatch refuses '+mode+' sizing after waiting for a rate permit',async()=>{
 const old=rate.acquire;let release,entered;const wait=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
 let current='old',fetches=0;
 rate.acquire=async()=>{entered();await wait;return {release(){}}};
 const transport=new BinanceLiveTransport({registry:{consume(){}},fetchImpl:async()=>{fetches++;return {ok:true,status:200,headers:{get(){return null}},text:async()=>'{}'}}});
 const check=()=>{if(mode==='unreadable')throw Error('broken preference');if(mode==='asynchronous')return Promise.resolve({ok:true});return {ok:current==='old'};};
 try{
 const pending=transport._fetchJsonReal('POST','/fapi/v1/order',{params:{symbol:'FAKEUSDT'},validateSizing:check});
 await seen;current='new';release();
 await a.rejects(pending,e=>e.message==='SIZING_CHANGED_DURING_PREPARATION'&&e.requestSent===false);
 a.equal(fetches,0,'no external fetch or simulated exchange order dispatched');
 }finally{rate.acquire=old;release();}
});
test('unchanged sizing reaches only the fake fetch and does not alter parameters',async()=>{
 const old=rate.acquire;rate.acquire=async()=>({release(){}});let calls=0,body;
 const tr=new BinanceLiveTransport({registry:{consume(){}},fetchImpl:async(u,o)=>{calls++;body=new URLSearchParams(o.body);return {ok:true,status:200,headers:{get(){return null}},text:async()=>'{"ok":true}'}}});
 try{const r=await tr._fetchJsonReal('POST','/fapi/v1/order',{params:{quantity:'15'},validateSizing:()=>({ok:true})});a.equal(r.ok,true);a.equal(calls,1);a.equal(body.get('quantity'),'15');}
 finally{rate.acquire=old;}
});
