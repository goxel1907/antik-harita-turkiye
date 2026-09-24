'use strict';

const fs=require('node:fs');
const path=require('node:path');

const ALLOWED_SOURCE_HOSTS=[
  'binance.com','www.binance.com',
  'cmegroup.com','www.cmegroup.com',
  'cftc.gov','www.cftc.gov',
  'tradingview.com','www.tradingview.com',
  'investopedia.com','www.investopedia.com'
];

// R2536: curated open-source engineering references. These are READ-ONLY references,
// never strategy authority and never executable/vendor code inside BrainHub.
// Licenses are recorded so no source is silently copied across incompatible terms.
const CURATED_OPEN_SOURCE_REPOS=[
  {repo:'ccxt/ccxt',url:'https://github.com/ccxt/ccxt',license:'MIT',roles:['EXECUTION','EXCHANGE','MARKET_DATA']},
  {repo:'hummingbot/hummingbot',url:'https://github.com/hummingbot/hummingbot',license:'Apache-2.0',roles:['MICROSTRUCTURE','ORDER_BOOK','EXECUTION']},
  {repo:'jesse-ai/jesse',url:'https://github.com/jesse-ai/jesse',license:'MIT',roles:['STRATEGY','RISK','BACKTEST']},
  {repo:'QuantConnect/Lean',url:'https://github.com/QuantConnect/Lean',license:'Apache-2.0',roles:['EXECUTION','PORTFOLIO','BACKTEST']},
  {repo:'TA-Lib/ta-lib-python',url:'https://github.com/TA-Lib/ta-lib-python',license:'BSD-2-Clause',roles:['INDICATOR','TECHNICAL_ANALYSIS']},
  {repo:'nautechsystems/nautilus_trader',url:'https://github.com/nautechsystems/nautilus_trader',license:'LGPL-3.0',roles:['EVENT_DRIVEN','EXECUTION','BACKTEST']},
  {repo:'freqtrade/freqtrade',url:'https://github.com/freqtrade/freqtrade',license:'GPL-3.0',roles:['CRYPTO_BOT','RISK','BACKTEST']},
  {repo:'mementum/backtrader',url:'https://github.com/mementum/backtrader',license:'GPL-3.0',roles:['BACKTEST','STRATEGY']},
  {repo:'pmorissette/bt',url:'https://github.com/pmorissette/bt',license:'MIT',roles:['BACKTEST','PORTFOLIO']},
  {repo:'ranaroussi/quantstats',url:'https://github.com/ranaroussi/quantstats',license:'Apache-2.0',roles:['PERFORMANCE','RISK_ANALYTICS']}
];

function clip(v,n=1200){return String(v??'').replace(/\s+/g,' ').trim().slice(0,n);}
function safeTopic(v){
  const s=String(v||'').replace(/[^A-Za-z0-9_./:+\- ]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
  return s.length>=2?s:null;
}
function readJson(file,fallback){
  try{const x=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));return x&&typeof x==='object'?x:fallback;}
  catch{return fallback;}
}
function writeJsonAtomic(file,obj){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(obj,null,2),'utf8');
  fs.renameSync(tmp,file);
}
function jsonFromText(text){
  const raw=String(text||'').trim();
  try{return JSON.parse(raw);}catch{}
  const m=raw.match(/\{[\s\S]*\}/);
  if(!m)return null;
  try{return JSON.parse(m[0]);}catch{return null;}
}
function curatedGithubUrl(u){
  const host=u.hostname.toLowerCase();
  const parts=u.pathname.split('/').filter(Boolean);
  if(host==='github.com'){
    if(parts.length<2)return false;
    const key=(parts[0]+'/'+parts[1]).toLowerCase();
    return CURATED_OPEN_SOURCE_REPOS.some(x=>x.repo.toLowerCase()===key);
  }
  if(host==='raw.githubusercontent.com'){
    if(parts.length<3)return false;
    const key=(parts[0]+'/'+parts[1]).toLowerCase();
    return CURATED_OPEN_SOURCE_REPOS.some(x=>x.repo.toLowerCase()===key);
  }
  return false;
}
function allowedUrl(raw){
  try{
    const u=new URL(String(raw||'').trim());
    if(u.protocol!=='https:')return null;
    const host=u.hostname.toLowerCase();
    return (ALLOWED_SOURCE_HOSTS.includes(host)||curatedGithubUrl(u))?u.toString():null;
  }catch{return null;}
}
function stripHtml(raw){
  return String(raw||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/\s+/g,' ').trim();
}
function normalizedTerms(topic){
  return String(topic||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=3).slice(0,6);
}
function sourceLooksRelevant(topic,text){
  const t=String(text||'').toLowerCase();
  const terms=normalizedTerms(topic);
  if(!terms.length)return false;
  return terms.some(x=>t.includes(x)) && /(futures|trading|price|market|order|volume|trend|pattern|risk|liquid|margin|support|resistance|indicator|open interest|funding|backtest|exchange|portfolio)/i.test(t);
}
function repoHints(family){
  const f=String(family||'OTHER').toUpperCase();
  const wanted=f==='INDICATOR'||f==='PATTERN'?['INDICATOR','TECHNICAL_ANALYSIS','STRATEGY','BACKTEST']
    : f==='MICROSTRUCTURE'?['MICROSTRUCTURE','ORDER_BOOK','EXECUTION','MARKET_DATA']
    : f==='DERIVATIVES'||f==='EXECUTION'?['EXECUTION','EXCHANGE','MARKET_DATA','EVENT_DRIVEN']
    : ['STRATEGY','RISK','BACKTEST','PERFORMANCE'];
  return CURATED_OPEN_SOURCE_REPOS
    .filter(x=>x.roles.some(r=>wanted.includes(r)))
    .slice(0,5)
    .map(x=>({repo:x.repo,url:x.url,license:x.license,roles:x.roles}));
}
function topicCandidates(unified,evidence=null){
  const out=[];
  for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d']){
    const f=unified?.frames?.[tf];
    if(!f?.available)continue;
    for(const p of Array.isArray(f.patterns)?f.patterns:[]){
      const v=safeTopic(p?.id||p?.name||p?.type||p);
      if(v)out.push({topic:v,family:'PATTERN',tf});
    }
    const candle=safeTopic(f?.candle?.pattern||f?.candle?.type||'');
    if(candle)out.push({topic:candle,family:'PATTERN',tf});
  }
  const evidenceText=clip(JSON.stringify(evidence||{}),20000);
  const visual=(String(evidence?.visual?.text||'')+'\n'+evidenceText).slice(0,26000);
  const rx=/(SETUP|PATTERN|FORMATION|CANDLE|INDICATOR|CONCEPT|MICROSTRUCTURE|DERIVATIVES|ORDER[_ ]?FLOW|LIQUIDITY)\s*[:=]\s*([A-Za-z0-9_+\-/ ]{2,60})/gi;
  const familyOf=label=>{
    const z=String(label||'').toUpperCase().replace(/ /g,'_');
    if(['SETUP','PATTERN','FORMATION','CANDLE'].includes(z))return 'PATTERN';
    if(z==='INDICATOR')return 'INDICATOR';
    if(['MICROSTRUCTURE','ORDER_FLOW','LIQUIDITY'].includes(z))return 'MICROSTRUCTURE';
    if(z==='DERIVATIVES')return 'DERIVATIVES';
    return 'OTHER';
  };
  let m;
  while((m=rx.exec(visual))!==null){
    const v=safeTopic(m[2]);
    if(v&&!/^(NONE|NO|N A|UNKNOWN|WAIT|LONG|SHORT)$/i.test(v))out.push({topic:v,family:familyOf(m[1]),tf:'EVIDENCE'});
  }
  return out.filter((x,i,a)=>a.findIndex(y=>y.topic.toUpperCase()===x.topic.toUpperCase())===i).slice(0,16);
}
function createKnowledgeResearch({
  root,
  routerResearch,
  openRouterResearch,
  jevReview,
  fetchImpl=globalThis.fetch,
  clock=()=>Date.now(),
  sleepImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  retryDelaysMs=[0,350,1000]
}={}){
  if(!root)throw new Error('knowledge research root required');
  const file=path.join(root,'data','jev-knowledge.json');
  let busy=false;
  let last={ok:true,called:false,at:null,reason:'NOT_CALLED'};

  function state(){
    const x=readJson(file,{version:1,entries:[]});
    const entries=Array.isArray(x.entries)?x.entries:[];
    return {version:1,entries};
  }
  function save(entries){writeJsonAtomic(file,{version:1,updatedAt:new Date(clock()).toISOString(),entries:entries.slice(-80)});}
  function reference(maxChars=7000){
    const entries=state().entries.filter(x=>x?.status==='VERIFIED_REFERENCE').slice(-24).reverse();
    const compact=entries.map(x=>({
      topic:x.topic,family:x.family,verifiedAt:x.verifiedAt,summary:clip(x.summary,900),
      keyPoints:Array.isArray(x.keyPoints)?x.keyPoints.slice(0,6).map(v=>clip(v,240)):[],
      sourceUrls:Array.isArray(x.sourceUrls)?x.sourceUrls.slice(0,4):[]
    }));
    let raw=JSON.stringify(compact);
    while(raw.length>maxChars&&compact.length>2){compact.pop();raw=JSON.stringify(compact);}
    return compact;
  }
  function hasTopic(topic){
    const key=String(topic||'').toUpperCase();
    return state().entries.some(x=>x?.status==='VERIFIED_REFERENCE'&&String(x.topic||'').toUpperCase()===key);
  }
  function detectGap(unified,cortexText='',evidence=null){
    const dynamic=reference(12000);
    const known=(String(cortexText||'')+' '+dynamic.map(x=>x.topic+' '+x.summary).join(' ')).toUpperCase();
    return topicCandidates(unified,evidence).find(x=>!known.includes(String(x.topic||'').replace(/_/g,' ').toUpperCase())&&!hasTopic(x.topic))||null;
  }
  async function askChannel(fn,{topic,family,sourceText=''}) {
    if(typeof fn!=='function')return {ok:false,reason:'CHANNEL_UNAVAILABLE'};
    const hints=repoHints(family);
    const system='You are a read-only trading knowledge researcher. Do not make a trade decision. Do not claim hidden participant identity or intent. Return JSON only.';
    const prompt=[
      'TOPIC: '+topic,
      'FAMILY: '+family,
      sourceText?'VERIFIED_SOURCE_EXCERPTS:\n'+sourceText:'',
      !sourceText&&hints.length?'CURATED_OPEN_SOURCE_ENGINEERING_REFERENCES (secondary only; never treat repo popularity as market evidence; do not copy code):\n'+hints.map(x=>x.repo+' | '+x.license+' | '+x.url+' | '+x.roles.join(',')).join('\n'):'',
      sourceText
        ? 'Using ONLY the verified source excerpts, return {"summary":"...","keyPoints":["..."],"sourceUrls":[]}. Do not add facts not present in the excerpts.'
        : 'Research the definition, mechanics, valid interpretation, failure modes and misuse risks. Return {"summary":"...","keyPoints":["..."],"sourceUrls":["https://..."]}. Prefer CME, Binance, CFTC, TradingView Support, or Investopedia for trading facts. Curated GitHub repos may support software/indicator/execution implementation details only. If uncertain, say so.'
    ].filter(Boolean).join('\n\n');
    try{
      const r=await fn({system,prompt,topic,family});
      if(r&&typeof r==='object'&&r.ok===false){
        return {ok:false,reason:String(r.reason||'RESEARCH_CHANNEL_UNAVAILABLE'),detail:clip(r.detail||'',300),model:r.model||null};
      }
      const text=String(r?.text||r?.content||r||'');
      const parsed=jsonFromText(text);
      if(!parsed)return {ok:false,reason:'RESEARCH_JSON_INVALID',raw:clip(text,1200),model:r?.model||null};
      return {
        ok:true,
        summary:clip(parsed.summary,2200),
        keyPoints:Array.isArray(parsed.keyPoints)?parsed.keyPoints.slice(0,10).map(x=>clip(x,360)):[],
        sourceUrls:Array.isArray(parsed.sourceUrls)?parsed.sourceUrls.map(allowedUrl).filter(Boolean).slice(0,8):[],
        model:r?.model||null
      };
    }catch(e){return {ok:false,reason:'RESEARCH_CHANNEL_FAILED',detail:clip(e?.message||e,300)};}
  }
  async function askChannelResilient(fn,args){
    const delays=Array.isArray(retryDelaysMs)&&retryDelaysMs.length?retryDelaysMs.slice(0,4):[0];
    let lastResult={ok:false,reason:'CHANNEL_UNAVAILABLE'};
    for(let attempt=0;attempt<delays.length;attempt++){
      const delay=Math.max(0,Number(delays[attempt])||0);
      if(delay&&typeof sleepImpl==='function')await sleepImpl(delay);
      const result=await askChannel(fn,args);
      if(result.ok)return {...result,attempts:attempt+1};
      lastResult=result;
      const r=String(result.reason||'');
      const d=String(result.detail||result.raw||'');
      const transient=/UNAVAILABLE|FAILED|TIMEOUT|429|RATE|JSON_INVALID/i.test(r+' '+d);
      if(!transient)break;
    }
    return {...lastResult,attempts:delays.length};
  }
  async function fetchOne(url){
    let lastStatus=null;
    for(let attempt=0;attempt<2;attempt++){
      try{
        if(attempt&&typeof sleepImpl==='function')await sleepImpl(300);
        const r=await fetchImpl(url,{headers:{'user-agent':'BrainHub-JEV-Knowledge/1.1','accept':'text/html,text/plain'},signal:AbortSignal.timeout(12000),redirect:'follow'});
        lastStatus=r.status;
        if(!r.ok){
          if(r.status===429||r.status>=500)continue;
          return null;
        }
        const raw=(await r.text()).slice(0,300000);
        return stripHtml(raw).slice(0,30000);
      }catch{}
    }
    return lastStatus?null:null;
  }
  async function fetchSources(topic,urls){
    const out=[];
    for(const url of [...new Set(urls)].slice(0,6)){
      const text=await fetchOne(url);
      if(!text||!sourceLooksRelevant(topic,text))continue;
      out.push({url,excerpt:clip(text,5500)});
    }
    return out;
  }
  async function research({topic,family='OTHER',force=false}={}){
    topic=safeTopic(topic); family=String(family||'OTHER').toUpperCase().slice(0,32);
    if(!topic)return {ok:false,called:false,reason:'KNOWLEDGE_TOPIC_INVALID'};
    if(!force&&hasTopic(topic))return {ok:true,called:false,cached:true,topic,reason:'KNOWLEDGE_ALREADY_VERIFIED'};
    if(busy)return {ok:true,called:false,reason:'KNOWLEDGE_RESEARCH_BUSY'};
    busy=true;
    try{
      const [router,openrouter]=await Promise.all([
        askChannelResilient(routerResearch,{topic,family}),
        askChannelResilient(openRouterResearch,{topic,family})
      ]);
      const urls=[...(router.sourceUrls||[]),...(openrouter.sourceUrls||[])];
      const sources=await fetchSources(topic,urls);
      if(!sources.length){
        last={ok:false,called:true,topic,family,at:new Date(clock()).toISOString(),reason:'NO_VERIFIED_SOURCE_FETCHED',routerOk:router.ok===true,openRouterOk:openrouter.ok===true,routerAttempts:router.attempts||0,openRouterAttempts:openrouter.attempts||0};
        return last;
      }
      const sourceText=sources.map((x,i)=>'SOURCE_'+(i+1)+' '+x.url+'\n'+x.excerpt).join('\n\n');
      const [groundedRouter,groundedOpenRouter]=await Promise.all([
        askChannelResilient(routerResearch,{topic,family,sourceText}),
        askChannelResilient(openRouterResearch,{topic,family,sourceText})
      ]);
      const reviewPayload={
        topic,family,
        router:groundedRouter.ok?{summary:groundedRouter.summary,keyPoints:groundedRouter.keyPoints,model:groundedRouter.model}:null,
        openRouter:groundedOpenRouter.ok?{summary:groundedOpenRouter.summary,keyPoints:groundedOpenRouter.keyPoints,model:groundedOpenRouter.model}:null,
        sources:sources.map(x=>({url:x.url,excerpt:clip(x.excerpt,1800)}))
      };
      const review=typeof jevReview==='function'?await jevReview(reviewPayload):{ok:false,verdict:'REJECT',reason:'JEV_REVIEW_UNAVAILABLE'};
      if(!review?.ok||review.verdict!=='ACCEPT_REFERENCE'){
        last={ok:false,called:true,topic,family,at:new Date(clock()).toISOString(),reason:review?.reason||'JEV_RESEARCH_REJECTED',review};
        return last;
      }
      const preferred=groundedRouter.ok?groundedRouter:groundedOpenRouter;
      if(!preferred?.ok){
        last={ok:false,called:true,topic,family,at:new Date(clock()).toISOString(),reason:'NO_GROUNDED_RESEARCH_SUMMARY'};
        return last;
      }
      const entries=state().entries.filter(x=>String(x?.topic||'').toUpperCase()!==topic.toUpperCase());
      const entry={
        topic,family,status:'VERIFIED_REFERENCE',
        verifiedAt:new Date(clock()).toISOString(),
        summary:preferred.summary,
        keyPoints:preferred.keyPoints,
        sourceUrls:sources.map(x=>x.url),
        channels:{
          router:groundedRouter.model||null,routerAttempts:groundedRouter.attempts||null,
          openRouter:groundedOpenRouter.model||null,openRouterAttempts:groundedOpenRouter.attempts||null,
          jev:'typesafe/jev-1.13'
        },
        selfModify:false,autoPromotionToRules:false,executionAuthority:false
      };
      entries.push(entry); save(entries);
      last={ok:true,called:true,topic,family,at:entry.verifiedAt,status:entry.status,sourceCount:entry.sourceUrls.length};
      return {...last,entry};
    }finally{busy=false;}
  }
  async function researchFromContext({unified,evidence=null,cortexText='',familyHint=null}={}){
    const gap=detectGap(unified,cortexText,evidence);
    if(!gap)return {ok:true,called:false,reason:'NO_UNVERIFIED_KNOWLEDGE_GAP'};
    if(familyHint&&String(familyHint).toUpperCase()!=='AUTO'&&String(familyHint).toUpperCase()!==gap.family)return {ok:true,called:false,reason:'NO_MATCHING_KNOWLEDGE_GAP',gap};
    return research({topic:gap.topic,family:gap.family});
  }
  function status(){
    const entries=state().entries.filter(x=>x?.status==='VERIFIED_REFERENCE');
    return {
      ok:true,busy,verifiedCount:entries.length,last:{...last},
      latest:entries.slice(-5).reverse().map(x=>({topic:x.topic,family:x.family,verifiedAt:x.verifiedAt,sourceUrls:x.sourceUrls})),
      retryPolicy:{channelAttempts:Math.max(1,Math.min(4,Array.isArray(retryDelaysMs)?retryDelaysMs.length:1)),sourceFetchAttempts:2},
      openSourceRepoCount:CURATED_OPEN_SOURCE_REPOS.length,
      openSourceRepos:CURATED_OPEN_SOURCE_REPOS.map(x=>({repo:x.repo,url:x.url,license:x.license,roles:x.roles}))
    };
  }
  return {research,researchFromContext,reference,status,detectGap};
}
module.exports={ALLOWED_SOURCE_HOSTS,CURATED_OPEN_SOURCE_REPOS,safeTopic,allowedUrl,repoHints,topicCandidates,createKnowledgeResearch};
