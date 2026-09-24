'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CURATED_OPEN_SOURCE_REPOS,allowedUrl,createKnowledgeResearch}=require('../knowledge-research');

function root(t){
  const r=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r2536-research-'));
  t.after(()=>fs.rmSync(r,{recursive:true,force:true}));
  return r;
}

test('R2536 curated GitHub allowlist accepts only registered repos and exposes license metadata',()=>{
  assert.ok(CURATED_OPEN_SOURCE_REPOS.length>=8);
  assert.equal(allowedUrl('https://github.com/ccxt/ccxt/blob/master/README.md')!==null,true);
  assert.equal(allowedUrl('https://raw.githubusercontent.com/hummingbot/hummingbot/master/README.md')!==null,true);
  assert.equal(allowedUrl('https://github.com/unknown-owner/unknown-repo/blob/main/README.md'),null);
  assert.ok(CURATED_OPEN_SOURCE_REPOS.every(x=>x.repo&&x.url&&x.license&&Array.isArray(x.roles)));
});

test('R2536 retries transient free-model failure then persists only fetched + JEV-approved research',async t=>{
  const r=root(t);
  const source='https://github.com/ccxt/ccxt/blob/master/README.md';
  let routerCalls=0,openCalls=0,jevCalls=0;
  const router=async({prompt})=>{
    routerCalls++;
    if(routerCalls===1)return {ok:false,reason:'RESEARCH_CHANNEL_FAILED',detail:'HTTP 429 rate limit',model:'9router/free'};
    const grounded=String(prompt).includes('VERIFIED_SOURCE_EXCERPTS');
    return {ok:true,model:'9router/free-ok',text:JSON.stringify(grounded
      ? {summary:'CCXT provides exchange API abstractions for trading software.',keyPoints:['Exchange API abstraction'],sourceUrls:[]}
      : {summary:'candidate',keyPoints:['verify'],sourceUrls:[source]})};
  };
  const openrouter=async({prompt})=>{
    openCalls++;
    const grounded=String(prompt).includes('VERIFIED_SOURCE_EXCERPTS');
    return {ok:true,model:'openrouter/free-ok',text:JSON.stringify(grounded
      ? {summary:'CCXT documents market and order API abstractions.',keyPoints:['Orders and market data'],sourceUrls:[]}
      : {summary:'candidate',keyPoints:['verify'],sourceUrls:[source]})};
  };
  const desk=createKnowledgeResearch({
    root:r,routerResearch:router,openRouterResearch:openrouter,
    retryDelaysMs:[0,0,0],sleepImpl:async()=>{},
    fetchImpl:async url=>({ok:String(url)===source,status:200,async text(){return '<html>CCXT cryptocurrency exchange trading market data order API futures risk</html>';}}),
    jevReview:async payload=>{jevCalls++;assert.equal(payload.sources.length,1);return {ok:true,verdict:'ACCEPT_REFERENCE'};}
  });
  const out=await desk.research({topic:'EXCHANGE API',family:'EXECUTION'});
  assert.equal(out.ok,true,JSON.stringify(out));
  assert.ok(routerCalls>=3); // one transient + discovery success + grounded success
  assert.ok(openCalls>=2);
  assert.equal(jevCalls,1);
  const st=desk.status();
  assert.equal(st.verifiedCount,1);
  assert.ok(st.openSourceRepoCount>=8);
  assert.ok(st.retryPolicy.channelAttempts>=2);
});

test('R2536 never persists an unregistered GitHub source even when free models suggest it',async t=>{
  const r=root(t);
  const bad='https://github.com/someone/random-trading-repo/blob/main/README.md';
  const worker=async()=>({ok:true,model:'free',text:JSON.stringify({summary:'claim',keyPoints:['claim'],sourceUrls:[bad]})});
  const desk=createKnowledgeResearch({
    root:r,routerResearch:worker,openRouterResearch:worker,retryDelaysMs:[0],sleepImpl:async()=>{},
    fetchImpl:async()=>({ok:true,status:200,async text(){return 'trading market indicator risk';}}),
    jevReview:async()=>({ok:true,verdict:'ACCEPT_REFERENCE'})
  });
  const out=await desk.research({topic:'RANDOM_INDICATOR',family:'INDICATOR'});
  assert.equal(out.ok,false);
  assert.equal(out.reason,'NO_VERIFIED_SOURCE_FETCHED');
  assert.equal(desk.reference().length,0);
});
