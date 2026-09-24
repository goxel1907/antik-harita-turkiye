'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const {BinanceLiveTransport}=require('../binance-live-transport');
const {createKnowledgeResearch}=require('../knowledge-research');

function reply(body,status=200){
  return {ok:status>=200&&status<300,status,async text(){return JSON.stringify(body);}};
}

test('R2535 reducePositionMarket can only reduce the matching open side and verifies full close',async()=>{
  let riskReads=0;
  let orderBody='';
  const fetchImpl=async(url,opt={})=>{
    const u=new URL(url);
    if(u.pathname==='/fapi/v1/time')return reply({serverTime:Date.now()});
    if(u.pathname==='/fapi/v1/positionSide/dual')return reply({dualSidePosition:false});
    if(u.pathname==='/fapi/v3/positionRisk'){
      riskReads++;
      return reply([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:riskReads===1?'10':'0',entryPrice:'1',markPrice:'1'}]);
    }
    if(u.pathname==='/fapi/v1/exchangeInfo')return reply({symbols:[{
      symbol:'ABCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',
      filters:[{filterType:'MARKET_LOT_SIZE',minQty:'1',maxQty:'100000',stepSize:'1'}]
    }]});
    if(u.pathname==='/fapi/v1/order'&&opt.method==='POST'){
      orderBody=String(opt.body||'');
      return reply({orderId:123,status:'FILLED',executedQty:'10'});
    }
    throw new Error('UNEXPECTED '+u.pathname);
  };
  const transport=new BinanceLiveTransport({registry:{consume(){return {ok:false};}},fetchImpl});
  const out=await transport.reducePositionMarket({
    symbol:'ABCUSDT',side:'LONG',fraction:1,
    credentials:{apiKey:'abcdefgh',apiSecret:'abcdefgh'}
  });
  assert.equal(out.ok,true,JSON.stringify(out));
  assert.equal(out.orderPlaced,true);
  assert.equal(out.execution,'JEV_EXIT_NOW_REDUCE_ONLY_MARKET');
  assert.equal(out.fullyClosed,true);
  assert.match(orderBody,/side=SELL/);
  assert.match(orderBody,/reduceOnly=true/);
  assert.match(orderBody,/quantity=10/);
});

test('R2535 free research uses 9Router + OpenRouter, fetched sources, then JEV verification before persistence',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r2535-knowledge-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source='https://www.cmegroup.com/education/courses/technical-analysis/chart-patterns.html';
  let routerCalls=0,openRouterCalls=0,jevCalls=0;
  const channel=(which)=>async({prompt})=>{
    if(which==='router')routerCalls++;else openRouterCalls++;
    const grounded=String(prompt).includes('VERIFIED_SOURCE_EXCERPTS');
    return {
      ok:true,model:which==='router'?'9router/free-test':'openrouter/free-test',
      text:JSON.stringify(grounded
        ? {summary:'Symmetrical triangle is a contraction formation; direction needs breakout evidence.',keyPoints:['Contraction','Breakout confirmation matters'],sourceUrls:[]}
        : {summary:'Candidate research',keyPoints:['Research it'],sourceUrls:[source]})
    };
  };
  const kr=createKnowledgeResearch({
    root,
    routerResearch:channel('router'),
    openRouterResearch:channel('openrouter'),
    jevReview:async payload=>{jevCalls++;assert.ok(payload.sources.length>=1);return {ok:true,verdict:'ACCEPT_REFERENCE'};},
    fetchImpl:async()=>({ok:true,async text(){return '<html>futures trading market technical analysis symmetrical triangle pattern price breakout support resistance</html>';}})
  });
  const out=await kr.research({topic:'SYMMETRICAL_TRIANGLE',family:'PATTERN'});
  assert.equal(out.ok,true,JSON.stringify(out));
  assert.equal(out.entry.status,'VERIFIED_REFERENCE');
  assert.ok(routerCalls>=2);
  assert.ok(openRouterCalls>=2);
  assert.equal(jevCalls,1);
  assert.equal(kr.reference().some(x=>x.topic==='SYMMETRICAL_TRIANGLE'),true);
});

test('R2535 controller binds BrainHub-owned JEV EXIT/PARTIAL without requiring Leader AUTO to stay enabled',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(src,/bindingActions:\['EXIT_NOW','PARTIAL_TAKE_PROFIT'\]/);
  assert.match(src,/bindingReduceAction=.*\['EXIT_NOW','PARTIAL_TAKE_PROFIT'\]/);
  assert.match(src,/reducePositionMarket/);
  assert.equal(src.includes("execution:'JEV_EXIT_WAIT_AUTO_ENABLE'"),false);
  assert.match(src,/POSITION_NOT_BRAINHUB_OWNED/);
  assert.match(src,/LIVE_DISARMED_DURING_POSITION_REVIEW/);
});

test('R2535 sovereign pipeline always performs cheap knowledge-gap detection before PASS-2',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(src,/knowledge-gap detection runs for every sovereign decision/);
  assert.match(src,/if\(typeof knowledgeResearch==='function'\)/);
  assert.match(src,/requestedByJev:pass1\.knowledgeResearchRequested===true/);
});
