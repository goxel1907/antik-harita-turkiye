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
  {repo:'ranaroussi/quantstats',url:'https://github.com/ranaroussi/quantstats',license:'Apache-2.0',roles:['PERFORMANCE','RISK_ANALYTICS']},
  // R2544.17 research additions: architecture/validation references only; never copied as live strategy authority.
  {repo:'microsoft/qlib',url:'https://github.com/microsoft/qlib',license:'MIT',roles:['ML_RESEARCH','MARKET_DYNAMICS','REGIME','WALK_FORWARD']},
  {repo:'online-ml/river',url:'https://github.com/online-ml/river',license:'BSD-3-Clause',roles:['ONLINE_LEARNING','CONCEPT_DRIFT','STREAMING_STATS']},
  {repo:'nkaz001/hftbacktest',url:'https://github.com/nkaz001/hftbacktest',license:'MIT',roles:['ORDER_BOOK','MICROSTRUCTURE','LATENCY','BACKTEST'],why:'Offline tick replay reference for feed/order latency, queue position and realistic scalp fills; no live strategy import.',concepts:['FEED_LATENCY','ORDER_LATENCY','QUEUE_POSITION','TICK_REPLAY'],integrationStatus:'REFERENCE_ONLY',authority:'REFERENCE_ONLY',reviewedCommit:'5f3ec40b2afb764e0fea112f941ed85523ef4e88',checkedAt:'2026-10-04'},
  {repo:'AgentJDrew/backtest-guard',url:'https://github.com/AgentJDrew/backtest-guard',license:'MIT',roles:['VALIDATION','OVERFITTING','PURGED_CV','BACKTEST']},
  {repo:'landtml/purgedcv',url:'https://github.com/landtml/purgedcv',license:'MIT',roles:['VALIDATION','PURGED_CV','WALK_FORWARD']},
  // R2544.19: verified-license microstructure/data-integrity references. Reference-only; no code is copied and
  // repository claims never override Binance/BrainHub market truth or JEV authority.
  {repo:'MarcoSalzer/crypto-microstructure',url:'https://github.com/MarcoSalzer/crypto-microstructure',license:'MIT',roles:['MICROSTRUCTURE','ORDER_BOOK','ORDER_FLOW','ABSORPTION','MARKET_DYNAMICS'],why:'Feature taxonomy for order-flow/depth continuation-vs-reversal research.',concepts:['OFI','TAKER_AGGRESSION','LIQUIDITY_WITHDRAWAL','ABSORPTION','PRICE_IMPACT']},
  {repo:'mamonet/orderbook-heatmap',url:'https://github.com/mamonet/orderbook-heatmap',license:'MIT',roles:['MICROSTRUCTURE','ORDER_BOOK','CVD','ABSORPTION'],why:'Reference definitions for depth clusters, delta/CVD and absorption observations.',concepts:['DEPTH_CLUSTER','CVD','BOOK_IMBALANCE','ABSORPTION']},
  {repo:'twowaymind/orderflow-metrics',url:'https://github.com/twowaymind/orderflow-metrics',license:'MIT',roles:['MICROSTRUCTURE','ORDER_FLOW','STREAMING_STATS'],why:'Compact dependency-light reference for deterministic order-flow metrics.',concepts:['DEPTH_IMBALANCE','TRADE_IMBALANCE','VPIN']},
  {repo:'ml4t/engineer',url:'https://github.com/ml4t/engineer',license:'MIT',roles:['ML_RESEARCH','LABELING','VALIDATION','PURGED_CV'],why:'Outcome labeling and leakage-aware research reference for trade-case evaluation.',concepts:['TRIPLE_BARRIER','META_LABELING','PURGED_CV','EMBARGO']},
  {repo:'juitindev/crypto-market-data-pipeline',url:'https://github.com/juitindev/crypto-market-data-pipeline',license:'MIT',roles:['MARKET_DATA','DATA_INTEGRITY','SCHEMA','VALIDATION'],why:'Typed market-data validation reference for timestamp/OHLC/order-book invariants.',concepts:['TIMESTAMP_INVARIANTS','OHLC_VALIDATION','ORDERBOOK_INVARIANTS','SCHEMA_VALIDATION']},
  // R2544.20: low-star / focused references found during a second microstructure pass. GitHub metadata exposed MIT.
  {repo:'armaansg/orderbook-microstructure',url:'https://github.com/armaansg/orderbook-microstructure',license:'MIT',roles:['MICROSTRUCTURE','ORDER_FLOW','ORDER_BOOK','VALIDATION'],why:'Binance USD-M 100ms bookTicker study with leakage-aware OFI/microprice/queue-imbalance evaluation; useful to keep predictive claims separate from executable edge.',concepts:['OFI','MICROPRICE','QUEUE_IMBALANCE','HORIZON_DECAY','OOS_EMBARGO']},
  {repo:'S-razmi/DeepLOB',url:'https://github.com/S-razmi/DeepLOB',license:'MIT',roles:['ML_RESEARCH','ORDER_BOOK','MICROSTRUCTURE','SHADOW_PREDICTOR'],why:'BTC perpetual DeepLOB/TCN reference for future shadow-only short-horizon direction research; never a live decision authority.',concepts:['DEEPLOB','LOB_TENSOR','SHORT_HORIZON_DIRECTION','OOS_VALIDATION']},
  // R2544.26: verified/adopted research provenance. Registry status describes how the idea is used;
  // it never grants strategy/execution authority and repo prose is not injected into JEV market truth.
  {repo:'Khaymat/pyvsmc',url:'https://github.com/Khaymat/pyvsmc',license:'MIT',roles:['SMC','STRUCTURE','FVG','BOS_CHOCH','OTE','LIQUIDITY'],why:'Offline golden-oracle reference for deterministic SMC semantics; never a live dependency.',concepts:['FVG','CE50','IFVG','SWINGS','BOS_CHOCH','ORDER_BLOCK','LIQUIDITY_SWEEP','OTE'],integrationStatus:'OFFLINE_ORACLE',authority:'REFERENCE_ONLY'},
  {repo:'JWHaan/quant.term',url:'https://github.com/JWHaan/quant.term',license:'MIT',roles:['ORDER_FLOW','OFI','CVD','DATA_PROVENANCE','GAP_VALIDATION'],why:'Reference for deterministic market-data provenance, checksums, gap reporting and order-flow research panels.',concepts:['DATASET_PROVENANCE','GAP_REPORTING','CHECKSUM','OFI','CVD'],integrationStatus:'REFERENCE_ADOPTED',authority:'REFERENCE_ONLY'},
  {repo:'crisari666/liquidity-scanner',url:'https://github.com/crisari666/liquidity-scanner',license:'UNVERIFIED_CURRENT',roles:['MICROSTRUCTURE','ORDER_BOOK','LIQUIDITY'],why:'Historical reviewed concept source; current BrainHub already implements persistence/pull/replenishment/absorption concepts independently.',concepts:['WALL_PERSISTENCE','LIQUIDITY_PULL','REPLENISHMENT','ABSORPTION'],integrationStatus:'HISTORICAL_CONCEPT_ADOPTED',authority:'REFERENCE_ONLY'},
  {repo:'AIUngated/crypto-liquidity-terminal',url:'https://github.com/AIUngated/crypto-liquidity-terminal',license:'MIT',roles:['ORDER_BOOK','MARKET_DATA','MICROSTRUCTURE'],why:'Architecture reference for sequence-safe local order-book reconstruction; USD-M implementation follows Binance U/u/pu rules rather than copying spot assumptions.',concepts:['LOCAL_L2','SEQUENCE_HEALTH','RESYNC','MULTILEVEL_OFI'],integrationStatus:'ARCHITECTURE_ADAPTED',authority:'REFERENCE_ONLY'},
  {repo:'minchillo4/btc-liquidation-heatmap',url:'https://github.com/minchillo4/btc-liquidation-heatmap',license:'MIT',roles:['OPEN_INTEREST','LIQUIDATION_MODEL','SHADOW_RESEARCH'],why:'Reference for OI anomaly and modeled liquidation-density research; modeled zones remain explicitly estimated and separate from observed Binance forceOrder.',concepts:['OI_ANOMALY','MODELED_LIQUIDATION_DENSITY','POSITION_FLOW_REGIME'],integrationStatus:'SHADOW_MODEL_REFERENCE',authority:'SHADOW_EVIDENCE_ONLY'},
  // R36: primary README and GitHub license/commit metadata checked; implementation
  // remains unaudited and uninstalled. No repository prose becomes market truth.
  {repo:'mrzdev/quest_deep_orderbook',url:'https://github.com/mrzdev/quest_deep_orderbook',license:'MIT',roles:['ORDER_BOOK','MARKET_DATA','REPLAY'],why:'Research reference for recording Binance Futures depth metrics in QuestDB; useful for later gap/latency replay, not an executable scalp strategy.',concepts:['DEPTH_RECORDING','TIME_SERIES','LOCAL_DEPTH_CACHE'],integrationStatus:'REFERENCE_ONLY',authority:'REFERENCE_ONLY',reviewedCommit:'d912eda1621264e8d196fe0b1c92380f1f923c68',checkedAt:'2026-10-04'},
  {repo:'thrownew/go-binance-orderbook',url:'https://github.com/thrownew/go-binance-orderbook',license:'MIT',roles:['ORDER_BOOK','DATA_INTEGRITY','MICROSTRUCTURE'],why:'Focused low-star USD-M U/u/pu synchronization reference; local BrainHub L2 stays authoritative and no Go dependency is installed.',concepts:['USD_M_SEQUENCE','SNAPSHOT_RESYNC','BOUNDED_SNAPSHOT_CONCURRENCY'],integrationStatus:'REFERENCE_ONLY',authority:'REFERENCE_ONLY',reviewedCommit:'8b19a6b6c279b52a4135d34aad2f46c7d9a38648',checkedAt:'2026-10-04'}
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
    const registered=CURATED_OPEN_SOURCE_REPOS.some(x=>x.repo.toLowerCase()===key);
    if(!registered)return false;
    if(parts.length===2)return true;
    return ['blob','tree'].includes(String(parts[2]||'').toLowerCase());
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
  const wanted=f==='INDICATOR'||f==='PATTERN'?['INDICATOR','TECHNICAL_ANALYSIS','STRATEGY','BACKTEST','VALIDATION']
    : f==='MICROSTRUCTURE'?['MICROSTRUCTURE','ORDER_BOOK','EXECUTION','MARKET_DATA','LATENCY']
    : f==='REGIME'?['REGIME','MARKET_DYNAMICS','ONLINE_LEARNING','CONCEPT_DRIFT','WALK_FORWARD']
    : f==='DERIVATIVES'||f==='EXECUTION'?['EXECUTION','EXCHANGE','MARKET_DATA','EVENT_DRIVEN','LATENCY']
    : ['STRATEGY','RISK','BACKTEST','PERFORMANCE','VALIDATION','OVERFITTING','ONLINE_LEARNING'];
  return CURATED_OPEN_SOURCE_REPOS
    .filter(x=>x.roles.some(r=>wanted.includes(r)))
    .slice(0,5)
    .map(x=>({repo:x.repo,url:x.url,license:x.license,roles:x.roles,why:x.why||null,concepts:Array.isArray(x.concepts)?x.concepts:[],reviewedCommit:x.reviewedCommit||null,checkedAt:x.checkedAt||null,integrationStatus:x.integrationStatus||'REFERENCE_ONLY',authority:x.authority||'REFERENCE_ONLY'}));
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
  const attemptsFile=path.join(root,'data','jev-knowledge-attempts.json');
  const attemptsState=readJson(attemptsFile,{topics:{},hosts:{}});
  const recentTopics=attemptsState.topics||{},sourceCooldown=attemptsState.hosts||{},sourceCache=new Map();
  function saveAttempts(){try{writeJsonAtomic(attemptsFile,{topics:Object.fromEntries(Object.entries(recentTopics).sort((a,b)=>b[1]-a[1]).slice(0,80)),hosts:sourceCooldown});}catch{}}

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
    let lastResult={ok:false,reason:'CHANNEL_UNAVAILABLE'},attempts=0;
    for(let attempt=0;attempt<delays.length;attempt++){
      const delay=Math.max(0,Number(delays[attempt])||0);
      if(delay&&typeof sleepImpl==='function')await sleepImpl(delay);
      const result=await askChannel(fn,args);
      attempts++;
      if(result.ok)return {...result,attempts:attempt+1};
      lastResult=result;
      const r=String(result.reason||'');
      const d=String(result.detail||result.raw||'');
      const transient=/UNAVAILABLE|FAILED|TIMEOUT|429|RATE|JSON_INVALID/i.test(r+' '+d);
      if(!transient)break;
    }
    return {...lastResult,attempts};
  }
  async function fetchOne(url){
    const host=new URL(url).hostname,cached=sourceCache.get(url);
    if(clock()<Number(sourceCooldown[host]||0))return null;
    if(cached&&clock()-cached.at<86400000)return cached.text;
    let lastStatus=null;
    for(let attempt=0;attempt<2;attempt++){
      try{
        if(attempt&&typeof sleepImpl==='function')await sleepImpl(300);
        const r=await fetchImpl(url,{headers:{'user-agent':'BrainHub-JEV-Knowledge/1.1','accept':'text/html,text/plain'},signal:AbortSignal.timeout(12000),redirect:'follow'});
        lastStatus=r.status;
        if(!r.ok){
          if(r.status===429){const retry=r.headers?.get?.('retry-after'),ms=Number(retry)*1000||Math.max(0,Date.parse(retry)-clock());sourceCooldown[host]=clock()+Math.max(60000,Math.min(86400000,ms||60000));saveAttempts();return null;}
          if(r.status>=500)continue;
          return null;
        }
        const raw=(await r.text()).slice(0,300000);
        const text=stripHtml(raw).slice(0,30000);sourceCache.set(url,{at:clock(),text});if(sourceCache.size>100)sourceCache.delete(sourceCache.keys().next().value);return text;
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
    const topicKey=topic.toUpperCase();
    if(!force&&recentTopics[topicKey]!==undefined&&clock()-recentTopics[topicKey]<900000)return {ok:false,called:false,topic,reason:'KNOWLEDGE_TOPIC_COOLDOWN',nextAttemptAt:recentTopics[topicKey]+900000};
    if(busy)return {ok:true,called:false,reason:'KNOWLEDGE_RESEARCH_BUSY'};
    busy=true;
    recentTopics[topicKey]=clock();saveAttempts();
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
      sourceLimits:{topicRetryMs:900000,cacheTtlMs:86400000,hostCooldowns:{...sourceCooldown}},
      openSourceRepoCount:CURATED_OPEN_SOURCE_REPOS.length,
      openSourceRepos:CURATED_OPEN_SOURCE_REPOS.map(x=>({repo:x.repo,url:x.url,license:x.license,roles:x.roles,why:x.why||null,concepts:Array.isArray(x.concepts)?x.concepts:[],reviewedCommit:x.reviewedCommit||null,checkedAt:x.checkedAt||null,integrationStatus:x.integrationStatus||'REFERENCE_ONLY',authority:x.authority||'REFERENCE_ONLY',executionAuthority:false}))
    };
  }
  return {research,researchFromContext,reference,status,detectGap};
}
module.exports={ALLOWED_SOURCE_HOSTS,CURATED_OPEN_SOURCE_REPOS,safeTopic,allowedUrl,repoHints,topicCandidates,createKnowledgeResearch};
