const fs=require('fs');
const path=require('path');

const DEFAULTS={
  enabled:false,
  model:'typesafe/jev-1.13',
  decisionsUrl:'https://openrouter.ai/api/alpha/decisions',
  keyUrl:'https://openrouter.ai/api/v1/key',
  creditsUrl:'https://openrouter.ai/api/v1/credits',
  billingCacheMs:300000,
  mode:'SOVEREIGN_DIRECTOR_5M15M',
  softBudgetUsd:0.25,
  dailyCapUsd:2.00,
  timeoutMs:30000,
  maxPayloadChars:48000,
  reservePerCallUsd:0.002
};

// LEGACY COMPATIBILITY ONLY. The active R2.5.3.2 server path uses sovereignPass1/sovereignFinal;
// these historical veto checks are retained only for old tests/rollback compatibility and are not
// a pre-JEV qualification gate in the sovereign flow.
const CHECKS = [
  ['structural_veto','structuralVeto','JEV_STRUCTURAL_VETO','Yapısal çelişki', 'BOS/CHoCH, failed breakout, body/wick or candle-pattern evidence contradicts the existing setup.'],
  ['forming_dependency','formingDependency','JEV_FORMING_CONFIRMATION_DEPENDENCY','Açık mum teyit yerine kullanılmış','The plan needs a forming candle as confirmation rather than context.'],
  ['data_quality_insufficient','dataQualityInsufficient','JEV_DATA_QUALITY_INSUFFICIENT','Veri kalitesi yetersiz','Critical timestamps, closed candles or evidence are missing/stale; auxiliary unavailable data alone is scoreless.'],
  ['direction_conflict','directionConflict','JEV_DIRECTION_CONFLICT','Yön çelişkisi','The proposed LONG/SHORT direction contradicts supplied structure or global BTC/ETH context.'],
  ['symbol_package_integrity','symbolPackageIntegrity','JEV_PACKAGE_INTEGRITY','Coin/paket uyuşmazlığı','Candidate, context and chart-evidence symbols differ, or the nine-frame package is incomplete.'],
  ['origin_owner_continuity','originOwnerContinuity','JEV_CONTINUITY_CONFLICT','Başlangıç-sahip sürekliliği bozuk','The stated origin-to-owner handoff lacks supplied continuity evidence or widens invalidation risk.'],
  ['tf_conflict','tfConflict','JEV_TF_CONFLICT','Zaman dilimleri çelişiyor','The setup ignores a material timeframe veto or counts synthetic 45m as an independent confirming vote. Timeframes are roles, not majority votes.'],
  ['smc_liquidity_conflict','smcLiquidityConflict','JEV_SMC_LIQUIDITY_CONFLICT','SMC/likidite çelişkisi','Supplied FVG, OB/breaker, BSL/SSL, sweep/reclaim or invalidation evidence contradicts the setup; do not infer hidden market-maker intent.'],
  ['microstructure_reliability','microstructureReliability','JEV_MICROSTRUCTURE_UNRELIABLE','Mikro yapı kanıtı yanlış kullanılmış','The plan treats stale/partial depth, sampled CVD, proxy OFI or observed liquidations as reliable proof; correlated measures must stay one soft family.'],
  ['closed_candle_confirmation','closedCandleConfirmation','JEV_CLOSED_CONFIRMATION_MISSING','Kapanmış mum teyidi eksik','Required closed-candle breakout/reclaim/body-wick confirmation is absent in the supplied evidence.'],
  ['visual_data_consistency','visualDataConsistency','JEV_VISUAL_DATA_CONFLICT','Grafik-veri çelişkisi','Text extracted from the actual charts conflicts with deterministic candle/price evidence. You cannot see PNGs; missing visual evidence must not be invented.'],
  ['wait_required','waitRequired','JEV_WAIT_REQUIRED','Bekleme koşulu tamamlanmamış','A stated setup-specific wait/reclaim/invalidation condition remains unresolved, so QUALIFIED should wait.'],
  // CLAUDE_V113: 22 Eyl canlı sonuçları — kaybedenler uzamış hareketin sonunda (4 saatte +5..+9%) girildi.
  ['extended_entry','extendedEntry','JEV_EXTENDED_LATE_ENTRY','Hareket uzamış / geç giriş','The move in the proposed direction is already extended: large supplied 1h/4h return in trade direction, price far from EMA20 in ATR units, RSI stretched, premium (for LONG) or discount (for SHORT) of the dealing range, or next liquidity/fib extension already reached. Entering now is chasing.'],
  ['poor_risk_geometry','poorRiskGeometry','JEV_POOR_RISK_GEOMETRY','Risk geometrisi zayıf','Supplied stop distance is wide versus trigger-timeframe ATR or the first target (1R) is blocked by nearby opposing liquidity, order block, FVG or fib level before it can be reached.'],
  ['negative_track_record','negativeTrackRecord','JEV_NEGATIVE_TRACK_RECORD','Geçmiş sonuçlar olumsuz','Supplied measured outcomes (learning stats / recent closed trades) for this same setup, side or symbol are materially negative, and nothing in the current evidence differs from those losing cases.']
];
const FRAMES=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
const SOVEREIGN_EVIDENCE=[
  ['TRADINGVIEW_5M','Request a fresh validated 5m TradingView visual reading for the 5m scalp lane.'],
  ['TRADINGVIEW_15M','Request a fresh validated 15m TradingView visual reading for the 15m trade lane and primary context.'],
  ['TIMING_1M','Request 1m timing evidence only if it materially helps entry timing; it is never a mandatory vote.'],
  ['TIMING_3M','Request 3m timing evidence only if it materially helps entry timing; it is never a mandatory vote.'],
  ['ORDER_FLOW_CVD','Request current order-flow/CVD evidence with source and freshness labels.'],
  ['DEPTH_L2','Request current public depth/L2 footprint evidence; never infer participant identity.'],
  ['DERIVATIVES','Request OI/funding/taker/top-trader/global positioning context.'],
  ['OBSERVED_LIQUIDATIONS','Request observed Binance forceOrder prints only; never fabricate a liquidation heatmap.'],
  ['HIGHER_TF_CONTEXT','Request 30m/1h/4h/1d context only when it materially changes the decision.'],
  ['HISTORY_OUTCOME','Request deeper measured closed-trade detail when it can help; a compact measured experience memory is already ALWAYS_ON and must never become a hard rule.']
];
function finiteNumber(v){
  if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function choiceValue(answer){
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return null;
  const v=String(answer.choice||'').trim();
  return v||null;
}
function sovereignFrame(f){
  if(!f?.available)return {available:false,reason:f?.reason||'UNAVAILABLE'};
  return {
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,close:finiteNumber(f.close),trend:f.trend||null,
    rsi14:finiteNumber(f.rsi14),atrPct:finiteNumber(f.atrPct),breakOfStructure:f.breakOfStructure||null,
    prior20High:finiteNumber(f.prior20High),prior20Low:finiteNumber(f.prior20Low),
    swingStructure:f.swingStructure||null,liquidity:f.liquidity||null,patterns:Array.isArray(f.patterns)?f.patterns.slice(-4):[],
    candle:f.candle||null
  };
}
function sovereignAttentionRecord(candidate,unified){
  return {
    contract:'R2.5.3.2_JEV_SOVEREIGN_5M_15M',
    authority:{decisionOwner:'JEV',scanner:'ATTENTION_ONLY',workers:'EVIDENCE_ONLY'},
    lanes:{scalp:'5m',trade:'15m',longShortSymmetric:true,allConditionsNeedNotAlign:true},
    symbol:String(candidate?.symbol||unified?.symbol||'').toUpperCase(),
    radar:{
      sideHint:['LONG','SHORT'].includes(String(candidate?.side||'').toUpperCase())?String(candidate.side).toUpperCase():null,
      source:candidate?.deepScanReason||null,
      targetSources:Array.isArray(candidate?.targetSources)?candidate.targetSources.slice(0,8):[],
      attackRank:finiteNumber(candidate?.attackRank),projectedRank:finiteNumber(candidate?.projectedRank),
      rankVelocity:finiteNumber(candidate?.rankVelocity),rankAcceleration:finiteNumber(candidate?.rankAcceleration),
      m1:finiteNumber(candidate?.m1),m3:finiteNumber(candidate?.m3),m5:finiteNumber(candidate?.m5),
      volumeAcceleration:finiteNumber(candidate?.volumeAcceleration),rangeExpansion:finiteNumber(candidate?.rangeExpansion),
      spreadBps:finiteNumber(candidate?.spreadBps),oiDeltaPct:finiteNumber(candidate?.oiDeltaPct),
      takerBuyRatio:finiteNumber(candidate?.takerBuyRatio),fundingRate:finiteNumber(candidate?.fundingRate)
    },
    livePrice:finiteNumber(unified?.livePrice),
    baseFrames:{'5m':sovereignFrame(unified?.frames?.['5m']),'15m':sovereignFrame(unified?.frames?.['15m'])},
    dataQuality:unified?.dataQuality||null,
    semantics:{
      scannerSideIsHintOnly:true,
      noPreJevQualification:true,
      noScoreThresholds:true,
      noTwoOfThreeRequirement:true,
      noHard15mStrategicVeto:true,
      formingCandleIsContextOnly:true,
      numericTruth:'BINANCE_BRAINHUB',
      visualWorker:'EVIDENCE_ONLY'
    }
  };
}

function compactSovereignEvidence(evidence,maxChars=28000){
  const src=evidence&&typeof evidence==='object'?evidence:{};
  const visual=src.visual&&typeof src.visual==='object'?src.visual:null;
  const out={
    requested:Array.isArray(src.requested)?src.requested.slice(0,16):[],
    timing1m:src.timing1m||null,
    timing3m:src.timing3m||null,
    higherTf:src.higherTf||null,
    orderFlow:src.orderFlow||null,
    depth:src.depth||null,
    derivatives:src.derivatives||null,
    observedLiquidations:src.observedLiquidations||null,
    historyOutcome:src.historyOutcome||null,
    visual:visual?{
      authority:visual.authority||'EVIDENCE_ONLY',
      requestedFrames:Array.isArray(visual.requestedFrames)?visual.requestedFrames.slice(0,8):[],
      attached:finiteNumber(visual.attached),required:finiteNumber(visual.required),
      source:visual.source||null,error:visual.error||null,
      text:String(visual.text||'').slice(0,6000),
      frames:visual.frames||null,
      failures:Array.isArray(visual.failures)?visual.failures.slice(0,6):[]
    }:null
  };
  const limit=Math.max(6000,Math.min(36000,Number(maxChars)||28000));
  const shrink=[
    x=>{if(x.visual)x.visual.text=String(x.visual.text||'').slice(0,3200);},
    x=>{if(x.visual)delete x.visual.frames;},
    x=>{if(x.historyOutcome&&typeof x.historyOutcome==='object'){x.historyOutcome={...x.historyOutcome,recentOutcomes:Array.isArray(x.historyOutcome.recentOutcomes)?x.historyOutcome.recentOutcomes.slice(0,4):[],stats:Array.isArray(x.historyOutcome.stats)?x.historyOutcome.stats.slice(0,4):[]};}},
    x=>{if(x.higherTf&&typeof x.higherTf==='object')x.higherTf=Object.fromEntries(Object.entries(x.higherTf).slice(0,2));},
    x=>{if(x.visual)x.visual.text=String(x.visual.text||'').slice(0,1600);}
  ];
  let raw=JSON.stringify(out);
  for(const fn of shrink){
    if(raw.length<=limit)break;
    fn(out);out.evidenceTrimmed=true;raw=JSON.stringify(out);
  }
  if(raw.length>limit){
    return {
      requested:out.requested,
      evidenceTrimmed:true,
      visual:out.visual?{authority:'EVIDENCE_ONLY',requestedFrames:out.visual.requestedFrames,attached:out.visual.attached,required:out.visual.required,source:out.visual.source,error:out.visual.error,text:String(out.visual.text||'').slice(0,800)}:null,
      orderFlow:out.orderFlow?{available:out.orderFlow.available??null,source:out.orderFlow.source||null,reason:out.orderFlow.reason||null}:null,
      derivatives:out.derivatives?{available:out.derivatives.available??null}:null,
      observedLiquidations:out.observedLiquidations?{available:out.observedLiquidations.available??null,count:finiteNumber(out.observedLiquidations.count),reason:out.observedLiquidations.reason||null}:null,
      note:'Evidence was compacted to keep the JEV decision payload bounded. Missing optional detail is not negative evidence.'
    };
  }
  return out;
}

const EXIT_CHECKS=[
  ['owner_structure_failure','ownerStructureFailure','Sahip zaman dilimi yapısı bozuldu','Owner TF üzerinde kapanmış mum/yapısal kanıt mevcut pozisyon yönünü bozuyor.'],
  ['anchor_structure_failure','anchorStructureFailure','Büyük resim yapısı bozuldu','15m/30m/1h/4h/1d bağlamında pozisyon yönüne karşı anlamlı ve kalıcı yapısal bozulma var.'],
  ['low_tf_noise_only','lowTfNoiseOnly','Yalnız düşük zaman dilimi gürültüsü','Ters sinyaller yalnız 1m/3m/5m gürültüsünde; owner ve büyük resim yapısı bozulmuş değil.'],
  ['momentum_decay','momentumDecay','Momentum belirgin zayıfladı','Momentum/akış zayıflaması tek mumluk değil ve pozisyon kârını koruma ihtiyacını artırıyor.'],
  ['liquidity_reversal','liquidityReversal','Likidite dönüş riski','Sweep/reclaim/likidite yapısı pozisyon yönünün devamını anlamlı biçimde zayıflatıyor.'],
  ['profit_at_risk','profitAtRisk','Açık kâr geri verme riski','Pozisyon kârda ve mevcut kanıtlar kârın önemli bölümünün geri verilme riskini artırıyor.'],
  ['data_quality_insufficient','exitDataQualityInsufficient','Pozisyon yönetimi verisi yetersiz','Owner/büyük resim veya pozisyon verisi eksik/stale; agresif çıkış kararı verilmemeli.']
];
function exitDecisionQuestions(){
  return Object.fromEntries(EXIT_CHECKS.map(([id,,,evidence])=>[id,{type:'noul',instructions:
    'Açık pozisyon yönetimi. '+evidence+' 1m/3m/5m tek başına yapısal çıkış değildir; owner TF ve büyük resim daha ağırdır. Sadece verilen kanıtı kullan.',
    criteria:{true:evidence,false:'Verilen kanıt bu koşulu yeterince göstermiyor.'}}]));
}
function decisionQuestions(){
  const questions=Object.fromEntries(CHECKS.map(([id,,,,evidence])=>[id,{type:'noul',instructions:'Does this veto condition apply? '+evidence,criteria:{true:evidence,false:'Supplied evidence does not establish this veto condition.'}}]));
  for(const tf of FRAMES)questions['conflict_'+tf]={type:'noul',instructions:'Does '+tf+' contain a material setup contradiction requiring a wait? Use supplied evidence only; 45m is synthetic.',criteria:{true:'Explicit evidence in this timeframe contradicts the proposed setup.',false:'No material contradiction is established in this timeframe.'}};
  return questions;
}

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
  catch{return {};}
}
function writeJsonAtomic(file,obj){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(obj,null,2),'utf8');
  fs.renameSync(tmp,file);
}
function traderCortexReference(root){
  const candidates=[
    {file:path.join(root,'docs','JEV-PRO-TRADER-CORTEX-R2534.md'),version:'R2.5.3.4',mode:'LIVE_REASONING_REFERENCE_READ_ONLY'},
    {file:path.join(root,'docs','JEV-PRO-TRADER-CORTEX-R2533.md'),version:'R2.5.3.3',mode:'SHADOW_KNOWLEDGE_REFERENCE'}
  ];
  for(const x of candidates){
    try{
      const raw=fs.readFileSync(x.file,'utf8').replace(/^\uFEFF/,'').trim();
      if(raw)return {loaded:true,version:x.version,mode:x.mode,text:raw.slice(0,14000),file:x.file};
    }catch{}
  }
  return {loaded:false,version:'R2.5.3.4',mode:'LIVE_REASONING_REFERENCE_READ_ONLY',text:'',file:null};
}
function compactExperienceMemory(learning,maxChars=6500){
  const src=learning&&typeof learning==='object'?learning:{};
  const out={
    alwaysOn:true,
    source:src.source||'BrainHub measured experience memory',
    measuredSampleCount:Number(src.measuredSampleCount)||0,
    jevLessonCount:Number(src.jevLessonCount)||0,
    stats:Array.isArray(src.stats)?src.stats.slice(0,8):[],
    measuredOutcomes:Array.isArray(src.measuredOutcomes)?src.measuredOutcomes.slice(0,8):[],
    jevLessons:Array.isArray(src.jevLessons)?src.jevLessons.slice(0,8):[],
    note:'Always-on soft context. Measured outcomes and JEV lessons inform interpretation but never create hard gates, change capital settings, or bypass deterministic safety.'
  };
  const limit=Math.max(2500,Math.min(9000,Number(maxChars)||6500));
  let raw=JSON.stringify(out);
  if(raw.length>limit){out.measuredOutcomes=out.measuredOutcomes.slice(0,5);out.jevLessons=out.jevLessons.slice(0,5);raw=JSON.stringify(out);}
  if(raw.length>limit){out.stats=out.stats.slice(0,5);out.measuredOutcomes=out.measuredOutcomes.slice(0,3);out.jevLessons=out.jevLessons.slice(0,3);raw=JSON.stringify(out);}
  if(raw.length>limit){
    return {
      alwaysOn:true,source:out.source,measuredSampleCount:out.measuredSampleCount,jevLessonCount:out.jevLessonCount,
      stats:out.stats.slice(0,3),measuredOutcomes:out.measuredOutcomes.slice(0,2),jevLessons:out.jevLessons.slice(0,2),
      memoryTrimmed:true,note:out.note
    };
  }
  return out;
}
function liveReasoningContext(root,learning){
  const cortex=traderCortexReference(root);
  return {
    professionalTraderCortex:cortex.loaded?{version:cortex.version,mode:cortex.mode,reference:cortex.text}:null,
    experienceMemory:compactExperienceMemory(learning)
  };
}
function utcDay(now=Date.now()){return new Date(now).toISOString().slice(0,10);}
function normalizeConfig(root){
  const raw=readJson(path.join(root,'config','jev.json'));
  const model=String(raw.model||DEFAULTS.model).trim();
  const decisionsUrl=String(raw.decisionsUrl||DEFAULTS.decisionsUrl).trim();
  const keyUrl=String(raw.keyUrl||DEFAULTS.keyUrl).trim();
  const creditsUrl=String(raw.creditsUrl||DEFAULTS.creditsUrl).trim();
  const billingCacheMs=Math.max(30000,Math.min(1800000,Number(raw.billingCacheMs||DEFAULTS.billingCacheMs)));
  const timeoutMs=Math.max(5000,Math.min(120000,Number(raw.timeoutMs||DEFAULTS.timeoutMs)));
  const dailyCapUsd=Math.max(0.01,Math.min(100,Number(raw.dailyCapUsd||DEFAULTS.dailyCapUsd)));
  const softBudgetUsd=Math.max(0,Math.min(dailyCapUsd,Number(raw.softBudgetUsd??DEFAULTS.softBudgetUsd)));
  const maxPayloadChars=Math.max(4000,Math.min(64000,Number(raw.maxPayloadChars||DEFAULTS.maxPayloadChars)));
  const reservePerCallUsd=Math.max(0.001,Math.min(0.05,Number(raw.reservePerCallUsd||DEFAULTS.reservePerCallUsd)));
  return {enabled:raw.enabled===true,model,decisionsUrl,keyUrl,creditsUrl,billingCacheMs,mode:'SOVEREIGN_DIRECTOR_5M15M',softBudgetUsd,dailyCapUsd,timeoutMs,maxPayloadChars,reservePerCallUsd};
}
function sanitizedKeyMetadata(data){
  const d=data&&typeof data==='object'?data:{};
  const src=d.data&&typeof d.data==='object'?d.data:d;
  const keep=['label','limit','limit_remaining','usage','usage_daily','usage_weekly','usage_monthly','is_free_tier','rate_limit'];
  const out={};
  for(const k of keep)if(Object.prototype.hasOwnProperty.call(src,k))out[k]=src[k];
  return out;
}
async function fetchJson(fetchImpl,url,options,timeoutMs){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchImpl(url,{...options,signal:controller.signal});
    const raw=await r.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{data={raw:raw.slice(0,500)};}
    return {ok:r.ok,status:r.status,data};
  }finally{clearTimeout(timer);}
}
function probabilityValue(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='string'&&!value.trim())return null;
  if(typeof value==='boolean')return null;
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=1?n:null;
}
function noulProbability(answer){
  const direct=probabilityValue(answer);
  if(direct!==null)return direct;
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return null;
  for(const k of ['noul','probability','yes','true']){
    const n=probabilityValue(answer[k]);
    if(n!==null)return n;
  }
  return null;
}
// CLAUDE_V113_JEV_FULL_EVIDENCE: kanıt tam ama tekrarsız (48k sınırı aşılırsa Jev veto sayılır).
function compactSwing(s){
  if(!s||typeof s!=='object')return null;
  return {state:s.state||null,highSequence:s.highSequence||null,lowSequence:s.lowSequence||null,event:s.event||null,
    lastSwingHigh:s.lastConfirmedSwingHigh?.price??null,lastSwingLow:s.lastConfirmedSwingLow?.price??null};
}
function compactOrderBlocks(ob){
  if(!ob||typeof ob!=='object')return null;
  const pick=list=>{const a=(Array.isArray(list)?list:[]);const x=a.find(o=>o&&o.broken!==true)||null;
    return x?{low:x.low??null,high:x.high??null,mitigated:x.mitigated===true,distancePct:x.distancePct??null}:null;};
  return {bullish:pick(ob.bullish),bearish:pick(ob.bearish)};
}
function compactSmc(m){
  if(!m||typeof m!=='object')return null;
  // Tekrar/boilerplate atılır (FVG zaten liquidity.fairValueGaps'te; not/semantics her TF'de aynı); diğer alanlar korunur.
  const {fairValueGaps,note,semantics,source,oteReference,fibLevels,...rest}=m;
  const fib=fibLevels||null;
  if(fib)rest.fib={leg:fib.leg||null,r382:fib.retracement?.['0.382']??null,r5:fib.retracement?.['0.5']??null,r618:fib.retracement?.['0.618']??null,
    r786:fib.retracement?.['0.786']??null,x1272:fib.extension?.['1.272']??null,x1618:fib.extension?.['1.618']??null,pricePositionPct:fib.pricePositionPct??null};
  return rest;
}
function compactDecisionRecord({candidate,plan,unified},maxChars){
  const frames={};
  for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d']){
    const d=plan?.timeframeDiagnostics?.[tf]||{};
    const f=unified?.frames?.[tf]||{};
    frames[tf]={
      available:f.available===true, asOf:f.asOf||null, summary:String(d.summary||'').slice(0,240),
      // CLAUDE_V113_JEV_FULL_EVIDENCE: fiyat/ortalama/momentum, swing yapısı (HH/HL, BOS/CHoCH), Fibonacci,
      // FVG, order block, likidite (eşit tepe/dip, sweep) — hepsi kapanmış mumdan deterministik.
      close:f.close??null, ema20:f.ema20??null, ema50:f.ema50??null, rsi14:f.rsi14??null, atrPct:f.atrPct??null,
      returnPct:f.returnPct??null, prior20High:f.prior20High??null, prior20Low:f.prior20Low??null,
      swing:compactSwing(f.swingStructure), orderBlocks:compactOrderBlocks(f.orderBlocks),
      candle:f.candle||null, patterns:Array.isArray(f.patterns)?f.patterns.slice(-4):[], smcContext:compactSmc(f.smcContext), liquidity:f.liquidity||null,
      role:d.role||null,
      why:String(d.why||'').slice(0,240),
      waitFor:String(d.waitFor||'').slice(0,180),
      formingContext:String(d.formingContext||'').slice(0,180),
      risk:String(d.risk||'').slice(0,180),
      fresh:f.fresh??null,
      trend:f.trend??null,
      breakOfStructure:f.breakOfStructure??null,
      opportunity:f.opportunity?{
        state:f.opportunity.state??null,
        preferredSide:f.opportunity.preferredSide??null,
        originEligible:f.opportunity.originEligible??null,
        ownerEligible:f.opportunity.ownerEligible??null
      }:null,
      breakoutExecution:f.breakoutExecution?{
        status:f.breakoutExecution.status??null,
        allowed:f.breakoutExecution.allowed??null
      }:null
    };
  }
  const record={
    symbol:String(candidate?.symbol||unified?.symbol||'').slice(0,32),
    candidateSide:String(candidate?.side||'').toUpperCase()||null,
    contextSymbol:unified?.symbol||null, generatedAt:unified?.generatedAt||null,
    global:unified?.global||null, liquidationContext:unified?.liquidationContext||null,
    derivatives:unified?.derivatives||null,
    marketMakerEvidence:unified?.marketMakerEvidence||null,
    authority:unified?.authority||{finalStrategicAuthority:'JEV'},
    visualPolicy:unified?.visualPolicy||null,
    plan:{
      status:plan?.status||null,
      side:plan?.side||null,
      confidence:plan?.confidence??null,
      originTF:plan?.originTF||null,
      ownerTF:plan?.ownerTF||null,
      setup:String(plan?.setup||'').slice(0,180),
      execPath:String(plan?.execPath||'').slice(0,180),
      why:String(plan?.why||'').slice(0,500),
      riskNote:String(plan?.riskNote||'').slice(0,360),
      waitFor:String(plan?.waitFor||'').slice(0,360),
      formingContext:String(plan?.formingContext||'').slice(0,360),
      supportTFs:Array.isArray(plan?.supportTFs)?plan.supportTFs:[],
      vetoTFs:Array.isArray(plan?.vetoTFs)?plan.vetoTFs:[],
      blockingVetoTFs:Array.isArray(plan?.blockingVetoTFs)?plan.blockingVetoTFs:[],
      contextualVetoTFs:Array.isArray(plan?.contextualVetoTFs)?plan.contextualVetoTFs:[],
      requiresJevTfReview:plan?.requiresJevTfReview===true,
      visionSummary:String(plan?.visionSummary||'').slice(0,600),
      // CLAUDE_V113: hızlı hat giriş metrikleri (uzama, stop/risk geometrisi, kovalama) — Jev'in geç giriş ve
      // risk geometrisi sorularına kanıt.
      fastLane:plan?.claudeFastLane?{
        triggerTF:plan.claudeFastLane.tf||plan.triggerTF||null,
        livePrice:plan.claudeFastLane.livePrice??null,
        triggerLevel:plan.claudeFastLane.level??null,
        invalidation:plan.claudeFastLane.invalidation??null,
        momentumTags:Array.isArray(plan.claudeFastLane.momentum?.tags)?plan.claudeFastLane.momentum.tags.slice(0,8):[],
        chase:plan.claudeFastLane.chase||null,
        extension:plan.claudeFastLane.extension||null,
        riskGeometry:plan.claudeFastLane.riskGeometry||null
      }:null
    },
    // CLAUDE_V113: aynı coinde son tam 9TF görsel analiz (grafik okuması) — hızlı hatta da Jev görür.
    lastVisionAnalysis:unified?.lastVisionAnalysis||null,
    frames,
    dataQuality:unified?.dataQuality||null,
    opportunityPaths:unified?.opportunityPaths||null,
    learning:unified?.learning||null,
    microstructure:unified?.microstructure?.available?{
      available:true,
      sourceQuality:unified.microstructure.sourceQuality||null,
      spreadBps:unified.microstructure.spreadBps??null,
      depth20Imbalance:unified.microstructure.depth20Imbalance??null,
      cvdSampleQuote:unified.microstructure.cvdSampleQuote??null, cvdSource:unified.microstructure.cvdSource||null,
      ofiProxyQuote:unified.microstructure.ofiProxyQuote??null, trueOfiClaimed:false,
      streaming:unified.microstructure.streaming?{
        available:Boolean(unified.microstructure.streaming.available),
        connected:Boolean(unified.microstructure.streaming.connected),
        ageMs:unified.microstructure.streaming.ageMs??null
      }:null
    }:{available:false},
    policy:unified?.policy||null,
    execution:'ADVISORY_ONLY'
  };
  // CLAUDE_V113: sınır aşılırsa veto yerine kademeli küçült (önce en az kritik kanıt).
  const steps=[
    r=>{if(r.lastVisionAnalysis)r.lastVisionAnalysis={...r.lastVisionAnalysis,frames:undefined};},
    r=>{if(r.learning&&typeof r.learning==='object')r.learning={...r.learning,recent:Array.isArray(r.learning.recent)?r.learning.recent.slice(0,5):r.learning.recent};},
    r=>{for(const f of Object.values(r.frames||{})){for(const k of ['summary','why','waitFor','formingContext','risk'])if(typeof f[k]==='string')f[k]=f[k].slice(0,90);}},
    r=>{delete r.lastVisionAnalysis;},
    r=>{for(const f of Object.values(r.frames||{}))f.patterns=Array.isArray(f.patterns)?f.patterns.slice(-1):[];},
    r=>{if(r.learning&&typeof r.learning==='object')r.learning={source:r.learning.source,stats:Array.isArray(r.learning.stats)?r.learning.stats.slice(0,8):[]};}
  ];
  let raw=JSON.stringify(record);
  for(const step of steps){
    if(raw.length<=maxChars)break;
    step(record);
    record.evidenceTrimmed=true;
    raw=JSON.stringify(record);
  }
  if(raw.length>maxChars)throw new Error('JEV_EVIDENCE_PAYLOAD_TOO_LARGE');
  return raw;
}
function usageCost(data,reserve,body){
  const u=data?.usage&&typeof data.usage==='object'?data.usage:null;
  const direct=u?.cost==null?NaN:Number(u.cost);
  if(Number.isFinite(direct)&&direct>=0)return direct;
  const tokens=Number(u?.prompt_tokens??u?.input_tokens);
  if(Number.isFinite(tokens)&&tokens>=0)return tokens*0.042/1_000_000;
  const chars=JSON.stringify(body||{}).length;
  const conservativeTokens=Math.max(1,Math.ceil(chars/3));
  return Math.min(reserve,conservativeTokens*0.042/1_000_000*1.5);
}

function createJevClient({root,apiKey='',managementKey='',fetchImpl=globalThis.fetch,clock=()=>Date.now()}={}){
  if(!root)throw new Error('root required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation required');
  const cfg=normalizeConfig(root);
  const key=String(apiKey||'').trim();
  const management=String(managementKey||'').trim();
  const configured=cfg.enabled&&key.startsWith('sk-or-v1-');
  const managementConfigured=management.length>=20&&!/\s/.test(management);
  const usageFile=path.join(root,'data','jev-usage.json');
  let billingCache={at:0,value:null};

  function readUsage(){
    const day=utcDay(clock());
    let raw={};
    if(fs.existsSync(usageFile)){
      try{raw=JSON.parse(fs.readFileSync(usageFile,'utf8'));}
      catch{throw new Error('JEV_BUDGET_FILE_INVALID');}
      if(!raw.day||!Number.isFinite(raw.spentUsd)||raw.spentUsd<0)throw new Error('JEV_BUDGET_FILE_INVALID');
    }
    if(raw.day!==day)return {day,spentUsd:0,calls:0,lastAt:null};
    return {day,spentUsd:Math.max(0,Number(raw.spentUsd)||0),calls:Math.max(0,Number(raw.calls)||0),lastAt:raw.lastAt||null};
  }
  function writeUsage(u){writeJsonAtomic(usageFile,u);}
  function budgetStatus(){
    const u=readUsage();
    const remainingUsd=Math.max(0,cfg.dailyCapUsd-u.spentUsd);
    return {
      ...u,
      softBudgetUsd:cfg.softBudgetUsd,
      dailyCapUsd:cfg.dailyCapUsd,
      remainingUsd,
      reservePerCallUsd:cfg.reservePerCallUsd,
      softLimitReached:cfg.softBudgetUsd>0&&u.spentUsd>=cfg.softBudgetUsd,
      hardLimitReached:remainingUsd<=0
    };
  }
  function reserveBudget(){
    const u=readUsage();
    if(u.spentUsd+cfg.reservePerCallUsd>cfg.dailyCapUsd+1e-12)return {ok:false,usage:u};
    const reserved={...u,spentUsd:u.spentUsd+cfg.reservePerCallUsd,calls:u.calls+1,lastAt:new Date(clock()).toISOString()};
    writeUsage(reserved);
    return {ok:true,usage:reserved,reservedUsd:cfg.reservePerCallUsd};
  }
  function settleBudget(reservation,actualUsd){
    if(!reservation?.ok)return readUsage();
    const u=readUsage();
    if(u.day!==reservation.usage.day)return u;
    const actual=Math.max(0,Number(actualUsd)||0);
    const settled={...u,spentUsd:Math.max(0,u.spentUsd-reservation.reservedUsd+actual),lastAt:new Date(clock()).toISOString()};
    writeUsage(settled);
    return settled;
  }
  function localStatus(){
    return {
      ok:true,configured,enabled:cfg.enabled,keyLoaded:!!key,model:cfg.model,mode:cfg.mode,
      softBudgetUsd:cfg.softBudgetUsd,dailyCapUsd:cfg.dailyCapUsd,decisionsApi:'OPENROUTER_ALPHA_DECISIONS',
      managementConfigured,
      authority:{decisionOwner:'JEV',scanner:'ATTENTION_ONLY',workers:'EVIDENCE_ONLY',legacyJudge:'COMPATIBILITY_ONLY'},
      lanes:{scalp:'5m',trade:'15m',longShortSymmetric:true},
      passLimit:2,
      traderCortex:(()=>{const t=traderCortexReference(root);return {loaded:t.loaded,version:t.version,mode:t.mode};})(),
      paidFallbackEnabled:false,budget:budgetStatus()
    };
  }
  function billingSnapshot(){
    return billingCache.value||{
      ok:false,
      checkedAt:null,
      key:{available:false,reason:'BILLING_CACHE_NOT_READY'},
      accountCredits:{available:false,managementConfigured,reason:managementConfigured?'BILLING_CACHE_NOT_READY':'OPENROUTER_MANAGEMENT_KEY_NOT_CONFIGURED'}
    };
  }
  async function billingStatus({force=false}={}){
    const now=clock();
    if(!force&&billingCache.value&&now-billingCache.at<cfg.billingCacheMs)return billingCache.value;
    const out={
      ok:true,
      checkedAt:new Date(now).toISOString(),
      key:{available:false,reason:configured?null:'OPENROUTER_NOT_CONFIGURED'},
      accountCredits:{available:false,managementConfigured,reason:managementConfigured?null:'OPENROUTER_MANAGEMENT_KEY_NOT_CONFIGURED'}
    };
    if(configured){
      try{
        const r=await fetchJson(fetchImpl,cfg.keyUrl,{method:'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json'}},Math.min(cfg.timeoutMs,10000));
        if(r.ok)out.key={available:true,...sanitizedKeyMetadata(r.data)};
        else out.key={available:false,reason:'OPENROUTER_KEY_CHECK_FAILED',httpStatus:r.status};
      }catch(e){out.key={available:false,reason:'OPENROUTER_KEY_CHECK_ERROR',detail:String(e?.message||e).slice(0,180)};}
    }
    if(managementConfigured){
      try{
        const r=await fetchJson(fetchImpl,cfg.creditsUrl,{method:'GET',headers:{authorization:'Bearer '+management,'content-type':'application/json'}},Math.min(cfg.timeoutMs,10000));
        const d=r.data?.data&&typeof r.data.data==='object'?r.data.data:r.data;
        const totalCredits=Number(d?.total_credits), totalUsage=Number(d?.total_usage);
        if(r.ok&&Number.isFinite(totalCredits)&&Number.isFinite(totalUsage)){
          out.accountCredits={available:true,managementConfigured:true,totalCredits,totalUsage,remainingCredits:Math.max(0,totalCredits-totalUsage)};
        }else out.accountCredits={available:false,managementConfigured:true,reason:'OPENROUTER_CREDITS_CHECK_FAILED',httpStatus:r.status};
      }catch(e){out.accountCredits={available:false,managementConfigured:true,reason:'OPENROUTER_CREDITS_CHECK_ERROR',detail:String(e?.message||e).slice(0,180)};}
    }
    out.ok=Boolean(out.key.available||out.accountCredits.available);
    billingCache={at:now,value:out};
    return out;
  }

  async function remoteStatus(){
    if(!configured)return {...localStatus(),reachable:false,reason:'OPENROUTER_NOT_CONFIGURED'};
    try{
      const r=await fetchJson(fetchImpl,cfg.keyUrl,{method:'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json'}},cfg.timeoutMs);
      if(!r.ok)return {...localStatus(),reachable:false,httpStatus:r.status,reason:'OPENROUTER_KEY_CHECK_FAILED'};
      return {...localStatus(),reachable:true,keyMetadata:sanitizedKeyMetadata(r.data)};
    }catch(e){
      return {...localStatus(),reachable:false,reason:'OPENROUTER_KEY_CHECK_ERROR',detail:String(e?.message||e).slice(0,240)};
    }
  }
  async function decisions(body,{reserve=true}={}){
    if(!configured)return {ok:false,configured:false,required:false,reason:'OPENROUTER_NOT_CONFIGURED'};
    const reservation=reserve?reserveBudget():{ok:true,reservedUsd:0};
    if(!reservation.ok)return {ok:false,configured:true,required:true,reason:'JEV_DAILY_BUDGET_EXHAUSTED',budget:budgetStatus()};
    const started=clock();
    try{
      const r=await fetchJson(fetchImpl,cfg.decisionsUrl,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)},cfg.timeoutMs);
      if(!r.ok){
        if(reserve)settleBudget(reservation,cfg.reservePerCallUsd);
        return {ok:false,configured:true,required:true,reason:'JEV_HTTP_ERROR',httpStatus:r.status,durationMs:clock()-started,detail:JSON.stringify(r.data).slice(0,500),budget:budgetStatus()};
      }
      const cost=reserve?usageCost(r.data,cfg.reservePerCallUsd,body):0;
      if(reserve)settleBudget(reservation,cost);
      return {ok:true,configured:true,required:true,data:r.data,durationMs:clock()-started,costUsd:cost,budget:budgetStatus()};
    }catch(e){
      if(reserve)settleBudget(reservation,cfg.reservePerCallUsd);
      return {ok:false,configured:true,required:true,reason:'JEV_REQUEST_ERROR',durationMs:clock()-started,detail:String(e?.message||e).slice(0,300),budget:budgetStatus()};
    }
  }

  async function sovereignPass1({candidate,unified}={}){
    if(!configured)return {ok:false,configured:false,required:cfg.enabled,called:false,pass:1,reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    const record=sovereignAttentionRecord(candidate,unified);
    const liveContext=liveReasoningContext(root,unified?.learning);
    const questions={
      lane_focus:{
        type:'choice',
        instructions:'Which lane deserves first attention for this symbol? Choose by the supplied market state, not by a fixed rule. This is only an evidence-routing decision, not a trade approval.',
        criteria:{
          '5M_SCALP':'The immediate opportunity is primarily a 5-minute scalp question.',
          '15M_TRADE':'The immediate opportunity is primarily a 15-minute trade question.',
          'BOTH':'Both 5m scalp and 15m trade hypotheses deserve evidence.',
          'UNDECIDED':'The base state is insufficient to prefer a lane before evidence.'
        }
      },
      direction_focus:{
        type:'choice',
        instructions:'Which directional hypothesis deserves evidence first? Scanner side is only an attention hint and must not bind this choice.',
        criteria:{
          'LONG':'LONG deserves first evidence attention.',
          'SHORT':'SHORT deserves first evidence attention.',
          'BOTH':'LONG and SHORT both remain live hypotheses.',
          'UNDECIDED':'Do not privilege either direction yet.'
        }
      }
    };
    for(const [id,description] of SOVEREIGN_EVIDENCE){
      questions['evidence_'+id.toLowerCase()]={
        type:'choice',
        instructions:'Decide whether this evidence should be requested for the current decision. '+description+' Do not request it merely because a checklist exists; request it only if it can materially improve the decision.',
        criteria:{
          REQUEST:'Request this evidence now.',
          SKIP:'Do not spend time or payload on this evidence for this decision.'
        }
      };
    }
    const body={
      model:cfg.model,
      state:{
        description:'JEV PASS-1 is the sole strategic evidence director. The professional trader/scalper Cortex and compact measured experience memory are ALWAYS ON and must be used as read-only reasoning context; JEV never needs to request HISTORY_OUTCOME merely to remember its own measured past. Radar only raises attention. Decide which evidence workers should fetch. There are two trading lanes: 5m LONG/SHORT scalp and 15m LONG/SHORT trade. Do not require every indicator, timeframe or condition to align. No score threshold, 2-of-3 confirmation rule or hard 15m strategic veto applies. If a material concept is not understood from the supplied Cortex/evidence, do not invent it; prefer WAIT until verified knowledge is available.',
        professionalTraderCortex:liveContext.professionalTraderCortex,
        experienceMemory:liveContext.experienceMemory,
        record
      },
      questions
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,pass:1,mode:'SOVEREIGN_CHOICE'};
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const laneFocus=choiceValue(answers.lane_focus);
    const directionFocus=choiceValue(answers.direction_focus);
    const requestedEvidence=[];
    for(const [id] of SOVEREIGN_EVIDENCE){
      const v=choiceValue(answers['evidence_'+id.toLowerCase()]);
      if(v==='REQUEST')requestedEvidence.push(id);
    }
    if(!laneFocus||!directionFocus)return {ok:false,configured:true,required:true,called:true,pass:1,reason:'JEV_SOVEREIGN_PASS1_SCHEMA_MISMATCH',mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    return {
      ok:true,configured:true,required:true,called:true,pass:1,finalAuthority:'JEV',
      laneFocus,directionFocus,requestedEvidence,
      model:cfg.model,mode:'SOVEREIGN_CHOICE',durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget
    };
  }

  async function sovereignFinal({candidate,unified,evidence,planOptions}={}){
    if(!configured)return {ok:false,configured:false,required:cfg.enabled,called:false,pass:2,reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    const plans=Array.isArray(planOptions)?planOptions.filter(x=>x&&typeof x==='object'&&/^[A-Z0-9_]{3,64}$/.test(String(x.id||''))).slice(0,12):[];
    const criteria={
      WAIT:'No supplied executable plan is worth taking now. WAIT is a valid strategic decision and should be chosen when the opportunity is not real enough right now.'
    };
    for(const p of plans){
      criteria[p.id]=[
        p.side,p.lane,'entry='+p.entryPrice,'stop='+p.stopPrice,
        'tp1='+p.takeProfit1,'tp2='+p.takeProfit2,'tp3='+p.takeProfit3,
        'invalidation='+p.invalidationPrice,
        'invalidationSource='+String(p.invalidationSource||'UNKNOWN'),
        'frame='+p.originTF,
        'basis='+String(p.basis||'STRUCTURE')
      ].join(' | ');
    }
    const liveContext=liveReasoningContext(root,unified?.learning);
    const boundedEvidence=compactSovereignEvidence(evidence,Math.min(18000,Math.max(6000,cfg.maxPayloadChars-25000)));
    const body={
      model:cfg.model,
      state:{
        description:'JEV PASS-2 is the final strategic decision. The professional trader/scalper Cortex and compact measured experience memory are ALWAYS ON read-only context. Choose one concrete executable LONG/SHORT plan or WAIT. You own the importance ordering of all supplied evidence. Conflicting evidence is normal: do not wait for every signal to agree. There is no mandatory evidence checklist; missing optional evidence is not a negative score. Scanner and workers have no qualification or veto authority. 5m is the scalp lane; 15m is the trade lane. Numeric Binance/BrainHub truth outranks visual interpretation. Use measured winners/losses and JEV lessons as soft experience, never as an automatic veto. If required knowledge is genuinely missing or unfamiliar, do not fabricate an interpretation; choose WAIT.',
        professionalTraderCortex:liveContext.professionalTraderCortex,
        experienceMemory:liveContext.experienceMemory,
        record:{
          attention:sovereignAttentionRecord(candidate,unified),
          requestedEvidence:boundedEvidence,
          executablePlanOptions:plans
        }
      },
      questions:{
        trade_plan:{
          type:'choice',
          instructions:'Choose the single best action now. Select one supplied executable plan only when its direction, lane, timing and risk geometry are justified by the evidence; otherwise choose WAIT. There is no numeric score threshold and no requirement that all evidence agree.',
          criteria
        },
        management_style:{
          type:'choice',
          instructions:'If a trade plan is selected, choose how JEV wants the position managed after entry. If WAIT is selected this answer is recorded but not executed.',
          criteria:{
            'TP1_BE_TRAIL':'Take a first partial at TP1, protect around breakeven when appropriate, then trail the runner as structure evolves.',
            'STRUCTURE_TRAIL':'Manage primarily by evolving 5m/15m structure; keep the runner until the thesis is structurally broken.',
            'PARTIALS_RUNNER':'Use staged partial profits while preserving a runner until thesis failure.',
            'HOLD_TO_INVALIDATION':'Avoid premature exits; hold unless the JEV thesis/invalidation breaks or a later JEV review changes the plan.'
          }
        },
        target_profile:{
          type:'choice',
          instructions:'Choose the reward geometry that best fits this specific opportunity. This is a JEV strategic choice, not a fixed score or timeframe rule.',
          criteria:{
            'FAST_SCALP':'Prioritize earlier profit realization: approximately 0.75R / 1.5R / 2.5R.',
            'BALANCED':'Balanced geometry: approximately 1R / 2R / 3R.',
            'RUNNER_EXTENDED':'Preserve more convexity: approximately 1R / 2R / 4R.',
            'DEFENSIVE':'Use closer targets when continuation room is limited: approximately 0.75R / 1.25R / 2R.'
          }
        },
        partial_profile:{
          type:'choice',
          instructions:'Choose how much of the position should remain for later targets/runner. JEV owns this strategic distribution.',
          criteria:{
            'THIRDS':'Roughly one third at each stage; final third is the runner portion.',
            'HALF_QUARTER_RUNNER':'Take about half early, one quarter later, keep one quarter as runner.',
            'RUNNER_HEAVY':'Take about one quarter at TP1, one quarter at TP2, keep about half for TP3/runner.'
          }
        },
        breakeven_rule:{
          type:'choice',
          instructions:'Choose when protective management may move toward breakeven. This does not permit widening risk.',
          criteria:{
            'AFTER_TP1':'Breakeven protection may be considered after TP1 is achieved.',
            'AFTER_1R_CLOSE':'Breakeven protection may be considered after a closed-candle move of about 1R.',
            'STRUCTURE_ONLY':'Do not force breakeven mechanically; protect only when structure/evidence supports it.'
          }
        },
        trail_rule:{
          type:'choice',
          instructions:'Choose the preferred runner trailing evidence. Later JEV position review remains authoritative.',
          criteria:{
            '5M_STRUCTURE':'Trail primarily from evolving closed 5m swing/structure evidence.',
            '15M_STRUCTURE':'Give the runner more room and trail primarily from closed 15m structure.',
            'JEV_DYNAMIC':'Let later JEV position reviews choose the appropriate structure/timeframe dynamically.'
          }
        }
      }
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,pass:2,mode:'SOVEREIGN_CHOICE'};
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const selectedId=choiceValue(answers.trade_plan);
    const managementStyle=choiceValue(answers.management_style);
    const targetProfile=choiceValue(answers.target_profile);
    const partialProfile=choiceValue(answers.partial_profile);
    const breakevenRule=choiceValue(answers.breakeven_rule);
    const trailRule=choiceValue(answers.trail_rule);
    const validTargetProfiles=new Set(['FAST_SCALP','BALANCED','RUNNER_EXTENDED','DEFENSIVE']);
    const validPartialProfiles=new Set(['THIRDS','HALF_QUARTER_RUNNER','RUNNER_HEAVY']);
    const validBreakevenRules=new Set(['AFTER_TP1','AFTER_1R_CLOSE','STRUCTURE_ONLY']);
    const validTrailRules=new Set(['5M_STRUCTURE','15M_STRUCTURE','JEV_DYNAMIC']);
    if(!selectedId||!Object.prototype.hasOwnProperty.call(criteria,selectedId)||!managementStyle||
       !validTargetProfiles.has(targetProfile)||!validPartialProfiles.has(partialProfile)||
       !validBreakevenRules.has(breakevenRule)||!validTrailRules.has(trailRule)){
      return {ok:false,configured:true,required:true,called:true,pass:2,reason:'JEV_SOVEREIGN_FINAL_SCHEMA_MISMATCH',mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    }
    const selectedPlan=selectedId==='WAIT'?null:plans.find(x=>x.id===selectedId)||null;
    if(selectedId!=='WAIT'&&!selectedPlan)return {ok:false,configured:true,required:true,called:true,pass:2,reason:'JEV_SOVEREIGN_PLAN_NOT_FOUND',mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    return {
      ok:true,configured:true,required:true,called:true,pass:2,finalAuthority:true,veto:false,
      action:selectedId==='WAIT'?'WAIT':selectedPlan.side,
      selectedPlanId:selectedId,selectedPlan,managementStyle,targetProfile,partialProfile,breakevenRule,trailRule,evidenceTrimmed:boundedEvidence.evidenceTrimmed===true,
      model:cfg.model,mode:'SOVEREIGN_CHOICE',durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget
    };
  }


  async function sovereignLesson({symbol,outcome}={}){
    if(!configured)return {ok:false,configured:false,required:false,called:false,reason:'JEV_KEY_UNAVAILABLE'};
    const src=outcome&&typeof outcome==='object'?outcome:{};
    const record={
      contract:'R2.5.3.2_JEV_SHADOW_TEACHER',
      authority:{teacher:'JEV',application:'SHADOW_ONLY',selfModify:false,autoPromotion:false},
      symbol:String(symbol||src.symbol||'').toUpperCase(),
      outcome:{
        side:String(src.side||'').toUpperCase()||null,
        lane:src.tradeLane||src.entryContext?.lane||null,
        setup:src.setup||null,
        originTF:src.originTF||null,
        ownerTF:src.ownerTF||null,
        entryPrice:finiteNumber(src.entryPrice),
        stopPrice:finiteNumber(src.stopPrice),
        takeProfit1:finiteNumber(src.takeProfit1),
        outcomePct:finiteNumber(src.outcomePct),
        rMultiple:finiteNumber(src.rMultiple),
        netPnl:finiteNumber(src.netPnl),
        exitType:src.exitType||null,
        holdMinutes:finiteNumber(src.holdMinutes),
        entryWhy:String(src.entryContext?.why||'').slice(0,400),
        managementStyle:src.entryContext?.managementStyle||src.managementStyle||null
      }
    };
    const cortex=traderCortexReference(root);
    const body={
      model:cfg.model,
      state:{
        description:'JEV is the BrainHub teacher for closed-trade learning. Use the professional trader/scalper knowledge reference when interpreting the measured outcome, but keep the result SHADOW-only. Do not create hard rules, scores, vetoes, automatic code changes, or auto-promotion. A single trade must not become a mandatory rule.',
        professionalTraderCortex:cortex.loaded?{version:cortex.version,mode:cortex.mode,reference:cortex.text}:null,
        record
      },
      questions:{
        lesson_focus:{
          type:'choice',
          instructions:'Which strategic area deserves the main lesson from this measured outcome?',
          criteria:{
            'KEEP_CURRENT':'No material strategy lesson; keep current reasoning and gather more outcomes.',
            'ENTRY_TIMING':'Entry timing/why-now deserves review.',
            'INVALIDATION_STOP':'Invalidation/stop placement deserves review.',
            'TARGET_MANAGEMENT':'Targets, partials, runner, breakeven or trailing deserves review.',
            'EVIDENCE_WEIGHTING':'The relative importance of structure/liquidity/order-flow/derivatives/visual evidence deserves review.',
            'LANE_SELECTION':'Choosing 5m scalp versus 15m trade deserves review.'
          }
        },
        evidence_focus:{
          type:'choice',
          instructions:'Which evidence family should receive the most attention in later SHADOW comparison for similar setups?',
          criteria:{
            'STRUCTURE':'Closed-candle market structure/BOS/CHoCH/swing context.',
            'LIQUIDITY':'Liquidity, sweep/reclaim, OB/FVG and location.',
            'ORDER_FLOW':'CVD/order-flow/depth footprints.',
            'DERIVATIVES':'OI/funding/taker/top-trader positioning.',
            'VISUAL':'Validated TradingView visual observations.',
            'EXECUTION_COST':'Spread, fees, slippage and execution geometry.',
            'COMBINATION':'No single family dominates; compare the combination.'
          }
        },
        lesson_action:{
          type:'choice',
          instructions:'How should the lesson influence future SHADOW reasoning? Never make it a hard gate.',
          criteria:{
            'KEEP_WEIGHT':'Keep current soft weighting until more measured outcomes exist.',
            'OBSERVE_MORE':'Collect more comparable outcomes before changing emphasis.',
            'UPWEIGHT_SOFT':'Softly pay more attention to the selected evidence/focus in similar cases.',
            'DOWNWEIGHT_SOFT':'Softly pay less attention to the selected evidence/focus in similar cases.'
          }
        },
        scope:{
          type:'choice',
          instructions:'Choose the narrowest scope justified by this single measured outcome.',
          criteria:{
            'THIS_SETUP_ONLY':'Apply only as a shadow lesson for the same setup/lane/direction pattern.',
            'THIS_LANE':'Apply as a shadow lesson to the same 5m or 15m lane.',
            'BOTH_LANES':'The lesson plausibly matters to both 5m and 15m, but remains shadow-only.'
          }
        }
      }
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,teacher:'JEV',mode:'SOVEREIGN_SHADOW_TEACHER'};
    const a=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const lessonFocus=choiceValue(a.lesson_focus);
    const evidenceFocus=choiceValue(a.evidence_focus);
    const lessonAction=choiceValue(a.lesson_action);
    const scope=choiceValue(a.scope);
    if(!lessonFocus||!evidenceFocus||!lessonAction||!scope){
      return {ok:false,configured:true,called:true,reason:'JEV_LESSON_SCHEMA_MISMATCH',teacher:'JEV',mode:'SOVEREIGN_SHADOW_TEACHER',budget:out.budget,costUsd:out.costUsd};
    }
    return {
      ok:true,configured:true,called:true,teacher:'JEV',application:'SHADOW_ONLY',
      selfModify:false,autoPromotion:false,lessonFocus,evidenceFocus,lessonAction,scope,
      model:cfg.model,mode:'SOVEREIGN_SHADOW_TEACHER',durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget
    };
  }


  async function sovereignExit({position,lifecycle,currentPlan,unified,evidence=null}={}){
    if(!configured)return {ok:false,configured:false,required:cfg.enabled,called:false,finalAuthority:false,action:'HOLD_REVIEW',reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    if(unified?.dataQuality?.advisoryUsable!==true)return {ok:false,configured:true,required:true,called:false,finalAuthority:false,action:'HOLD_REVIEW',reason:'JEV_EXIT_CONTEXT_NOT_USABLE'};
    const entry=finiteNumber(position?.entryPrice),mark=finiteNumber(position?.markPrice);
    const side=String(position?.side||lifecycle?.side||'').toUpperCase();
    const pnlPct=entry!==null&&entry>0&&mark!==null&&['LONG','SHORT'].includes(side)
      ? (side==='LONG'?(mark-entry)/entry:(entry-mark)/entry)*100:null;
    const liveContext=liveReasoningContext(root,unified?.learning);
    const record={
      contract:'R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT',
      authority:{decisionOwner:'JEV',workers:'EVIDENCE_ONLY',postJevStrategicRevote:false},
      position:{
        symbol:String(position?.symbol||unified?.symbol||'').toUpperCase(),side,
        entryPrice:entry,markPrice:mark,quantity:finiteNumber(position?.quantity),
        unrealizedPnl:finiteNumber(position?.unrealizedPnl),pnlPct
      },
      lifecycle:{
        originTF:lifecycle?.originTF||currentPlan?.originTF||null,
        ownerTF:lifecycle?.ownerTF||currentPlan?.ownerTF||null,
        setup:lifecycle?.setup||currentPlan?.setup||null,
        managementStyle:currentPlan?.managementStyle||null,
        initialInvalidation:finiteNumber(currentPlan?.invalidationPrice),
        initialStop:finiteNumber(currentPlan?.stopPrice),
        tp1:finiteNumber(currentPlan?.takeProfit1),tp2:finiteNumber(currentPlan?.takeProfit2),tp3:finiteNumber(currentPlan?.takeProfit3)
      },
      frames:{'5m':sovereignFrame(unified?.frames?.['5m']),'15m':sovereignFrame(unified?.frames?.['15m'])},
      orderFlow:unified?.marketMakerEvidence?.orderFlow||null,
      depth:unified?.marketMakerEvidence?.bookBehavior||null,
      derivatives:unified?.derivatives||null,
      observedLiquidations:unified?.liquidationContext||null,
      experienceMemory:liveContext.experienceMemory,
      requestedEvidence:evidence||null
    };
    const body={
      model:cfg.model,
      state:{
        description:'JEV is the sole strategic position manager. The professional trader/scalper Cortex and measured experience memory are ALWAYS ON read-only reasoning context. Choose HOLD, protect profit, take a partial, or exit now from the supplied evidence. Do not require fixed 1m/3m/5m/15m alignment and do not use a score threshold. Weight conflicting evidence by its actual importance. Code after this decision may enforce execution integrity and exchange safety only; it must not downgrade the strategic action. If a material concept is not understood, do not invent it.',
        professionalTraderCortex:liveContext.professionalTraderCortex,
        experienceMemory:liveContext.experienceMemory,
        record
      },
      questions:{
        position_action:{
          type:'choice',
          instructions:'Choose the best position-management action now. HOLD is valid when the thesis still deserves room. EXIT_NOW is valid whenever the supplied evidence makes the thesis/invalidation no longer worth holding; it does not require a fixed number of timeframe conflicts.',
          criteria:{
            HOLD:'Keep the position open; current evidence does not justify changing the strategy.',
            PROTECT_PROFIT:'Keep exposure but protect accumulated profit more aggressively, for example by tightening protective management.',
            PARTIAL_TAKE_PROFIT:'Reduce part of the position while keeping a runner because reward remains but some profit should be secured.',
            EXIT_NOW:'Close the position because the JEV thesis, invalidation, or current opportunity has materially failed or been replaced.'
          }
        }
      }
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,finalAuthority:false,action:'HOLD_REVIEW',mode:'SOVEREIGN_CHOICE'};
    const action=choiceValue(out.data?.answers?.position_action);
    if(!['HOLD','PROTECT_PROFIT','PARTIAL_TAKE_PROFIT','EXIT_NOW'].includes(action)){
      return {ok:false,configured:true,required:true,called:true,finalAuthority:false,action:'HOLD_REVIEW',reason:'JEV_SOVEREIGN_EXIT_SCHEMA_MISMATCH',mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    }
    const actionTr={HOLD:'TUT',PROTECT_PROFIT:'KÂRI KORU',PARTIAL_TAKE_PROFIT:'KISMİ KÂR AL',EXIT_NOW:'ÇIK'}[action];
    return {
      ok:true,configured:true,required:true,called:true,finalAuthority:true,action,actionTr,
      summaryTr:'JEV FINAL position action: '+actionTr+'.',model:cfg.model,mode:'SOVEREIGN_CHOICE',
      durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget
    };
  }

  async function judgeExit({position,lifecycle,currentPlan,unified}={}){
    if(!configured)return {ok:!cfg.enabled,configured:false,required:cfg.enabled,called:false,action:'HOLD_REVIEW',reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    const entry=Number(position?.entryPrice),mark=Number(position?.markPrice);
    const side=String(position?.side||lifecycle?.side||'').toUpperCase();
    const pnlPct=Number.isFinite(entry)&&entry>0&&Number.isFinite(mark)&&['LONG','SHORT'].includes(side)
      ? (side==='LONG'?(mark-entry)/entry:(entry-mark)/entry)*100 : null;
    let baseRecord;
    try{baseRecord=JSON.parse(compactDecisionRecord({candidate:{symbol:position?.symbol,side},plan:currentPlan||{},unified},cfg.maxPayloadChars));}
    catch(e){return {ok:false,configured:true,required:true,called:false,action:'HOLD_REVIEW',reason:e.message,budget:budgetStatus()};}
    const record=JSON.stringify({
      kind:'ACTIVE_POSITION_EXIT_REVIEW',
      position:{symbol:position?.symbol||null,side,entryPrice:Number.isFinite(entry)?entry:null,markPrice:Number.isFinite(mark)?mark:null,unrealizedPnl:Number(position?.unrealizedPnl)||0,pnlPct,quantity:Number(position?.quantity)||null},
      lifecycle:{originTF:lifecycle?.originTF||null,ownerTF:lifecycle?.ownerTF||null,setup:lifecycle?.setup||null},
      noisePolicy:{lowTf:['1m','3m','5m'],anchorTf:['15m','30m','1h','4h','1d'],rule:'1m/3m/5m tek başına EXIT_NOW gerekçesi değildir; owner ve büyük resim doğrulaması gerekir.'},
      evidence:baseRecord
    });
    if(record.length>cfg.maxPayloadChars)return {ok:false,configured:true,required:true,called:false,action:'HOLD_REVIEW',reason:'JEV_EXIT_EVIDENCE_PAYLOAD_TOO_LARGE',budget:budgetStatus()};
    const body={model:cfg.model,state:{description:'BrainHub açık futures pozisyonu için yalnız risk/çıkış değerlendirmesi. Emir verme. Düşük TF gürültüsünü owner ve büyük resimden daha ağır sayma.',record},questions:exitDecisionQuestions()};
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,action:'HOLD_REVIEW',mode:cfg.mode};
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const p=Object.fromEntries(EXIT_CHECKS.map(([id,key])=>[key,noulProbability(answers[id])]));
    const missing=Object.entries(p).filter(([,v])=>v===null).map(([k])=>k);
    if(missing.length)return {ok:false,configured:true,required:true,called:true,action:'HOLD_REVIEW',reason:'JEV_EXIT_SCHEMA_MISMATCH',missing,probabilities:p,budget:out.budget,costUsd:out.costUsd};
    let action='HOLD';
    if(p.exitDataQualityInsufficient>=0.65)action='HOLD_REVIEW';
    else if(p.lowTfNoiseOnly>=0.70&&p.ownerStructureFailure<0.65&&p.anchorStructureFailure<0.65)action='HOLD';
    else if(p.ownerStructureFailure>=0.72&&p.anchorStructureFailure>=0.65)action='EXIT_NOW';
    else if(pnlPct!==null&&pnlPct>0&&p.profitAtRisk>=0.70&&(p.ownerStructureFailure>=0.55||p.anchorStructureFailure>=0.55||p.liquidityReversal>=0.70))action='PARTIAL_TAKE_PROFIT';
    else if(pnlPct!==null&&pnlPct>0&&(p.momentumDecay>=0.70||p.profitAtRisk>=0.60))action='PROTECT_PROFIT';
    const actionTr={HOLD:'TUT',HOLD_REVIEW:'TUT • VERİYİ YENİDEN KONTROL ET',PROTECT_PROFIT:'KÂRI KORU',PARTIAL_TAKE_PROFIT:'KISMİ KÂR AL',EXIT_NOW:'ÇIKIŞI DEĞERLENDİR'}[action];
    const summaryTr=actionTr+' • owner/büyük resim öncelikli Jev pozisyon değerlendirmesi.';
    return {ok:true,configured:true,required:true,called:true,action,actionTr,summaryTr,probabilities:p,model:cfg.model,mode:cfg.mode,durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget};
  }

  async function probe(){
    const body={
      model:cfg.model,
      state:{description:'Synthetic BrainHub connectivity probe. This is not market data and must not authorize an order.',record:{kind:'BRAINHUB_JEV_PROBE',synthetic:true,execution:'ADVISORY_ONLY'}},
      questions:{synthetic_probe:{type:'noul',instructions:'Is this record explicitly marked as a synthetic BrainHub connectivity probe?',criteria:{true:'The record explicitly says it is a synthetic BrainHub connectivity probe.',false:'The record is not explicitly marked as a synthetic BrainHub connectivity probe.'}}}
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...localStatus(),...out};
    const answer=out.data?.answers?.synthetic_probe;
    if(!answer)return {...localStatus(),ok:false,configured:true,required:true,reason:'JEV_PROBE_SCHEMA_MISMATCH',durationMs:out.durationMs,budget:out.budget};
    return {...localStatus(),ok:true,reachable:true,probe:'PASS',durationMs:out.durationMs,answerShape:Object.keys(answer||{}).slice(0,12),usage:{cost:out.costUsd},budget:out.budget};
  }
  async function judge({candidate,plan,unified,shadow=false}={}){
    if(!configured)return {ok:!cfg.enabled,configured:false,required:cfg.enabled,called:false,veto:cfg.enabled,reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    const planStatus=String(plan?.status||'').toUpperCase();
    const shadowWatch=shadow===true&&planStatus==='WATCH';
    if(planStatus!=='QUALIFIED'&&!shadowWatch)return {ok:true,configured:true,required:true,called:false,veto:false,shadow:false,reason:'JEV_NOT_NEEDED_FOR_NON_QUALIFIED',budget:budgetStatus()};
    let record;
    try{record=compactDecisionRecord({candidate,plan,unified},cfg.maxPayloadChars);}
    catch(e){return {ok:false,configured:true,required:true,called:false,veto:true,reason:e.message,budget:budgetStatus()};}
    const body={
      model:cfg.model,
      state:{
        description:shadowWatch
          ? 'Shadow calibration only. Read the complete multi-timeframe, TradingView/visual metadata, Binance numeric, order-flow, derivatives and liquidation evidence like a professional futures trader/scalper. Workers and scanner are evidence/attention only. Never infer a market-maker identity from public data, and never let visual evidence override Binance/BrainHub numeric truth. Do not change live state or place an order.'
          : 'JEV is the final strategic authority for this BrainHub decision. Evaluate the complete multi-timeframe, TradingView/visual metadata, Binance numeric truth, structure, OB/FVG/liquidity, order-flow, absorption/replenishment/liquidity-pull heuristics, OI/funding/taker/top-trader context and observed liquidations as a professional futures trader/scalper. Scanner and workers are evidence/attention only. Treat market-maker/iceberg/spoof/TWAP labels as probabilistic footprints, never identity. Numeric Binance/BrainHub truth outranks visual interpretation. This call is advisory to execution while JEV remains the final strategic authority; it may accept/hold/veto strategy but must not itself mutate the user capital envelope or bypass deterministic execution safety.',
        record
      },
      questions:decisionQuestions()
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,veto:true,mode:cfg.mode};
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const probabilities=Object.fromEntries(CHECKS.map(([id,key])=>[key,noulProbability(answers[id])]));
    const timeframeConflicts=Object.fromEntries(FRAMES.map(tf=>[tf,noulProbability(answers['conflict_'+tf])]));
    const missing=Object.entries({...probabilities,...timeframeConflicts}).filter(([,v])=>v===null).map(([k])=>k);
    if(missing.length)return {ok:false,configured:true,required:true,called:true,veto:true,reason:'JEV_DECISION_SCHEMA_MISMATCH',missing,probabilities,timeframeConflicts,budget:out.budget,costUsd:out.costUsd,mode:cfg.mode};
    let failed=CHECKS.filter(([,key])=>probabilities[key]>=(key==='formingDependency'?0.70:0.65));
    // CLAUDE_V113: "geçmiş sonuçlar olumsuz" yalnız aynı setup+yönde ≥5 ölçülmüş kapanış varsa bağlayıcı
    // (az örnekle setup kalıcı kilitlenmesin).
    const trackSamples=(Array.isArray(unified?.learning?.stats)?unified.learning.stats:[])
      .filter(x=>String(x?.side||'').toUpperCase()===String(plan?.side||'').toUpperCase()&&String(x?.setup||'')===String(plan?.setup||''))
      .reduce((a,x)=>a+(Number(x?.samples)||0),0);
    if(trackSamples<5)failed=failed.filter(([,key])=>key!=='negativeTrackRecord');
    const conflictingTFs=FRAMES.filter(tf=>timeframeConflicts[tf]>=0.65);
    const vetoReasons=failed.map(([, ,reason])=>reason);
    if(conflictingTFs.length&&!vetoReasons.includes('JEV_TF_CONFLICT'))vetoReasons.push('JEV_TF_CONFLICT');
    const summaryTr=(vetoReasons.length?'Jev bekletiyor: '+failed.map(x=>x[3]).join('; '):'Jev ek veto bulmadı; yürütme ve risk kontrolleri ayrıca gereklidir.')+
      (conflictingTFs.length?' Çelişen TF: '+conflictingTFs.join(', ')+'.':'')+
      (vetoReasons.length?' Beklenen koşul (mevcut plan): '+String(plan.waitFor||'Güncel kanıtlarla yeniden değerlendirme'):'');
    return {ok:true,configured:true,required:true,called:true,shadow:shadowWatch,veto:vetoReasons.length>0,vetoReasons,probabilities,timeframeConflicts,conflictingTFs,summaryTr,model:cfg.model,mode:cfg.mode,durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget};
  }
  return {config:cfg,localStatus,remoteStatus,billingStatus,billingSnapshot,probe,judge,judgeExit,sovereignPass1,sovereignFinal,sovereignLesson,sovereignExit,budgetStatus};
}
module.exports={CHECKS,EXIT_CHECKS,SOVEREIGN_EVIDENCE,decisionQuestions,exitDecisionQuestions,DEFAULTS,normalizeConfig,sanitizedKeyMetadata,noulProbability,choiceValue,compactDecisionRecord,compactSovereignEvidence,compactExperienceMemory,createJevClient};
