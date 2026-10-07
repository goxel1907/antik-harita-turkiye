const fs=require('fs');
const jevEdge=require('./jev-edge'); // R2544.55: narrow +1R-before-stop questions + kept probabilities/confidence
const path=require('path');
const crypto=require('node:crypto');
const {marketPacket,mirrorDigest,rankPatterns,formingDigest,volDigest,readoutDigest}=require('./jev-market-packet');
const {encodeMarketPacket,expandMarketPacket}=require('./jev-wire-market');
const {BURST_STRICTNESS,BURST_TTL_MS}=require('./burst-scalp');
// Measured on this account 05.10.2026: CTUSDT round trip commission 0.298 USDT on 300 USDT notional (taker both sides).
const BURST_ROUND_TRIP_FEE_PCT=0.10;

const DEFAULTS={
  enabled:false,
  model:'typesafe/jev-1.13',
  decisionsUrl:'https://openrouter.ai/api/alpha/decisions',
  keyUrl:'https://openrouter.ai/api/v1/key',
  creditsUrl:'https://openrouter.ai/api/v1/credits',
  billingCacheMs:300000,
  mode:'SOVEREIGN_DIRECTOR_5M15M',
  softBudgetUsd:0,
  dailyCapUsd:100,
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
  ['TRADINGVIEW_5M','Request the fresh deterministic 5m chart reading for the scalp lane. Mainline evidence is generated from the same closed-candle numeric truth as the JEV packet and does not require GPU/VLM. Optional image/Vision audit is separate and can never override numeric truth.'],
  ['TRADINGVIEW_15M','Request the fresh deterministic 15m chart reading for the main trade lane. Mainline evidence is generated from the same closed-candle numeric truth as the JEV packet and does not require GPU/VLM. Optional image/Vision audit is separate and can never override numeric truth.'],
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
// R2544.28: schema-valid does not mean semantically coherent. This validator never chooses
// LONG/SHORT itself; it only rejects a JEV answer whose own fields contradict each other
// or whose declared primary ORDER_FLOW_DEPTH edge contradicts the supplied selected-side flow state.
function sovereignFinalConsistency({selectedId,selectedPlan,setupFamily,entryTiming,waitReasonRaw,edgeBasis,preEntryFlowAssessment,coreMarket}={}){
  const issues=[];
  const hasPlan=selectedId&&selectedId!=='WAIT'&&selectedPlan;
  const timing=String(entryTiming||'').toUpperCase();
  const family=String(setupFamily||'').toUpperCase();
  const wait=String(waitReasonRaw||'').toUpperCase();
  const edge=String(edgeBasis||'').toUpperCase();
  const flowAssessment=String(preEntryFlowAssessment||'').toUpperCase();
  if(selectedId==='WAIT'&&timing==='MARKET_NOW')issues.push('WAIT_WITH_MARKET_NOW');
  if(hasPlan&&family==='NONE_WAIT')issues.push('EXECUTABLE_PLAN_WITH_NONE_WAIT');
  if(hasPlan&&timing==='MARKET_NOW'&&wait&&wait!=='NONE_MARKET_NOW')issues.push('MARKET_NOW_WITH_WAIT_REASON');
  if(hasPlan&&timing==='MARKET_NOW'&&edge==='NO_EDGE')issues.push('MARKET_NOW_WITH_NO_EDGE');
  if(hasPlan&&timing==='MARKET_NOW'&&flowAssessment==='TRAP_RISK_WAIT')issues.push('MARKET_NOW_WITH_TRAP_RISK_WAIT');
  if(hasPlan&&timing==='MARKET_NOW'&&edge==='ORDER_FLOW_DEPTH'){
    const pe=coreMarket?.microstructure?.preEntryAdverseSelection||null;
    const side=String(selectedPlan?.side||'').toUpperCase();
    const sideRow=side==='SHORT'?pe?.short:pe?.long;
    const guidance=pe?.entryTimingGuidance?.[side]||null;
    if(guidance==='DATA_INSUFFICIENT')issues.push('ORDER_FLOW_EDGE_WITH_INSUFFICIENT_FLOW_DATA');
    if(guidance==='WAIT_FLOW_NORMALIZATION')issues.push('ORDER_FLOW_EDGE_AGAINST_WAIT_GUIDANCE');
    if(['TRAP_RISK_HIGH','TRAP_RISK_ELEVATED'].includes(String(sideRow?.state||'').toUpperCase()))issues.push('ORDER_FLOW_EDGE_ON_TRAP_RISK_SIDE');
  }
  return {ok:issues.length===0,issues:[...new Set(issues)]};
}
// R2544.46 burst pre-authorization flow digest (trade clock; legacy 1s/3s only if a stream has no trade clock).
function burstWindowDigest(w){
  if(!w||typeof w!=='object')return null;
  return Object.fromEntries(['trades','spanMs','tradesPerSec','buyRatio','sellRatio','priceMoveBps','deltaQuote','largeBuyCount','largeSellCount'].map(k=>[k,finiteNumber(w[k])]));
}
function burstFlowDigest(stream){
  const tc=stream?.orderFlow?.tradeClock,w=stream?.orderFlow?.windows||{};
  if(!tc||typeof tc!=='object')return {clock:'LEGACY_1S_3S',oneSec:burstWindowDigest(w['1s']),threeSec:burstWindowDigest(w['3s'])};
  return {clock:'TRADES',fast:burstWindowDigest(tc.fast),slow:burstWindowDigest(tc.slow),thirtySec:burstWindowDigest(w['30s']),
    noiseBps20:finiteNumber(tc.noiseBps20),baselineTradesPerSec:finiteNumber(tc.baselineTradesPerSec),intensityRatio:finiteNumber(tc.intensityRatio)};
}
function burstOfiDigest(o){
  if(!o||typeof o!=='object')return null;
  if(o.available===false)return {available:false,reason:o.reason||null};
  return {available:true,samples:finiteNumber(o.samples),normalizedOfi:finiteNumber(o.normalizedOfi),queueImbalanceCurrent:finiteNumber(o.queueImbalanceCurrent),micropriceBps:finiteNumber(o.micropriceBps),priceMoveBps:finiteNumber(o.priceMoveBps)};
}
function sovereignFrame(f){
  if(!f?.available)return {available:false,reason:f?.reason||'UNAVAILABLE'};
  return {
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,close:finiteNumber(f.close),trend:f.trend||null,
    rsi14:finiteNumber(f.rsi14),atrPct:finiteNumber(f.atrPct),breakOfStructure:f.breakOfStructure||null,
    prior20High:finiteNumber(f.prior20High),prior20Low:finiteNumber(f.prior20Low),
    swingStructure:f.swingStructure||null,liquidity:f.liquidity||null,patterns:Array.isArray(f.patterns)?rankPatterns(f.patterns,4):[],forming:formingDigest(f.forming),
    candle:f.candle||null,volatility:volDigest(f.volatility),readout:readoutDigest(f.readout)
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
      takerBuyRatio:finiteNumber(candidate?.takerBuyRatio),fundingRate:finiteNumber(candidate?.fundingRate),
      // CLAUDE_R2544_15: Binance yükselenler merdivenindeki yeri (sıra, önceki sıra, 5 dk'daki sıra kazancı, katman, erken teşhis türü).
      ladder:candidate?.gainerRank?{rank:finiteNumber(candidate.gainerRank),prevRank:finiteNumber(candidate.gainerRankPrev),velocity5m:finiteNumber(candidate.gainerRankVelocity),
        projectedRank:finiteNumber(candidate.projectedGainerRank),tier:candidate.ladderTier||null,approach:candidate.ladderApproach||null,
        change24hPct:finiteNumber(candidate.priceChange24hPct),shortChangePct:finiteNumber(candidate.shortChangePct),shortWindowMin:finiteNumber(candidate.shortWindowMin)}:null
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
      visualWorker:'AUDIT_ON_DEMAND_EVIDENCE_ONLY'
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
      source:visual.source||null,mode:visual.mode||null,modelUsed:visual.modelUsed===true,
      deterministicFrames:finiteNumber(visual.deterministicFrames),error:visual.error||null,
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
// CLAUDE_R2544_14_MEMORY_SIGNATURE: ölçülmüş sonuç kaydındaki marketSignature (formasyon geometrisi dahil) tek başına
// 2,6–3,1 kB tutuyordu. 29.09: daha önce işlem açılmış coinlerde (ZEC, PUMP) deneyim hafızası 4,3 kB'a çıkıp PASS-2'yi
// 52 kB tavanının üstüne itiyordu → JEV_REQUEST_CONTEXT_TOO_LARGE; JEV o coinleri hiç değerlendiremiyordu.
// İmza, rejim başına trend/BOS/RSI/ATR/swing ve ilk 3 formasyon adına indirgenir (anlam korunur, geometri atılır).
function compactSignature(sig){
  if(!sig||typeof sig!=='object'||Array.isArray(sig))return sig??null;
  const out={};
  for(const [k,v] of Object.entries(sig)){
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      const o={};
      for(const f of ['trend','breakOfStructure','rsi14','atrPct','swingState','zone','returnPct'])if(v[f]!==undefined&&v[f]!==null)o[f]=v[f];
      if(Array.isArray(v.patterns))o.patterns=v.patterns.slice(0,3).map(p=>p&&p.type?[p.type,p.side,p.status].filter(Boolean).join(':'):null).filter(Boolean);
      out[k]=o;
    }else if(v===null||typeof v!=='object')out[k]=v;
  }
  return out;
}
function compactOutcomeRecord(o){
  if(!o||typeof o!=='object')return o;
  const {marketSignature,entryContext,...rest}=o;
  return {...rest,...(marketSignature!==undefined?{marketSignature:compactSignature(marketSignature)}:{})};
}
function compactExperienceMemory(learning,maxChars=6500){
  const src=learning&&typeof learning==='object'?learning:{};
  const out={
    alwaysOn:true,
    // CLAUDE_R2544_16_TRADE_LESSONS: kendi kâr/zarar derslerin (katman×yön, kurulum×yön, çıkış, tekrarlanan hata, bu coin).
    tradeLessons:src.tradeLessons&&typeof src.tradeLessons==='object'?src.tradeLessons:null,
    caseMemory:src.caseMemory&&typeof src.caseMemory==='object'?src.caseMemory:null,
    caseMemoryByLane:src.caseMemoryByLane&&typeof src.caseMemoryByLane==='object'?src.caseMemoryByLane:null,
    source:src.source||'BrainHub measured experience memory',
    measuredSampleCount:Number(src.measuredSampleCount)||0,
    jevLessonCount:Number(src.jevLessonCount)||0,
    burstExperience:Array.isArray(src.burstExperience)?src.burstExperience.slice(0,6):[],
    burstDecisions:Array.isArray(src.burstDecisions)?src.burstDecisions.slice(0,2):[],
    lifetime:src.lifetime&&typeof src.lifetime==='object'?src.lifetime:null,
    stats:Array.isArray(src.stats)?src.stats.slice(0,8):[],
    measuredOutcomes:Array.isArray(src.measuredOutcomes)?src.measuredOutcomes.slice(0,8).map(compactOutcomeRecord):[],
    jevLessons:Array.isArray(src.jevLessons)?src.jevLessons.slice(0,6).map(compactOutcomeRecord):[],
    note:'Always-on soft context. Measured outcomes and JEV lessons inform interpretation but never create hard gates, change capital settings, or bypass deterministic safety.'
  };
  const limit=Math.max(2500,Math.min(9000,Number(maxChars)||6500));
  if(out.caseMemoryByLane&&typeof out.caseMemoryByLane==='object'){
    out.caseMemoryByLane=Object.fromEntries(Object.entries(out.caseMemoryByLane).slice(0,4).map(([k,d])=>[k,d&&typeof d==='object'?{...d,analogs:Array.isArray(d.analogs)?d.analogs.slice(0,2):[]}:d]));
  }
  let raw=JSON.stringify(out);
  if(raw.length>limit){
    out.measuredOutcomes=out.measuredOutcomes.slice(0,5);out.jevLessons=out.jevLessons.slice(0,5);
    if(out.caseMemoryByLane)for(const d of Object.values(out.caseMemoryByLane))if(d&&Array.isArray(d.analogs))d.analogs=d.analogs.slice(0,1);
    raw=JSON.stringify(out);
  }
  if(raw.length>limit){out.stats=out.stats.slice(0,5);out.measuredOutcomes=out.measuredOutcomes.slice(0,3);out.jevLessons=out.jevLessons.slice(0,3);raw=JSON.stringify(out);}
  if(raw.length>limit){
    return {
      alwaysOn:true,tradeLessons:out.tradeLessons,caseMemory:out.caseMemory,caseMemoryByLane:out.caseMemoryByLane,source:out.source,measuredSampleCount:out.measuredSampleCount,jevLessonCount:out.jevLessonCount,lifetime:out.lifetime,
      stats:out.stats.slice(0,3),measuredOutcomes:out.measuredOutcomes.slice(0,2),jevLessons:out.jevLessons.slice(0,2),burstExperience:out.burstExperience.slice(0,2),burstDecisions:out.burstDecisions.slice(0,1),
      memoryTrimmed:true,note:out.note
    };
  }
  return out;
}
function dynamicKnowledgeReference(root,maxChars=7000){
  const file=path.join(root,'data','jev-knowledge.json');
  try{
    const raw=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    const entries=(Array.isArray(raw?.entries)?raw.entries:[])
      .filter(x=>x&&x.status==='VERIFIED_REFERENCE')
      .slice(-24).reverse()
      .map(x=>({topic:x.topic||null,family:x.family||null,verifiedAt:x.verifiedAt||null,summary:String(x.summary||'').slice(0,900),keyPoints:Array.isArray(x.keyPoints)?x.keyPoints.slice(0,6):[],sourceUrls:Array.isArray(x.sourceUrls)?x.sourceUrls.slice(0,4):[]}));
    let text=JSON.stringify(entries);
    while(text.length>maxChars&&entries.length>2){entries.pop();text=JSON.stringify(entries);}
    return {loaded:true,mode:'VERIFIED_READ_ONLY_DYNAMIC_REFERENCE',entries,text};
  }catch{return {loaded:false,mode:'VERIFIED_READ_ONLY_DYNAMIC_REFERENCE',entries:[],text:'[]'};}
}
function liveReasoningContext(root,learning){
  const cortex=traderCortexReference(root);
  const dynamic=dynamicKnowledgeReference(root);
  return {
    professionalTraderCortex:cortex.loaded?{version:cortex.version,mode:cortex.mode,reference:cortex.text}:null,
    dynamicKnowledge:dynamic.loaded?{mode:dynamic.mode,entries:dynamic.entries}:null,
    experienceMemory:compactExperienceMemory(learning,8500)
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
  const maxPayloadChars=Math.max(4000,Math.min(48000,Number(raw.maxPayloadChars||DEFAULTS.maxPayloadChars)));
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
    return x?{low:x.low??null,high:x.high??null,scope:x.scope??null,zoneMode:x.zoneMode??null,confirmedAt:x.confirmedAt??null,state:x.state??null,mitigated:x.mitigated===true,distancePct:x.distancePct??null,volRel:x.volRel??null}:null;};
  // CLAUDE_R2544_11_BREAKER: kırılan ve geri alınmayan blok (yön değiştirmiş) ayrıca verilir.
  const brk=list=>{const x=(Array.isArray(list)?list:[]).find(o=>o&&o.broken===true&&o.breaker===true)||null;return x?{low:x.low??null,high:x.high??null,volRel:x.volRel??null}:null;};
  const out={bullish:pick(ob.bullish),bearish:pick(ob.bearish)};
  const bb=brk(ob.bullish),sb=brk(ob.bearish);
  if(bb)out.bullBreakerResistance=bb;
  if(sb)out.bearBreakerSupport=sb;
  return out;
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
      candle:f.candle||null, patterns:Array.isArray(f.patterns)?rankPatterns(f.patterns,4):[],forming:formingDigest(f.forming), volatility:volDigest(f.volatility), readout:readoutDigest(f.readout), smcContext:compactSmc(f.smcContext), liquidity:f.liquidity||null,
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

// R2544.22 HARD CONTEXT BUDGET
// Build the request to a PASS-specific target before it reaches the wire. Static policy prose,
// duplicate representations and optional memory/knowledge are compacted before current market truth.
// The hard wire cap is deliberately below the historic 52 kB ceiling so PASS-1 and PASS-2 keep
// tokenizer headroom. Core numeric truth and R2544.21 pre-entry sampling confidence are never silently dropped.
const MAX_DECISION_REQUEST_BYTES=48000;
const PASS1_TARGET_BYTES=42000;
const PASS2_TARGET_BYTES=46000;
const OTHER_TARGET_BYTES=44000;
const BURST_TARGET_BYTES=36000;
// R42: compact management instruction used only when the management request is over its target.
// Same contract as the full sovereignExit description; only explanatory prose is shortened.
const MANAGEMENT_DESCRIPTION_COMPACT='JEV is the sole strategic position manager. Choose HOLD, PROTECT_PROFIT, REDUCE_RISK, PARTIAL_TAKE_PROFIT or EXIT_NOW from the supplied evidence; no fixed 1m/3m/5m/15m alignment and no score threshold. Weight conflicting evidence by actual importance. record.managementContract is the execution contract for PARTIAL_TAKE_PROFIT; a partial outside it is recorded as HOLD, so choose HOLD, PROTECT_PROFIT or EXIT_NOW instead. EXIT_NOW is never restricted. REDUCE_RISK is for a losing/adverse position whose thesis is not fully invalidated; it is never profit taking. chartOverlayLevels trendLines/breakoutEvidence and frame volatility.trail/spike are soft context, never automatic exits. The professional trader Cortex and experienceMemory (caseMemory winners and counterexamples, caseMemoryByLane, tradeLessons = your own measured P&L) are always-on soft context, never a veto or rule; do not mechanically flip direction or rotate coins unless current structure, location and execution evidence is materially different. Code after this decision enforces execution integrity and exchange safety only. If a material concept is not understood, do not invent it.';

function decisionPass(body){return body?.state?.record?.contract==='R2544.29_BURST_PREAUTH'?'BURST':body?.questions?.trade_plan?2:body?.questions?.lane_focus?1:'OTHER';}
function targetBytesForPass(pass){return pass===1?PASS1_TARGET_BYTES:pass===2?PASS2_TARGET_BYTES:pass==='BURST'?BURST_TARGET_BYTES:OTHER_TARGET_BYTES;}
function byteSize(v){return Buffer.byteLength(JSON.stringify(v??null),'utf8');}
function hashJson(v){return crypto.createHash('sha256').update(JSON.stringify(v??null)).digest('hex');}
function frameTruth(f,{detail=false,timing=false}={}){
  if(!f||typeof f!=='object')return f??null;
  const sw=f.swingStructure&&typeof f.swingStructure==='object'?f.swingStructure:null;
  const out={
    available:f.available??null,fresh:f.fresh??null,asOf:f.asOf??null,source:f.source??null,synthetic:f.synthetic??null,
    closedCandle:f.closedCandle??null,
    close:f.close??null,trend:f.trend??null,breakOfStructure:f.breakOfStructure??null,rsi14:f.rsi14??null,atrPct:f.atrPct??null,
    ema20:f.ema20??null,ema50:f.ema50??null,prior20High:f.prior20High??null,prior20Low:f.prior20Low??null,
    candle:f.candle??null,forming:f.forming??null,keyLevels:f.keyLevels??null,volatility:f.volatility??null,readout:f.readout??null,priceAction:f.priceAction??null,
    swingState:sw?{state:sw.state??sw.structure??null,event:sw.event??null,lastConfirmedSwingHigh:sw.lastConfirmedSwingHigh?.price??null,lastConfirmedSwingLow:sw.lastConfirmedSwingLow?.price??null}:null
  };
  if(timing)out.preMove=f.preMove??null;
  if(detail){out.recentFairValueGaps=f.recentFairValueGaps??null;out.fairValueGapHistory=f.fairValueGapHistory??null;out.orderBlocks=f.orderBlocks??null;out.fibLevels=f.fibLevels??null;out.oteReference=f.oteReference??null;const smc=f.smcContext&&typeof f.smcContext==='object'?f.smcContext:null;out.smcCore=smc?{available:smc.available??null,swingEvent:smc.swingEvent??null,swingState:smc.swingState??null,dealingRange:smc.dealingRange??null}:null;}
  return out;
}
function protectedCoreTruth(body){
  const record=expandMarketPacket(body?.state?.record);
  const management=record?.contract==='R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT';
  const p=expandMarketPacket(body?.state?.coreMarketPacket)||(management?{...record,coreFrames:record.frames,microstructure:{orderFlow:record.orderFlow,depth:record.depth,preEntryAdverseSelection:record.currentAdverseSelection}}:null);
  if(!p||typeof p!=='object')return null;
  return {
    contract:p.contract??null,symbol:p.symbol??null,livePrice:p.livePrice??null,levelMap:p.levelMap??null,liquidationHistory:p.liquidationHistory??null,
    chartOverlayLevels:p.chartOverlayLevels??null,
    coreFrames:Object.fromEntries(['5m','15m'].map(tf=>[tf,frameTruth(p?.coreFrames?.[tf],{detail:true})])),
    timingFrames:Object.fromEntries(['1m','3m'].map(tf=>[tf,frameTruth(p?.timingFrames?.[tf],{timing:true})])),
    higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,frameTruth(p?.higherContext?.[tf])])),
    microstructure:p.microstructure??null,derivatives:p.derivatives??null,observedLiquidations:p.observedLiquidations??null,
    dataQuality:p.dataQuality??null,global:p.global??null,
    ...(management?{position:record.position,lifecycle:record.lifecycle,riskState:record.riskState,positionProgress:record.positionProgress,performanceState:record.performanceState,entryThesis:record.entryThesis,managementContract:record.managementContract}: {})
  };
}
function compactChartNarrative(n){
  if(!n||typeof n!=='object')return n;
  const frames={};
  for(const [tf,f] of Object.entries(n.frames||{})){
    if(!f||typeof f!=='object'){frames[tf]=f;continue;}
    frames[tf]={available:f.available,detail:f.detail,flags:f.flags||null,...(['5m','15m'].includes(tf)&&typeof f.line==='string'?{line:f.line}: {})};
  }
  return {
    contract:n.contract||null,source:n.source||null,
    semantics:'Deterministic closed-candle reading; numeric packet is truth. 5m/15m narrative retained; other TF detail stays in structured frames.',
    frames,alignment:n.alignment||null,sourceHash:n.hash||null,compacted:true
  };
}
function clipNatural(text,max){
  const x=String(text||'').replace(/\r/g,'').trim();if(x.length<=max)return x;
  const cut=x.slice(0,max);const floor=Math.floor(max*0.62);
  const pts=[cut.lastIndexOf('\n\n'),cut.lastIndexOf('\n- '),cut.lastIndexOf('. '),cut.lastIndexOf('; ')].filter(i=>i>=floor);
  const at=pts.length?Math.max(...pts)+1:max;return cut.slice(0,at).trim();
}
function compactCortexReference(reference,maxChars=4200){
  const raw=String(reference||'').replace(/\r/g,'');if(raw.length<=maxChars)return raw;
  const parts=raw.split(/^## /m);const intro=parts.shift()||'';
  const sections=parts.map(x=>{const nl=x.indexOf('\n');return {title:(nl>=0?x.slice(0,nl):x).trim(),body:(nl>=0?x.slice(nl+1):'').trim()};});
  const priority=['Decision doctrine','Market regime recognition','Structure and price action','Classical chart formations','Candlestick information','Support, resistance, and location','SMC / liquidity vocabulary','Volume, open interest, funding, positioning','Order flow, CVD, and tape logic','Depth / order-book microstructure','Core strategy families','Trap recognition','5m scalp expertise','15m trade expertise','Execution-cost discipline','Risk and position management','Experience memory — ALWAYS ON','Knowledge-gap protocol','Evidence reliability hierarchy'];
  const by=new Map(sections.map(x=>[x.title,x]));let out=clipNatural(intro,420)+'\n';
  const each=Math.max(150,Math.floor((maxChars-out.length-200)/priority.length));
  for(const title of priority){const sec=by.get(title);if(!sec)continue;const first=sec.body.split(/\n\s*\n/)[0]||sec.body;out+='## '+title+'\n'+clipNatural(first,each)+'\n';if(out.length>=maxChars)break;}
  return clipNatural(out,maxChars);
}
function compactKnowledgeEntries(entries,maxEntries=3){
  return (Array.isArray(entries)?entries:[]).slice(0,maxEntries).map(x=>({topic:x?.topic||null,family:x?.family||null,verifiedAt:x?.verifiedAt||null,
    summary:clipNatural(x?.summary||'',320),keyPoints:(Array.isArray(x?.keyPoints)?x.keyPoints:[]).slice(0,2).map(v=>clipNatural(v,180)),sourceUrls:(Array.isArray(x?.sourceUrls)?x.sourceUrls:[]).slice(0,1)}));
}
// R43: verified notes used to reach JEV newest-first, so budget compaction kept one unrelated note while JEV
// waited on KNOWLEDGE_GAP (130 times since 04.10). Order notes by the patterns present in the current packet;
// generic direction words do not count. Ties keep the newest-first order.
const KNOWLEDGE_GENERIC_TOKENS=new Set(['BULL','BEAR','BULLISH','BEARISH','LONG','SHORT','HIGH','LOW','HIGHS','LOWS','UP','DOWN','CLOSE','OPEN','BREAK','BREAKOUT','BREAKDOWN','TREND','PATTERN','PRICE','LEVEL','ZONE','RISING','FALLING','THE','AND','OR','WITH','FROM','INTO']);
function knowledgeTokens(topic){return String(topic||'').toUpperCase().split(/[^A-Z0-9]+/).filter(t=>t.length>=3&&!KNOWLEDGE_GENERIC_TOKENS.has(t));}
function rankKnowledgeByPacket(entries,packet){
  if(!Array.isArray(entries)||entries.length<2||!packet||typeof packet!=='object')return entries;
  const text=JSON.stringify(packet).toUpperCase();
  const score=e=>{const topic=String(e?.topic||'').toUpperCase().trim();if(!topic)return 0;
    let n=text.includes(topic)?10:0;for(const t of new Set(knowledgeTokens(topic)))if(new RegExp('(^|[^A-Z0-9])'+t+'($|[^A-Z0-9])').test(text))n+=1;return n;};
  return entries.map((e,i)=>({e,i,s:score(e)})).sort((a,b)=>b.s-a.s||a.i-b.i).map(x=>x.s>0?{...x.e,packetRelevance:x.s}:x.e);
}
function compactMemoryForDecision(mem,pass){
  if(!mem||typeof mem!=='object')return mem;
  const out={alwaysOn:true,source:mem.source||null,measuredSampleCount:mem.measuredSampleCount??null,jevLessonCount:mem.jevLessonCount??null,lifetime:mem.lifetime||null};
  out.burstExperience=(Array.isArray(mem.burstExperience)?mem.burstExperience:[]).slice(0,2);
  const tl=mem.tradeLessons;
  if(tl&&typeof tl==='object')out.tradeLessons={version:tl.version,samples:tl.samples,lifetime:tl.lifetime,worked:(tl.worked||[]).slice(0,3),failed:(tl.failed||[]).slice(0,3),repeatedMistakes:(tl.repeatedMistakes||[]).slice(0,3),current:tl.current||null,symbol:tl.symbol||null,byPreEntryFlow:(tl.byPreEntryFlow||[]).slice(0,6),...(tl.byPriceAction?.length?{byPriceAction:tl.byPriceAction.slice(0,4)}:{}),...(tl.byFvgLifecycle?.length?{byFvgLifecycle:tl.byFvgLifecycle.slice(0,3)}:{}),trimmedForDecision:true};
  const cm=mem.caseMemory;
  if(cm&&typeof cm==='object')out.caseMemory={version:cm.version,available:cm.available,samples:cm.samples,summary:cm.summary,fidelity:cm.fidelity,counterexamples:cm.counterexamples,
    analogs:Array.isArray(cm.analogs)?cm.analogs.slice(0,pass===2?3:2):[],softContextOnly:true,contextProjected:true,executionAuthority:false};
  if(mem.caseMemoryByLane&&typeof mem.caseMemoryByLane==='object')out.caseMemoryByLane=Object.fromEntries(Object.entries(mem.caseMemoryByLane).map(([k,d])=>[k,d&&typeof d==='object'?{available:d.available,samples:d.samples,summary:d.summary,fidelity:d.fidelity,counterexamples:d.counterexamples,analogs:Array.isArray(d.analogs)?d.analogs.slice(0,1):[],softContextOnly:true,contextProjected:true}:d]));
  out.note='Measured experience is soft context; winners and counterexample losers remain represented. No self-modification or hard rule.';
  return out;
}
function compactPass1Questions(questions){
  if(!questions||typeof questions!=='object'||Array.isArray(questions))return questions;
  const out={};
  const evidencePrefix='Decide whether this evidence should be requested for the current decision. ';
  const evidenceSuffix=' Do not request it merely because a checklist exists; request it only if it can materially improve the decision.';
  for(const [id,q] of Object.entries(questions)){
    if(!q||typeof q!=='object'||Array.isArray(q)){out[id]=q;continue;}
    const x={...q};
    if(id==='lane_focus'){
      x.instructions='Choose the evidence-routing lane from supplied market state; this is not trade approval.';
      x.criteria={'5M_SCALP':'5m scalp deserves first evidence.','15M_TRADE':'15m trade deserves first evidence.','BOTH':'Both lanes deserve evidence.','UNDECIDED':'No lane preference yet.'};
    }else if(id==='direction_focus'){
      x.instructions='Choose which direction deserves evidence first; scanner side is attention-only.';
      x.criteria={LONG:'LONG first.',SHORT:'SHORT first.',BOTH:'Both remain live.',UNDECIDED:'No direction preference yet.'};
    }else if(id==='knowledge_research'){
      x.instructions='Request research only for a material knowledge gap not covered by current Cortex/verified knowledge.';
      x.criteria={SKIP:'Knowledge is adequate.',RESEARCH_IF_GAP:'Research the material gap before PASS-2.'};
    }else if(id==='knowledge_family'){
      x.instructions='If research is requested, route it to the closest family; this never approves a trade.';
      x.criteria={AUTO:'Auto-detect.',PATTERN:'Pattern/candlestick.',INDICATOR:'Indicator/quant.',MICROSTRUCTURE:'Order flow/depth/tape.',DERIVATIVES:'OI/funding/liquidation/positioning.',EXECUTION:'Execution/risk mechanics.',OTHER:'Other.'};
    }else if(id.startsWith('evidence_')){
      let unique=String(q.instructions||'').trim();
      if(unique.startsWith(evidencePrefix))unique=unique.slice(evidencePrefix.length);
      if(unique.endsWith(evidenceSuffix))unique=unique.slice(0,-evidenceSuffix.length);
      unique=unique.trim();
      x.instructions=(unique?unique+' ':'')+'Request only if material to this decision.';
      x.criteria={REQUEST:'Request now.',SKIP:'Skip.'};
    }
    out[id]=x;
  }
  return out;
}
function compactMemoryItemForRouting(v,max=180){
  if(v==null||typeof v==='number'||typeof v==='boolean')return v;
  if(typeof v==='string')return clipNatural(v,max);
  if(Array.isArray(v))return v.slice(0,7).map(x=>compactMemoryItemForRouting(x,Math.max(70,Math.floor(max/2))));
  if(typeof v==='object'){
    const keys=['eventId','symbol','side','family','lane','netPnl','rMultiple','exitType','similarity','fidelity','quality','actionHint','trapRisk','support','state','samples','avgR'];
    const out={};for(const k of keys)if(v[k]!==undefined)out[k]=compactMemoryItemForRouting(v[k],Math.max(70,Math.floor(max/2)));
    if(v.priceActionAtEntry)out.priceActionAtEntry=Object.fromEntries(['5m','15m'].map(tf=>{const f=v.priceActionAtEntry[tf];return [tf,f?{version:f.version,asOf:f.asOf,orderBlocks:(f.orderBlocks||[]).slice(0,2).map(z=>({side:z.side,scope:z.scope,low:z.low,high:z.high,state:z.state,confirmedAt:z.confirmedAt})),fvg:(f.fvg||[]).slice(0,2).map(z=>({side:z.side,low:z.low,high:z.high,ce50:z.ce50,lifecycle:z.lifecycle})),events:(f.events||[]).slice(-1)}:null];}));
    return Object.keys(out).length?out:null;
  }
  return null;
}
function compactMemoryForPass1Routing(mem){
  if(!mem||typeof mem!=='object')return mem;
  const out={alwaysOn:true,source:mem.source||null,measuredSampleCount:mem.measuredSampleCount??null,jevLessonCount:mem.jevLessonCount??null,lifetime:mem.lifetime||null};
  out.burstExperience=(Array.isArray(mem.burstExperience)?mem.burstExperience:[]).slice(0,2);
  const tl=mem.tradeLessons;
  if(tl&&typeof tl==='object')out.tradeLessons={version:tl.version,samples:tl.samples,lifetime:tl.lifetime,current:tl.current||null,symbol:tl.symbol||null,
    worked:(tl.worked||[]).slice(0,1).map(x=>compactMemoryItemForRouting(x,160)),failed:(tl.failed||[]).slice(0,1).map(x=>compactMemoryItemForRouting(x,160)),
    repeatedMistakes:(tl.repeatedMistakes||[]).slice(0,2).map(x=>compactMemoryItemForRouting(x,120)),byPreEntryFlow:(tl.byPreEntryFlow||[]).slice(0,3),...(tl.byPriceAction?.length?{byPriceAction:tl.byPriceAction.slice(0,3)}:{}),...(tl.byFvgLifecycle?.length?{byFvgLifecycle:tl.byFvgLifecycle.slice(0,3)}:{}),trimmedForPass1Routing:true};
  const analogPair=xs=>{
    const a=Array.isArray(xs)?xs:[];const win=a.find(x=>Number(x?.netPnl)>0);const loss=a.find(x=>Number(x?.netPnl)<0);const picked=[];
    if(win)picked.push(win);if(loss&&loss!==win)picked.push(loss);if(!picked.length&&a[0])picked.push(a[0]);
    return picked.slice(0,2).map(x=>compactMemoryItemForRouting(x,180)).filter(Boolean);
  };
  const compactDigest=(d,withAnalogs=true)=>d&&typeof d==='object'?{version:d.version,available:d.available,samples:d.samples,summary:d.summary,fidelity:d.fidelity,counterexamples:d.counterexamples,
    ...(withAnalogs?{analogs:analogPair(d.analogs)}:{}),softContextOnly:true,contextProjected:true,executionAuthority:false}:d;
  if(mem.caseMemory&&typeof mem.caseMemory==='object')out.caseMemory=compactDigest(mem.caseMemory,true);
  if(mem.caseMemoryByLane&&typeof mem.caseMemoryByLane==='object')out.caseMemoryByLane=Object.fromEntries(Object.entries(mem.caseMemoryByLane).slice(0,4).map(([k,d])=>[k,compactDigest(d,false)]));
  out.note='PASS-1 routing digest: measured aggregate + winner/loser counterexample context only; final-decision memory remains separate. No hard rule.';
  return out;
}
// R2544.24 PASS-2 FINAL BUDGET
// PASS-2 carries a large static answer schema plus evidence/plan summaries. Compact repeated prose and
// duplicated context before touching the protected current market packet. Choice IDs/keys and executable
// plan geometry remain intact; measured memory keeps aggregate results plus winner/loser counterexamples.
function compactPass2Questions(questions){
  if(!questions||typeof questions!=='object'||Array.isArray(questions))return questions;
  const out={};
  const concise={
    trade_plan:{instructions:'Choose one supplied executable plan only if direction, lane, timing, location, invalidation and execution quality justify entry now; otherwise WAIT.'},
    setup_family:{instructions:'Classify the setup for measured learning.',criteria:{TREND_PULLBACK:'Controlled trend pullback.',BREAKOUT_RETEST:'Accepted breakout/retest.',SWEEP_RECLAIM:'Liquidity sweep + reclaim.',FAILED_BREAKOUT:'Failed breakout/trap reversal.',RANGE_FADE:'Range-extreme rejection.',MOMENTUM_CONTINUATION:'Immediate continuation with room.',MEAN_REVERSION:'Stretched/exhausted mean reversion.',SQUEEZE_CROWDING:'Squeeze/crowding setup.',STRUCTURAL_REVERSAL:'Coherent structure reversal.',NONE_WAIT:'No strong setup; WAIT.'}},
    entry_timing:{instructions:'Choose entry timing; use WAIT_* when thesis may be valid but entry is not justified now.',criteria:{MARKET_NOW:'Entry is justified now.',WAIT_PULLBACK:'Wait for better pullback/location.',WAIT_BREAKOUT_RETEST:'Wait for breakout acceptance/retest.',WAIT_SWEEP_RECLAIM:'Wait for sweep + reclaim/rejection.',WAIT_STRUCTURE_CLOSE:'Wait for material closed-candle structure.',WAIT_NEW_EVIDENCE:'Wait for materially changed evidence.'}},
    wait_reason:{instructions:'If not MARKET_NOW, choose the single concrete reason; this is diagnostic, not an extra veto.',criteria:{NONE_MARKET_NOW:'Entry justified now.',LOCATION_POOR:'Location is poor/extended.',STRUCTURE_UNCONFIRMED:'Material structure event still required.',BREAKOUT_RETEST_REQUIRED:'Acceptance/retest still required.',SWEEP_RECLAIM_REQUIRED:'Sweep/reclaim still required.',EDGE_INSUFFICIENT:'Current edge is insufficient.',ADVERSE_SELECTION_RISK:'Immediate public flow/depth is adverse; wait for normalization/new evidence.',DATA_QUALITY:'Material data is stale/missing/unreliable.',KNOWLEDGE_GAP:'Material concept needs verified research.'}},
    edge_basis:{instructions:'Choose the primary evidence family carrying the edge.',criteria:{STRUCTURE_LOCATION:'Structure + location.',LIQUIDITY_SMC:'Liquidity/SMC geometry.',ORDER_FLOW_DEPTH:'Order flow/depth.',DERIVATIVES_POSITIONING:'Derivatives/positioning.',PATTERN_PRICE_ACTION:'Pattern + price action.',COMBINATION:'Coherent combination.',NO_EDGE:'No robust edge.'}},
    pre_entry_flow_assessment:{instructions:'Assess pre-entry public microstructure for the selected side. It is timing evidence only, not probability or hard gate; sparse/warming data => DATA_INSUFFICIENT.',criteria:{SUPPORTS_PLAN:'Supports immediate execution.',NEUTRAL_OR_MIXED:'Usable but not decisive.',TRAP_RISK_WAIT:'Immediate adverse-selection risk makes WAIT better.',DATA_INSUFFICIENT:'Sparse/stale/warming; do not weight timing.'}},
    management_style:{instructions:'If a plan is selected choose post-entry management; WAIT answers are recorded only.',criteria:{TP1_BE_TRAIL:'TP1 partial, protect, then trail runner.',STRUCTURE_TRAIL:'Trail by evolving structure.',PARTIALS_RUNNER:'Staged partials + runner.',HOLD_TO_INVALIDATION:'Hold until thesis/invalidation or later JEV review.'}},
    target_profile:{instructions:'Choose reward geometry for this opportunity.',criteria:{FAST_SCALP:'~0.75R / 1.5R / 2.5R.',BALANCED:'~1R / 2R / 3R.',RUNNER_EXTENDED:'~1R / 2R / 4R.',DEFENSIVE:'~0.75R / 1.25R / 2R.'}},
    partial_profile:{instructions:'Choose strategic partial/runner distribution.',criteria:{THIRDS:'Rough thirds.',HALF_QUARTER_RUNNER:'Half, quarter, quarter runner.',RUNNER_HEAVY:'Quarter, quarter, half runner.'}},
    breakeven_rule:{instructions:'Choose when protection may move toward breakeven; never widen risk.',criteria:{AFTER_TP1:'Consider after TP1.',AFTER_1R_CLOSE:'Consider after ~1R closed-candle move.',STRUCTURE_ONLY:'Only when structure/evidence supports it.'}},
    trail_rule:{instructions:'Choose preferred runner trailing evidence; later JEV review remains authoritative.',criteria:{'5M_STRUCTURE':'Closed 5m structure.','15M_STRUCTURE':'Closed 15m structure.','JEV_DYNAMIC':'Later JEV review chooses dynamically.'}}
  };
  for(const [id,q] of Object.entries(questions)){
    if(!q||typeof q!=='object'||Array.isArray(q)){out[id]=q;continue;}
    const x={...q};const c=concise[id];
    if(c){x.instructions=c.instructions;if(c.criteria)x.criteria=c.criteria;}
    if(id==='trade_plan'&&x.criteria&&typeof x.criteria==='object'){
      const cc={};
      for(const [choice,desc] of Object.entries(x.criteria)){
        if(choice==='WAIT'){cc[choice]='No supplied plan is justified now.';continue;}
        // Full canonical geometry remains in state.record.executablePlanOptions. Keep a compact inline
        // mirror so the choice key is still self-describing without duplicating long geometry prose.
        const parts=String(desc||'').split(' | ').filter(Boolean).filter(v=>!/^geometry=/.test(v)&&!/^forming /.test(v));
        cc[choice]=parts.slice(0,12).map(v=>clipNatural(v,96)).join(' | ')+(parts.length>12?' | …':'');
      }
      x.criteria=cc;
    }
    out[id]=x;
  }
  return out;
}
function compactPass2EvidenceNode(v,depth=0){
  if(v==null||typeof v==='number'||typeof v==='boolean')return v;
  if(typeof v==='string')return clipNatural(v,depth===0?180:110);
  if(Array.isArray(v))return v.slice(0,depth===0?4:2).map(x=>compactPass2EvidenceNode(x,depth+1));
  if(typeof v==='object'){
    const out={};let n=0;
    for(const [k,val] of Object.entries(v)){
      if(['frames','raw','image','imageData','png','html','base64'].includes(k))continue;
      if(n++>=12)break;
      out[k]=compactPass2EvidenceNode(val,depth+1);
    }
    return out;
  }
  return null;
}
function compactPass2Evidence(evidence){
  if(!evidence||typeof evidence!=='object')return evidence;
  const out={
    requested:Array.isArray(evidence.requested)?evidence.requested.slice(0,16):[],
    timing1m:compactPass2EvidenceNode(evidence.timing1m),timing3m:compactPass2EvidenceNode(evidence.timing3m),
    higherTf:compactPass2EvidenceNode(evidence.higherTf),orderFlow:compactPass2EvidenceNode(evidence.orderFlow),depth:compactPass2EvidenceNode(evidence.depth),
    derivatives:compactPass2EvidenceNode(evidence.derivatives),observedLiquidations:compactPass2EvidenceNode(evidence.observedLiquidations),historyOutcome:compactPass2EvidenceNode(evidence.historyOutcome)
  };
  if(evidence.visual&&typeof evidence.visual==='object')out.visual={authority:evidence.visual.authority||'EVIDENCE_ONLY',requestedFrames:Array.isArray(evidence.visual.requestedFrames)?evidence.visual.requestedFrames.slice(0,8):[],attached:evidence.visual.attached??null,required:evidence.visual.required??null,source:evidence.visual.source||null,mode:evidence.visual.mode||null,modelUsed:evidence.visual.modelUsed===true,error:evidence.visual.error||null,text:clipNatural(evidence.visual.text||'',420)};
  out.finalDecisionCompacted=true;
  return out;
}
function compactPass2Plan(p){
  if(!p||typeof p!=='object')return p;
  const keep=['id','side','lane','entryPrice','stopPrice','takeProfit1','takeProfit2','takeProfit3','invalidationPrice','invalidationSource','originTF','ownerTF','basis','stopPct','stopAtr'];
  const out={};for(const k of keep)if(p[k]!==undefined)out[k]=p[k];
  if(p.geometryNote)out.geometryNote=clipNatural(p.geometryNote,80);
  if(p.formingOwnerTF&&typeof p.formingOwnerTF==='object')out.formingOwnerTF={direction:p.formingOwnerTF.direction??null,changeAtr:p.formingOwnerTF.changeAtr??null,againstSide:p.formingOwnerTF.againstSide===true};
  return out;
}
function compactPass2Record(record){
  if(!record||typeof record!=='object'||Array.isArray(record))return record;
  const a=record.attention&&typeof record.attention==='object'?record.attention:null;
  const attention=a?{
    contract:a.contract||null,authority:a.authority||null,symbol:a.symbol||null,livePrice:a.livePrice??null,
    radar:a.radar?{sideHint:a.radar.sideHint??null,source:a.radar.source??null,targetSources:Array.isArray(a.radar.targetSources)?a.radar.targetSources.slice(0,6):[],attackRank:a.radar.attackRank??null,projectedRank:a.radar.projectedRank??null,rankVelocity:a.radar.rankVelocity??null,rankAcceleration:a.radar.rankAcceleration??null,m1:a.radar.m1??null,m3:a.radar.m3??null,m5:a.radar.m5??null,volumeAcceleration:a.radar.volumeAcceleration??null,rangeExpansion:a.radar.rangeExpansion??null,spreadBps:a.radar.spreadBps??null,oiDeltaPct:a.radar.oiDeltaPct??null,takerBuyRatio:a.radar.takerBuyRatio??null,fundingRate:a.radar.fundingRate??null,ladder:a.radar.ladder||null}:null,
    dataQuality:a.dataQuality||null,baseFrames:a.baseFrames||null,baseFramesDetail:'SEE_CORE_MARKET_PACKET',semantics:{scannerSideIsHintOnly:true,noPreJevQualification:true,numericTruth:'BINANCE_BRAINHUB'}
  }:null;
  return {attention,requestedEvidence:compactPass2Evidence(record.requestedEvidence),executablePlanOptions:Array.isArray(record.executablePlanOptions)?record.executablePlanOptions.slice(0,12).map(compactPass2Plan):record.executablePlanOptions,finalDecisionCompacted:true};
}
function compactMemoryForPass2Final(mem){
  if(!mem||typeof mem!=='object')return mem;
  const out={alwaysOn:true,source:mem.source||null,measuredSampleCount:mem.measuredSampleCount??null,jevLessonCount:mem.jevLessonCount??null,lifetime:mem.lifetime||null};
  out.burstExperience=(Array.isArray(mem.burstExperience)?mem.burstExperience:[]).slice(0,2);
  const tl=mem.tradeLessons;
  if(tl&&typeof tl==='object')out.tradeLessons={version:tl.version,samples:tl.samples,lifetime:tl.lifetime,current:compactMemoryItemForRouting(tl.current,220),symbol:compactMemoryItemForRouting(tl.symbol,220),
    worked:(tl.worked||[]).slice(0,1).map(x=>compactMemoryItemForRouting(x,220)).filter(Boolean),failed:(tl.failed||[]).slice(0,1).map(x=>compactMemoryItemForRouting(x,220)).filter(Boolean),
    repeatedMistakes:(tl.repeatedMistakes||[]).slice(0,2).map(x=>compactMemoryItemForRouting(x,160)).filter(Boolean),byPreEntryFlow:(tl.byPreEntryFlow||[]).slice(0,4),...(tl.byPriceAction?.length?{byPriceAction:tl.byPriceAction.slice(0,4)}:{}),...(tl.byFvgLifecycle?.length?{byFvgLifecycle:tl.byFvgLifecycle.slice(0,3)}:{}),trimmedForPass2Final:true};
  const analogPair=xs=>{const a=Array.isArray(xs)?xs:[];const win=a.find(x=>Number(x?.netPnl)>0),loss=a.find(x=>Number(x?.netPnl)<0);const picked=[];if(win)picked.push(win);if(loss&&loss!==win)picked.push(loss);if(!picked.length&&a[0])picked.push(a[0]);return picked.slice(0,2).map(x=>compactMemoryItemForRouting(x,220)).filter(Boolean);};
  const cm=mem.caseMemory;if(cm&&typeof cm==='object')out.caseMemory={version:cm.version,available:cm.available,samples:cm.samples,summary:cm.summary,fidelity:cm.fidelity,counterexamples:cm.counterexamples,analogs:analogPair(cm.analogs),softContextOnly:true,contextProjected:true,executionAuthority:false};
  if(mem.caseMemoryByLane&&typeof mem.caseMemoryByLane==='object')out.caseMemoryByLane=Object.fromEntries(Object.entries(mem.caseMemoryByLane).slice(0,4).map(([k,d])=>[k,d&&typeof d==='object'?{available:d.available,samples:d.samples,summary:d.summary,fidelity:d.fidelity,counterexamples:d.counterexamples,softContextOnly:true,contextProjected:true}:d]));
  out.note='PASS-2 final digest keeps measured aggregates plus winner/loser counterexamples; no self-modification, hard rule or execution authority.';
  return out;
}
// R2544.25 PASS-2 RESIDUAL BUDGET
// Natural scheduler traffic showed that R2544.24 could still finish near/over the 48 kB wire ceiling
// when the protected market packet itself grew. These residual stages are PASS-2 only and spend the
// remaining target budget on canonical decision schema / plan geometry / measured memory instead of
// clipping protected current-market truth.
function compactPass2QuestionsResidual(questions){
  const src=compactPass2Questions(questions);
  if(!src||typeof src!=='object'||Array.isArray(src))return src;
  const instructions={
    trade_plan:'Choose one canonical executable plan ID from state.record.executablePlanOptions, or WAIT.',
    setup_family:'Classify the measured setup family.',entry_timing:'Choose MARKET_NOW or one concrete WAIT timing.',
    wait_reason:'Choose the concrete reason for WAIT; NONE_MARKET_NOW only with an immediate plan.',
    edge_basis:'Choose the primary edge family.',pre_entry_flow_assessment:'Assess public pre-entry flow as timing evidence only.',
    management_style:'Choose post-entry management for a selected plan.',target_profile:'Choose reward geometry.',
    partial_profile:'Choose partial/runner distribution.',breakeven_rule:'Choose breakeven timing; never widen risk.',
    trail_rule:'Choose runner trailing evidence.'
  };
  const out={};
  for(const [id,q] of Object.entries(src)){
    if(!q||typeof q!=='object'||Array.isArray(q)){out[id]=q;continue;}
    if(String(id).startsWith('p1r_')){out[id]={type:q.type||'noul',instructions:String(q.instructions||'')};continue;} // R2544.55: prices must stay whole
    const x={type:q.type||'choice',instructions:instructions[id]||clipNatural(q.instructions||'',96)};
    if(q.criteria&&typeof q.criteria==='object'&&!Array.isArray(q.criteria)){
      const c={};
      for(const [choice,desc] of Object.entries(q.criteria)){
        if(id==='trade_plan')c[choice]=choice==='WAIT'?'No plan now.':'Canonical geometry is in state.record.executablePlanOptions.';
        else c[choice]=clipNatural(desc,42)||String(choice).replace(/_/g,' ');
      }
      x.criteria=c;
    }
    out[id]=x;
  }
  return out;
}
function compactPass2EvidenceNodeResidual(v,depth=0){
  if(v==null||typeof v==='number'||typeof v==='boolean')return v;
  if(typeof v==='string')return clipNatural(v,depth===0?96:64);
  if(Array.isArray(v))return v.slice(0,depth===0?3:2).map(x=>compactPass2EvidenceNodeResidual(x,depth+1));
  if(typeof v==='object'){
    const priority=['available','fresh','asOf','source','quality','score','usable','state','actionHint','direction','side','summary','signal','reason','status','count','price','value','delta','deltaPct','ratio','spreadBps','fundingRate','takerBuyRatio','openInterest','cvd','ofi','imbalance','pressure','support','resistance','risk'];
    const keys=Object.keys(v);const ordered=[...priority.filter(k=>keys.includes(k)),...keys.filter(k=>!priority.includes(k))];
    const out={};const max=depth===0?9:6;
    for(const k of ordered){if(Object.keys(out).length>=max)break;if(['frames','raw','image','imageData','png','html','base64','text'].includes(k))continue;out[k]=compactPass2EvidenceNodeResidual(v[k],depth+1);}
    return out;
  }
  return null;
}
function compactPass2EvidenceResidual(evidence){
  if(!evidence||typeof evidence!=='object')return evidence;
  const out={requested:Array.isArray(evidence.requested)?evidence.requested.slice(0,12):[]};
  for(const k of ['timing1m','timing3m','higherTf','orderFlow','depth','derivatives','observedLiquidations','historyOutcome'])if(evidence[k]!=null)out[k]=compactPass2EvidenceNodeResidual(evidence[k]);
  if(evidence.visual&&typeof evidence.visual==='object')out.visual={authority:evidence.visual.authority||'EVIDENCE_ONLY',attached:evidence.visual.attached??null,required:evidence.visual.required??null,source:evidence.visual.source||null,mode:evidence.visual.mode||null,error:evidence.visual.error||null};
  out.residualCompacted=true;return out;
}
function compactPass2PlanResidual(p){
  if(!p||typeof p!=='object')return p;
  const keep=['id','side','lane','entryPrice','stopPrice','takeProfit1','takeProfit2','takeProfit3','invalidationPrice','invalidationSource','originTF','ownerTF','basis'];
  const out={};for(const k of keep)if(p[k]!==undefined)out[k]=p[k];return out;
}
function compactPass2RecordResidual(record){
  if(!record||typeof record!=='object'||Array.isArray(record))return record;
  const a=record.attention&&typeof record.attention==='object'?record.attention:null;
  const r=a?.radar&&typeof a.radar==='object'?a.radar:null;
  const attention=a?{contract:a.contract||null,authority:a.authority||null,symbol:a.symbol||null,livePrice:a.livePrice??null,
    radar:r?{sideHint:r.sideHint??null,source:r.source??null,attackRank:r.attackRank??null,projectedRank:r.projectedRank??null,rankVelocity:r.rankVelocity??null,rankAcceleration:r.rankAcceleration??null,spreadBps:r.spreadBps??null}:null,
    baseFramesDetail:'SEE_CORE_MARKET_PACKET',dataQualityDetail:'SEE_CORE_MARKET_PACKET',semantics:{scannerSideIsHintOnly:true,numericTruth:'BINANCE_BRAINHUB'}}:null;
  return {attention,requestedEvidence:compactPass2EvidenceResidual(record.requestedEvidence),executablePlanOptions:Array.isArray(record.executablePlanOptions)?record.executablePlanOptions.slice(0,12).map(compactPass2PlanResidual):record.executablePlanOptions,residualBudgetCompacted:true};
}
function compactMeasuredAggregate(v,depth=0){
  if(v==null||typeof v==='number'||typeof v==='boolean')return v;
  if(typeof v==='string')return clipNatural(v,72);
  if(Array.isArray(v))return v.slice(0,depth===0?4:3).map(x=>compactMeasuredAggregate(x,depth+1));
  if(typeof v==='object'){
    const priority=['samples','count','wins','losses','winRate','netPnl','net','avgR','averageR','profitFactor','expectancy','grossProfit','grossLoss','maxDrawdown','closed','long','short','available','quality','fidelity'];
    const keys=Object.keys(v);const ordered=[...priority.filter(k=>keys.includes(k)),...keys.filter(k=>!priority.includes(k))];const out={};const max=depth===0?18:8;
    for(const k of ordered){if(Object.keys(out).length>=max)break;out[k]=compactMeasuredAggregate(v[k],depth+1);}return out;
  }
  return null;
}
function compactMemoryForPass2Residual(mem){
  if(!mem||typeof mem!=='object')return mem;
  const out={alwaysOn:true,source:mem.source||null,measuredSampleCount:mem.measuredSampleCount??null,jevLessonCount:mem.jevLessonCount??null,lifetime:compactMeasuredAggregate(mem.lifetime)};
  out.burstExperience=(Array.isArray(mem.burstExperience)?mem.burstExperience:[]).slice(0,2);
  const tl=mem.tradeLessons;if(tl&&typeof tl==='object')out.tradeLessons={version:tl.version,samples:tl.samples,lifetime:compactMeasuredAggregate(tl.lifetime),current:compactMemoryItemForRouting(tl.current,120),symbol:compactMemoryItemForRouting(tl.symbol,120),worked:(tl.worked||[]).slice(0,1).map(x=>compactMemoryItemForRouting(x,120)).filter(Boolean),failed:(tl.failed||[]).slice(0,1).map(x=>compactMemoryItemForRouting(x,120)).filter(Boolean),byPreEntryFlow:(tl.byPreEntryFlow||[]).slice(0,2).map(x=>compactMeasuredAggregate(x)),...(tl.byPriceAction?.length?{byPriceAction:tl.byPriceAction.slice(0,2)}:{}),...(tl.byFvgLifecycle?.length?{byFvgLifecycle:tl.byFvgLifecycle.slice(0,3)}:{}),residualCompacted:true};
  const pair=xs=>{const a=Array.isArray(xs)?xs:[];const win=a.find(x=>Number(x?.netPnl)>0),loss=a.find(x=>Number(x?.netPnl)<0);const picked=[];if(win)picked.push(win);if(loss&&loss!==win)picked.push(loss);if(!picked.length&&a[0])picked.push(a[0]);return picked.slice(0,2).map(x=>compactMemoryItemForRouting(x,120)).filter(Boolean);};
  const cm=mem.caseMemory;if(cm&&typeof cm==='object')out.caseMemory={version:cm.version,available:cm.available,samples:cm.samples,summary:compactMeasuredAggregate(cm.summary),fidelity:compactMeasuredAggregate(cm.fidelity),counterexamples:compactMeasuredAggregate(cm.counterexamples),analogs:pair(cm.analogs),softContextOnly:true,executionAuthority:false};
  if(mem.caseMemoryByLane&&typeof mem.caseMemoryByLane==='object')out.caseMemoryByLane=Object.fromEntries(Object.entries(mem.caseMemoryByLane).slice(0,2).map(([k,d])=>[k,d&&typeof d==='object'?{available:d.available,samples:d.samples,summary:compactMeasuredAggregate(d.summary),fidelity:compactMeasuredAggregate(d.fidelity),counterexamples:compactMeasuredAggregate(d.counterexamples)}:d]));
  out.note='PASS-2 residual digest: measured aggregates + winner/loser counterexamples remain soft context.';return out;
}
function compactPass2DecisionContractResidual(c){
  if(!c||typeof c!=='object')return c;
  return {version:c.version,authority:c.authority,phase:c.phase,lanes:c.lanes,rules:Array.isArray(c.rules)?c.rules.slice(0,8):c.rules,microstructure:clipNatural(c.microstructure||'',160),memory:clipNatural(c.memory||'',140),knowledge:clipNatural(c.knowledge||'',100),residualCompacted:true};
}
function minimalEssentialEnvelope(body){
  const s=body?.state||{};return {model:body?.model,state:{coreMarketPacket:s.coreMarketPacket||null,record:s.record||null,pass1Handoff:s.pass1Handoff||null,decisionContract:s.decisionContract||null},questions:body?.questions||null};
}
function prepareDecisionRequest(input,opts={}){
  const pass=decisionPass(input);
  const hardCap=Number.isFinite(Number(opts?.maxBytes))&&Number(opts.maxBytes)>0?Math.min(Number(opts.maxBytes),MAX_DECISION_REQUEST_BYTES):MAX_DECISION_REQUEST_BYTES;
  const targetCap=Number.isFinite(Number(opts?.targetBytes))&&Number(opts.targetBytes)>0?Math.min(Number(opts.targetBytes),hardCap):Math.min(targetBytesForPass(pass),hardCap);
  const body=JSON.parse(JSON.stringify(input));
  const beforeBytes=byteSize(body);const state=body.state||{};const trimStepsApplied=[];
  const marketSectionsBefore=Object.fromEntries(Object.entries(state.coreMarketPacket||{}).map(([k,v])=>[k,byteSize(v)]));
  let wireEncoding=null;
  const coreHashBefore=hashJson(protectedCoreTruth(body));
  if(state.dynamicKnowledge&&Array.isArray(state.dynamicKnowledge.entries)&&state.dynamicKnowledge.entries.length>1&&state.coreMarketPacket&&typeof state.coreMarketPacket==='object'){
    state.dynamicKnowledge.entries=rankKnowledgeByPacket(state.dynamicKnowledge.entries,expandMarketPacket(state.coreMarketPacket));
  }
  const record=body?.state?.record;const recordObj=record&&typeof record==='object'&&!Array.isArray(record)?record:null;
  const packetObj=body?.state?.coreMarketPacket&&typeof body.state.coreMarketPacket==='object'?body.state.coreMarketPacket:null;
  // Position geometry and the immutable entry thesis are not current-market
  // compaction targets. Current market facts use the same wire packet as entry.
  const management=recordObj?.contract==='R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT';
  const targets=[management?null:recordObj,packetObj].filter(Boolean);
  const refresh=()=>JSON.stringify(body);let serialized=refresh();
  // Pure duplication is removed even below target; no decision information is lost.
  if(recordObj&&body?.state?.experienceMemory&&recordObj.experienceMemory){delete recordObj.experienceMemory;trimStepsApplied.push('DUP_RECORD_EXPERIENCE_MEMORY');}
  if(recordObj&&packetObj?.coreFrames){
    const attention=(recordObj.attention&&typeof recordObj.attention==='object')?recordObj.attention:recordObj;
    if(attention?.baseFrames&&typeof attention.baseFrames==='object'){
      const bf={};for(const [tf,f] of Object.entries(attention.baseFrames))bf[tf]=f&&typeof f==='object'?{available:f.available,fresh:f.fresh,asOf:f.asOf,close:f.close,trend:f.trend}:f;
      attention.baseFrames=bf;attention.baseFramesDetail='SEE_CORE_MARKET_PACKET';trimStepsApplied.push('DUP_ATTENTION_BASEFRAMES');
    }
  }
  serialized=refresh();
  // Semantic optional-context projection. No blind string prefix slicing.
  if(byteSize(body)>targetCap){
    const cortex=state.professionalTraderCortex;if(cortex&&typeof cortex.reference==='string'){cortex.reference=compactCortexReference(cortex.reference,pass===1?3600:4200);cortex.referenceProjected=true;}
    if(state.dynamicKnowledge&&Array.isArray(state.dynamicKnowledge.entries)){state.dynamicKnowledge.entries=compactKnowledgeEntries(state.dynamicKnowledge.entries,pass===1?3:2);delete state.dynamicKnowledge.text;state.dynamicKnowledge.referenceProjected=true;}
    if(state.experienceMemory&&typeof state.experienceMemory==='object')state.experienceMemory=compactMemoryForDecision(state.experienceMemory,pass);
    trimStepsApplied.push('SEMANTIC_OPTIONAL_CONTEXT_PROJECTION');serialized=refresh();
  }
  if(byteSize(body)>targetCap){
    const cortex=state.professionalTraderCortex;if(cortex&&typeof cortex.reference==='string'){cortex.reference=compactCortexReference(cortex.reference,2200);cortex.referenceProjected=true;}
    if(state.dynamicKnowledge&&Array.isArray(state.dynamicKnowledge.entries))state.dynamicKnowledge.entries=compactKnowledgeEntries(state.dynamicKnowledge.entries,1);
    if(state.experienceMemory&&typeof state.experienceMemory==='object'){
      const m=state.experienceMemory;if(m.caseMemory?.analogs)m.caseMemory.analogs=m.caseMemory.analogs.slice(0,2);if(m.caseMemoryByLane)for(const d of Object.values(m.caseMemoryByLane))if(d?.analogs)d.analogs=d.analogs.slice(0,1);
      m.optionalContextCompacted=true;
    }
    trimStepsApplied.push('OPTIONAL_CONTEXT_TIGHT');serialized=refresh();
  }
  // PASS-1 question schemas carry repeated static routing prose. Compact only prose, never question IDs,
  // choice keys, evidence descriptions or the current market packet. This is deliberately before market compaction.
  if(pass===1&&byteSize(body)>targetCap&&body.questions&&typeof body.questions==='object'){
    body.questions=compactPass1Questions(body.questions);trimStepsApplied.push('PASS1_QUESTION_SCHEMA_COMPACT');serialized=refresh();
  }
  // PASS-1 only routes evidence. If still over target, keep measured outcome aggregates and winner/loser
  // counterexamples while removing verbose lesson prose; PASS-2/final memory semantics are untouched.
  if(pass===1&&byteSize(body)>targetCap&&state.experienceMemory&&typeof state.experienceMemory==='object'){
    state.experienceMemory=compactMemoryForPass1Routing(state.experienceMemory);trimStepsApplied.push('PASS1_ROUTING_MEMORY_TIGHT');serialized=refresh();
  }
  // PASS-2 final choice: compact the large static answer schema first, then duplicated final-record evidence,
  // then measured memory only if still needed. Protected market truth is not touched by these stages.
  if(pass===2&&byteSize(body)>targetCap&&body.questions&&typeof body.questions==='object'){
    body.questions=compactPass2Questions(body.questions);trimStepsApplied.push('PASS2_QUESTION_SCHEMA_COMPACT');serialized=refresh();
  }
  if(pass===2&&byteSize(body)>targetCap&&state.record&&typeof state.record==='object'&&state.record.attention&&Array.isArray(state.record.executablePlanOptions)){
    state.record=compactPass2Record(state.record);trimStepsApplied.push('PASS2_RECORD_COMPACT');serialized=refresh();
  }
  if(pass===2&&byteSize(body)>targetCap&&state.experienceMemory&&typeof state.experienceMemory==='object'){
    state.experienceMemory=compactMemoryForPass2Final(state.experienceMemory);trimStepsApplied.push('PASS2_MEMORY_TIGHT');serialized=refresh();
  }
  if(byteSize(body)>targetCap&&packetObj?.chartNarrative){packetObj.chartNarrative=compactChartNarrative(packetObj.chartNarrative);trimStepsApplied.push('CHART_NARRATIVE_DEDUP');serialized=refresh();}
  if(recordObj||packetObj){
    const stripGeometry=node=>{if(Array.isArray(node)){for(const x of node)stripGeometry(x);return;}if(!node||typeof node!=='object')return;if(Array.isArray(node.patterns))node.patterns=node.patterns.map(p=>{if(!p||typeof p!=='object')return p;const {geometry,...rest}=p;return geometry?{...rest,geometryTrimmed:true}:rest;});for(const v of Object.values(node))stripGeometry(v);};
    const stripPivots=node=>{if(Array.isArray(node)){for(const x of node)stripPivots(x);return;}if(!node||typeof node!=='object')return;const sw=node.swingStructure;if(sw&&typeof sw==='object'&&(sw.confirmedPivots||sw.trendLines)){const {confirmedPivots,trendLines,...rest}=sw;node.swingStructure={...rest,pivotsTrimmed:true};}for(const v of Object.values(node))stripPivots(v);};
    const stripDup=node=>{if(Array.isArray(node)){for(const x of node)stripDup(x);return;}if(!node||typeof node!=='object')return;if(Array.isArray(node.recentFairValueGaps)&&node.liquidity&&typeof node.liquidity==='object'&&Array.isArray(node.liquidity.fairValueGaps)){const {fairValueGaps,...rest}=node.liquidity;node.liquidity={...rest,fairValueGapsTrimmed:true};}const smc=node.smcContext;if(smc&&typeof smc==='object'){const {note,semantics,source,...rest}=smc;if(note||semantics||source)node.smcContext=rest;}for(const v of Object.values(node))stripDup(v);};
    const stripFib=node=>{if(Array.isArray(node)){for(const x of node)stripFib(x);return;}if(!node||typeof node!=='object')return;const smc=node.smcContext;if(smc&&typeof smc==='object'&&(smc.fibLevels||smc.oteReference)){const {fibLevels,oteReference,...rest}=smc;node.smcContext={...rest,fibAndOteInNarrative:true};}for(const v of Object.values(node))stripFib(v);};
    const summarizeGroup=(group,keep)=>{if(!group||typeof group!=='object')return;for(const [tf,f] of Object.entries(group)){if(!f||typeof f!=='object')continue;const o={};for(const k of keep)if(f[k]!==undefined)o[k]=f[k];const sw=f.swingStructure;if(sw&&typeof sw==='object')o.swingStructure={state:sw.state??sw.structure??null,event:sw.event??null,lastConfirmedSwingHigh:sw.lastConfirmedSwingHigh?.price==null?null:{price:sw.lastConfirmedSwingHigh.price},lastConfirmedSwingLow:sw.lastConfirmedSwingLow?.price==null?null:{price:sw.lastConfirmedSwingLow.price},compacted:true};o.compacted=true;group[tf]=o;}};
    const secondary=[
      ['PATTERN_GEOMETRY',()=>{for(const t of targets)stripGeometry(t);}],
      ['SWING_PIVOTS_TRENDLINES',()=>{for(const t of targets)stripPivots(t);}],
      ['DUP_FVG_SMC_TEXT',()=>{for(const t of targets)stripDup(t);}],
      ['FIB_OTE_RAW',()=>{for(const t of targets)stripFib(t);}],
      ['PATTERNS_TOP3_BOTH_SIDES_PER_TF',()=>{const frames=targets.flatMap(t=>[t.frames,t.timingFrames,t.higherContext,t.coreFrames]).filter(x=>x&&typeof x==='object');for(const g of frames)for(const f of Object.values(g))if(f&&typeof f==='object'&&Array.isArray(f.patterns))f.patterns=rankPatterns(f.patterns,3);}],
      ['HIGHER_CONTEXT_SUMMARY',()=>{const keep=['available','fresh','asOf','source','synthetic','closedCandle','close','trend','breakOfStructure','rsi14','atrPct','prior20High','prior20Low','ema20','ema50','candle','forming','keyLevels','volatility','readout'];for(const t of targets)summarizeGroup(t.higherContext,keep);}],
      ['TIMING_FRAMES_SUMMARY',()=>{const keep=['available','fresh','asOf','source','synthetic','closedCandle','close','trend','breakOfStructure','rsi14','atrPct','prior20High','prior20Low','ema20','ema50','candle','forming','preMove','volatility','keyLevels','readout'];for(const t of targets)summarizeGroup(t.timingFrames,keep);}]
    ];
    for(const [name,step] of secondary){if(byteSize(body)<=targetCap)break;try{step();trimStepsApplied.push(name);}catch{}serialized=refresh();}
  }
  // R2544.25: allocate the remaining PASS-2 target budget dynamically after the protected packet and
  // normal compaction stages have revealed their real byte cost. Only duplicated/static/soft context is
  // tightened here; protectedCoreTruth() remains byte-identical and the 48 kB hard ceiling is unchanged.
  if(pass===2&&byteSize(body)>targetCap&&body.questions&&typeof body.questions==='object'){
    body.questions=compactPass2QuestionsResidual(body.questions);trimStepsApplied.push('PASS2_RESIDUAL_QUESTION_TIGHT');serialized=refresh();
  }
  if(pass===2&&byteSize(body)>targetCap&&state.record&&typeof state.record==='object'&&state.record.attention&&Array.isArray(state.record.executablePlanOptions)){
    state.record=compactPass2RecordResidual(state.record);trimStepsApplied.push('PASS2_RESIDUAL_RECORD_TIGHT');serialized=refresh();
  }
  if(pass===2&&byteSize(body)>targetCap&&state.experienceMemory&&typeof state.experienceMemory==='object'){
    state.experienceMemory=compactMemoryForPass2Residual(state.experienceMemory);trimStepsApplied.push('PASS2_RESIDUAL_MEMORY_TIGHT');serialized=refresh();
  }
  if(pass===2&&byteSize(body)>targetCap){
    if(state.professionalTraderCortex&&typeof state.professionalTraderCortex.reference==='string'){state.professionalTraderCortex.reference=compactCortexReference(state.professionalTraderCortex.reference,1000);state.professionalTraderCortex.residualCompacted=true;}
    if(state.dynamicKnowledge&&Array.isArray(state.dynamicKnowledge.entries)){state.dynamicKnowledge.entries=compactKnowledgeEntries(state.dynamicKnowledge.entries,1).map(x=>({...x,summary:clipNatural(x.summary||'',160),keyPoints:(x.keyPoints||[]).slice(0,1).map(v=>clipNatural(v,96))}));state.dynamicKnowledge.residualCompacted=true;}
    if(typeof state.description==='string')state.description=clipNatural(state.description,320);
    if(state.decisionContract&&typeof state.decisionContract==='object')state.decisionContract=compactPass2DecisionContractResidual(state.decisionContract);
    trimStepsApplied.push('PASS2_RESIDUAL_OPTIONAL_FINAL');serialized=refresh();
  }
  // R2544.30: routing and position management also need residual budgeting.
  // Leave questions, position geometry, management contract and current packet intact.
  if(pass!==2&&byteSize(body)>targetCap){
    if(state.experienceMemory&&typeof state.experienceMemory==='object'){
      const measured=state.experienceMemory;
      state.experienceMemory=compactMemoryForPass2Residual(measured);
      if(measured.tradeLessons&&state.experienceMemory.tradeLessons){
        state.experienceMemory.tradeLessons.current=compactMeasuredAggregate(measured.tradeLessons.current);
        state.experienceMemory.tradeLessons.symbol=compactMeasuredAggregate(measured.tradeLessons.symbol);
      }
      if(measured.caseMemoryByLane)state.experienceMemory.caseMemoryByLane=Object.fromEntries(Object.entries(measured.caseMemoryByLane).slice(0,4).map(([k,d])=>[k,{available:d?.available,samples:d?.samples,summary:compactMeasuredAggregate(d?.summary),counterexamples:compactMeasuredAggregate(d?.counterexamples)}]));
      state.experienceMemory.note='Measured outcomes and winner/loser counterexamples; soft context only, never an execution rule.';
    }
    if(state.professionalTraderCortex&&typeof state.professionalTraderCortex.reference==='string')state.professionalTraderCortex.reference=compactCortexReference(state.professionalTraderCortex.reference,700);
    if(state.dynamicKnowledge&&Array.isArray(state.dynamicKnowledge.entries))state.dynamicKnowledge.entries=compactKnowledgeEntries(state.dynamicKnowledge.entries,1).map(x=>({...x,summary:clipNatural(x.summary||'',160),keyPoints:(x.keyPoints||[]).slice(0,1).map(v=>clipNatural(v,96))}));
    // Optional worker prose must not displace current market/position truth. Structured evidence stays intact.
    const requested=state.record?.requestedEvidence;
    if(requested&&typeof requested==='object'&&typeof requested.text==='string'&&requested.text.length>1600){state.record.requestedEvidence={...requested,text:clipNatural(requested.text,1600),textProjected:true,textAuthority:'OPTIONAL_EVIDENCE_ONLY'};}
    trimStepsApplied.push('ROUTING_MANAGEMENT_RESIDUAL_OPTIONAL');serialized=refresh();
  }
  // R34: after optional prose and duplication are bounded, share repeated field
  // names using self-describing rows. Round-trip validation preserves every
  // remaining fact; protected truth and the mirror expand the serialized rows.
  if(byteSize(body)>targetCap&&state.coreMarketPacket){
    const packed=encodeMarketPacket(state.coreMarketPacket);
    if(packed.encoded){state.coreMarketPacket=packed.packet;wireEncoding={version:packed.packet.wire.version,beforeBytes:packed.beforeBytes,afterBytes:packed.afterBytes,schemaCount:packed.schemaCount,roundTripVerified:true};trimStepsApplied.push('LOSSLESS_MARKET_ROWS');}
  }
  if(management&&byteSize(body)>targetCap){
    const packed=encodeMarketPacket(state.record);
    if(packed.encoded){state.record=packed.packet;trimStepsApplied.push('LOSSLESS_MANAGEMENT_ROWS');}
  }
  // R42: live 05.10 management requests were still 49-54 kB after lossless rows and 100% blocked at the
  // 48 kB ceiling, so JEV never reviewed the open position. Requested evidence repeats facts already in
  // coreMarketPacket (frames, flow, depth, derivatives, narrative text): keep the requested/missing list and
  // a residual digest. Position, lifecycle, thesis and contract stay protected and untouched.
  if(management&&byteSize(body)>targetCap&&state.record&&typeof state.record==='object'){
    const rec=expandMarketPacket(state.record),ev=rec?.requestedEvidence;
    if(ev&&typeof ev==='object'&&!Array.isArray(ev)&&ev.residualCompacted!==true){
      rec.requestedEvidence={...compactPass2EvidenceResidual(ev),missing:Array.isArray(ev.missing)?ev.missing.slice(0,8):[],
        ...(ev.routingAvailable!==undefined?{routingAvailable:ev.routingAvailable}:{}),detailInCoreMarketPacket:true};
      const packed=encodeMarketPacket(rec);state.record=packed.encoded?packed.packet:rec;
      trimStepsApplied.push('MANAGEMENT_EVIDENCE_RESIDUAL');serialized=refresh();
    }
  }
  if(management&&byteSize(body)>targetCap&&typeof state.description==='string'&&state.description.length>MANAGEMENT_DESCRIPTION_COMPACT.length){
    state.description=MANAGEMENT_DESCRIPTION_COMPACT;trimStepsApplied.push('MANAGEMENT_DESCRIPTION_COMPACT');serialized=refresh();
  }
  // R38: lifecycle evidence must fit the existing routing/burst targets.
  // Only duplicated narrative prose is shortened; numeric frames, readouts,
  // active/retired zones and protected overlays all survive exactly.
  if([1,'BURST'].includes(pass)&&byteSize(body)>targetCap&&state.coreMarketPacket){
    const packet=expandMarketPacket(state.coreMarketPacket);
    if(packet.chartNarrative?.frames){
      for(const [tf,f] of Object.entries(packet.chartNarrative.frames))if(f&&typeof f==='object'){
        if(pass===1&&['5m','15m'].includes(tf)&&typeof f.line==='string')f.line=clipNatural(f.line,1200);
        else delete f.line;
      }
      packet.chartNarrative.readingInNumericFrames=true;
      packet.chartNarrative.semantics='Closed-bar interpretation; exact facts remain in numeric frames.';
      if(pass==='BURST')packet.chartNarrative.compactedForBurst=true;
      else packet.chartNarrative.compactedForRouting=true;
      const packed=encodeMarketPacket(packet);state.coreMarketPacket=packed.encoded?packed.packet:packet;
      if(packed.encoded)wireEncoding={version:packed.packet.wire.version,beforeBytes:packed.beforeBytes,afterBytes:packed.afterBytes,schemaCount:packed.schemaCount,roundTripVerified:true};
      trimStepsApplied.push(pass==='BURST'?'BURST_DUPLICATE_NARRATIVE_ONLY':'ROUTING_DUPLICATE_NARRATIVE_ONLY');
    }
  }
  // R42/R44 FIT_BEFORE_BLOCK: exceeding the hard ceiling would drop the JEV decision entirely. User rule
  // (05.10.2026): never send a half sentence. Numeric frames always stay complete; if still over the ceiling,
  // whole narrative lines are omitted (they restate those numbers) - other timeframe first, the lane's owner
  // timeframe last - then soft context goes to its smallest measured digest. Every omission is recorded.
  const fitOmitted=[];
  if(pass!=='BURST'&&byteSize(body)>hardCap&&state.coreMarketPacket){
    const rec=expandMarketPacket(state.record)||{};
    const lane=String(state.pass1Handoff?.laneFocus||'').toUpperCase();
    const owner=['5m','15m'].includes(String(rec?.lifecycle?.ownerTF||'').toLowerCase())?String(rec.lifecycle.ownerTF).toLowerCase():lane.startsWith('5M')?'5m':'15m';
    const packet=expandMarketPacket(state.coreMarketPacket);
    const frames=packet?.chartNarrative?.frames;
    if(frames&&typeof frames==='object'){
      const order=[...Object.keys(frames).filter(tf=>!['5m','15m'].includes(tf)),...['5m','15m'].filter(tf=>tf!==owner),owner];
      for(const tf of order){
        if(byteSize(body)<=hardCap)break;
        const f=frames[tf];if(!f||typeof f!=='object'||typeof f.line!=='string')continue;
        delete f.line;fitOmitted.push('NARRATIVE_LINE_'+tf.toUpperCase());
        packet.chartNarrative.readingInNumericFrames=true;
        packet.chartNarrative.omittedLines=fitOmitted.filter(x=>x.startsWith('NARRATIVE_LINE_')).map(x=>x.slice(15).toLowerCase());
        packet.chartNarrative.semantics='Closed-bar interpretation; exact facts remain in numeric frames. Omitted lines were removed whole, never cut.';
        const packed=encodeMarketPacket(packet);state.coreMarketPacket=packed.encoded?packed.packet:packet;
        if(packed.encoded)wireEncoding={version:packed.packet.wire.version,beforeBytes:packed.beforeBytes,afterBytes:packed.afterBytes,schemaCount:packed.schemaCount,roundTripVerified:true};
        serialized=refresh();
      }
      if(fitOmitted.length)trimStepsApplied.push('FIT_BEFORE_BLOCK_NARRATIVE_WHOLE_LINES');
    }
  }
  if(pass!=='BURST'&&byteSize(body)>hardCap){
    if(state.dynamicKnowledge&&typeof state.dynamicKnowledge==='object'&&Array.isArray(state.dynamicKnowledge.entries)&&state.dynamicKnowledge.entries.length)state.dynamicKnowledge={mode:state.dynamicKnowledge.mode||null,entries:[],omittedForBudget:true};
    if(state.professionalTraderCortex&&typeof state.professionalTraderCortex.reference==='string')state.professionalTraderCortex.reference=compactCortexReference(state.professionalTraderCortex.reference,500);
    if(state.experienceMemory&&typeof state.experienceMemory==='object')state.experienceMemory=compactMemoryForPass2Residual(state.experienceMemory);
    fitOmitted.push('SOFT_CONTEXT_MIN');trimStepsApplied.push('FIT_BEFORE_BLOCK_SOFT_CONTEXT_MIN');serialized=refresh();
  }
  // R2544.55: last step before a size block - drop the edge questions/context (decision proceeds without them).
  if(byteSize(body)>hardCap&&jevEdge.dropEdgeQuestions(body)>0){fitOmitted.push('EDGE_QUESTIONS');trimStepsApplied.push('FIT_BEFORE_BLOCK_EDGE_QUESTIONS');serialized=refresh();}
  serialized=refresh();const bytes=Buffer.byteLength(serialized,'utf8');
  const coreHashAfter=hashJson(protectedCoreTruth(body));const coreTruthProtected=coreHashBefore===coreHashAfter;
  const essentialBytes=byteSize(minimalEssentialEnvelope(body));
  const blockReason=!coreTruthProtected?'JEV_CONTEXT_TRUTH_CHANGED':bytes<=hardCap?null:(essentialBytes>hardCap?'JEV_CORE_CONTEXT_TOO_LARGE':'JEV_REQUEST_CONTEXT_TOO_LARGE');
  const diagnostics={pass,chars:serialized.length,bytes,beforeBytes,maxBytes:hardCap,targetBytes:targetCap,targetExceeded:bytes>targetCap,estimatedTokens:Math.ceil(bytes*0.6)+1024,estimateOnly:true,
    stateBytes:byteSize(body.state),questionsBytes:byteSize(body.questions),essentialBytes,secondaryTrimApplied:trimStepsApplied.length>0,trimStepsApplied,
    marketTrimApplied:trimStepsApplied.some(x=>['PATTERN_GEOMETRY','SWING_PIVOTS_TRENDLINES','DUP_FVG_SMC_TEXT','FIB_OTE_RAW','PATTERNS_TOP3_BOTH_SIDES_PER_TF','HIGHER_CONTEXT_SUMMARY','TIMING_FRAMES_SUMMARY'].includes(x)),
    sections:Object.fromEntries(Object.entries(state).map(([k,v])=>[k,byteSize(v)])),marketSectionsBefore,marketSectionsAfter:Object.fromEntries(Object.entries(state.coreMarketPacket||{}).map(([k,v])=>[k,byteSize(v)])),wireEncoding,coreTruthProtected,coreTruthHash:coreHashAfter,blockReason,
    fitBeforeBlock:trimStepsApplied.some(x=>x.startsWith('FIT_BEFORE_BLOCK')),fitOmitted,
    contextBudget:{policy:'R2544.25_PASS2_DYNAMIC_RESIDUAL_BUDGET',targetBytes:targetCap,hardMaxBytes:hardCap,usedBytes:bytes,remainingToTarget:Math.max(0,targetCap-bytes),remainingToHard:Math.max(0,hardCap-bytes),hardHeadroomBytes:hardCap-bytes,coreMarketPacketBytes:byteSize(state.coreMarketPacket),protectedCoreBytes:byteSize(protectedCoreTruth(body)),optionalBudgetBytes:Math.max(0,targetCap-byteSize(state.coreMarketPacket)),residualBudgetApplied:trimStepsApplied.some(x=>x.startsWith('PASS2_RESIDUAL_')||x.startsWith('MANAGEMENT_')||x.startsWith('FIT_BEFORE_BLOCK')||x==='ROUTING_MANAGEMENT_RESIDUAL_OPTIONAL'),coreTruthProtected,
      optionalSectionsCompacted:trimStepsApplied.filter(x=>['SEMANTIC_OPTIONAL_CONTEXT_PROJECTION','OPTIONAL_CONTEXT_TIGHT','PASS1_QUESTION_SCHEMA_COMPACT','PASS1_ROUTING_MEMORY_TIGHT','PASS2_QUESTION_SCHEMA_COMPACT','PASS2_RECORD_COMPACT','PASS2_MEMORY_TIGHT','PASS2_RESIDUAL_QUESTION_TIGHT','PASS2_RESIDUAL_RECORD_TIGHT','PASS2_RESIDUAL_MEMORY_TIGHT','PASS2_RESIDUAL_OPTIONAL_FINAL','ROUTING_MANAGEMENT_RESIDUAL_OPTIONAL','MANAGEMENT_EVIDENCE_RESIDUAL','MANAGEMENT_DESCRIPTION_COMPACT','FIT_BEFORE_BLOCK_SOFT_CONTEXT_MIN'].includes(x)),marketCompactionSteps:trimStepsApplied.filter(x=>['CHART_NARRATIVE_DEDUP','PATTERN_GEOMETRY','SWING_PIVOTS_TRENDLINES','DUP_FVG_SMC_TEXT','FIB_OTE_RAW','PATTERNS_TOP3_BOTH_SIDES_PER_TF','HIGHER_CONTEXT_SUMMARY','TIMING_FRAMES_SUMMARY','FIT_BEFORE_BLOCK_NARRATIVE_WHOLE_LINES'].includes(x)),coreMarketPriority:true}};
  return {ok:bytes<=hardCap&&coreTruthProtected,body,serialized,diagnostics};
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
  // Provider access failures are operational state, not a trading verdict. Keep a tiny,
  // sanitized status so Office can distinguish an upstream 401/403 from a strategic WAIT.
  let providerState={lastError:null,lastOkAt:null,consecutiveAuthFailures:0,blockedUntil:0};
  const AUTH_COOLDOWN_MS=60000;
  function providerMessage(data){
    const e=data&&typeof data==='object'?data.error:null;
    const raw=typeof e==='string'?e:(e&&typeof e==='object'?(e.message||e.code):null) ||
      (data&&typeof data==='object'?(data.message||data.code):null) || '';
    return String(raw).replace(/\s+/g,' ').trim().slice(0,240);
  }
  function providerCode(data){
    const e=data&&typeof data==='object'?data.error:null;
    const raw=(e&&typeof e==='object'&&e.code)||(data&&typeof data==='object'&&data.code)||null;
    return raw==null?null:String(raw).slice(0,80);
  }
  function providerStatus(){
    const now=clock();
    return {lastError:providerState.lastError,lastOkAt:providerState.lastOkAt,
      consecutiveAuthFailures:providerState.consecutiveAuthFailures,
      authCooldownActive:providerState.blockedUntil>now,
      retryAfterMs:Math.max(0,providerState.blockedUntil-now)};
  }
  function noteProviderError(status,data){
    const httpStatus=Number(status)||0;
    const authFailure=httpStatus===401||httpStatus===403;
    if(authFailure){providerState.consecutiveAuthFailures+=1;providerState.blockedUntil=clock()+AUTH_COOLDOWN_MS;}
    else {providerState.consecutiveAuthFailures=0;providerState.blockedUntil=0;}
    providerState.lastError={at:new Date(clock()).toISOString(),httpStatus,
      category:httpStatus===401?'UNAUTHORIZED':httpStatus===402?'INSUFFICIENT_CREDITS':httpStatus===403?'FORBIDDEN':httpStatus===429?'RATE_LIMITED':'HTTP_ERROR',
      code:providerCode(data),message:providerMessage(data)};
    return providerState.lastError;
  }
  function noteProviderOk(){
    providerState.lastOkAt=new Date(clock()).toISOString();providerState.lastError=null;
    providerState.consecutiveAuthFailures=0;providerState.blockedUntil=0;
  }

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
    const canReserveNextCall=u.spentUsd+cfg.reservePerCallUsd<=cfg.dailyCapUsd+1e-12;
    const nextResetAt=new Date((Math.floor(clock()/86400000)+1)*86400000).toISOString();
    return {
      ...u,
      softBudgetUsd:cfg.softBudgetUsd,
      dailyCapUsd:cfg.dailyCapUsd,
      remainingUsd,
      reservePerCallUsd:cfg.reservePerCallUsd,
      softLimitReached:cfg.softBudgetUsd>0&&u.spentUsd>=cfg.softBudgetUsd,
      canReserveNextCall,
      budgetCallBlocked:!canReserveNextCall,
      nextResetAt,
      hardLimitReached:!canReserveNextCall
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
      paidFallbackEnabled:false,provider:providerStatus(),budget:budgetStatus()
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
    if(providerState.blockedUntil>clock())return {ok:false,configured:true,required:true,called:false,attempted:false,
      reason:'JEV_PROVIDER_AUTH_COOLDOWN',httpStatus:providerState.lastError?.httpStatus||null,
      provider:providerStatus(),budget:budgetStatus()};
    const originalBody=body;
    let prepared=prepareDecisionRequest(body);
    let requestSize=prepared.diagnostics;
    // Metadata only: no market payload, account details, keys or response text.
    try{fs.mkdirSync(path.join(root,'logs'),{recursive:true});
      fs.appendFileSync(path.join(root,'logs','jev-request-size.log'),JSON.stringify({at:new Date(clock()).toISOString(),...requestSize,blocked:!prepared.ok})+'\n','utf8');
    }catch{}
    if(!prepared.ok)return {ok:false,configured:true,required:true,called:false,attempted:false,
      reason:prepared.diagnostics?.blockReason||'JEV_REQUEST_CONTEXT_TOO_LARGE',requestSize,budget:budgetStatus()};
    body=prepared.body;
    const reservation=reserve?reserveBudget():{ok:true,reservedUsd:0};
    if(!reservation.ok)return {ok:false,configured:true,required:true,called:false,attempted:false,reason:'JEV_DAILY_BUDGET_EXHAUSTED',budget:budgetStatus()};
    const started=clock();
    const transientHttp=new Set([408,425,429,500,502,503,504]);
    let attempts=0;
    try{
      let r=null;
      let lastError=null;
      for(attempts=1;attempts<=2;attempts++){
        try{
          r=await fetchJson(fetchImpl,cfg.decisionsUrl,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:prepared.serialized},cfg.timeoutMs);
          if(r.ok||!transientHttp.has(Number(r.status))||attempts>=2)break;
        }catch(e){
          lastError=e;
          if(attempts>=2)throw e;
        }
        // One short retry only. This is a decision API call, never an order submit.
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      if(!r){
        if(lastError)throw lastError;
        throw new Error('JEV_DECISION_NO_RESPONSE');
      }
      // CLAUDE_R2544_7_CONTEXT_RETRY: 29.09 03:20 OP pozisyon incelemesi 51.635 baytta 400 max_tokens_exceeded aldı; JEV stoptan
      // 1 dk önce karar veremedi. Bu yanıtta paket 44.000 bayta budanıp BİR kez yeniden gönderilir (emir değil, karar çağrısı).
      if(!r.ok&&Number(r.status)===400&&requestSize.bytes>44000&&JSON.stringify(r.data||'').includes('max_tokens_exceeded')){
        const smaller=prepareDecisionRequest(originalBody,{maxBytes:44000,targetBytes:42000});
        if(smaller.ok&&smaller.diagnostics.bytes<requestSize.bytes){
          try{fs.appendFileSync(path.join(root,'logs','jev-request-size.log'),JSON.stringify({at:new Date(clock()).toISOString(),...smaller.diagnostics,retryAfter:'MAX_TOKENS_EXCEEDED',blocked:false})+'\n','utf8');}catch{}
          prepared=smaller;requestSize={...smaller.diagnostics,contextRetry:true};body=prepared.body;attempts+=1;
          try{r=await fetchJson(fetchImpl,cfg.decisionsUrl,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:prepared.serialized},cfg.timeoutMs);}catch(e){lastError=e;}
          if(!r)throw lastError||new Error('JEV_DECISION_NO_RESPONSE');
        }
      }
      if(!r.ok){
        if(reserve)settleBudget(reservation,cfg.reservePerCallUsd);
        const pe=noteProviderError(r.status,r.data);
        try{fs.appendFileSync(path.join(root,'logs','jev-http-error.log'),JSON.stringify({
          at:new Date(clock()).toISOString(),reason:'JEV_HTTP_ERROR',httpStatus:r.status,providerCategory:pe.category,
          providerCode:pe.code,providerMessage:pe.message,consecutiveAuthFailures:providerState.consecutiveAuthFailures,
          requestSize,contextExceeded:JSON.stringify(r.data).includes('max_tokens_exceeded')})+'\n','utf8');}catch{}
        return {ok:false,configured:true,required:true,reason:'JEV_HTTP_ERROR',httpStatus:r.status,provider:providerStatus(),requestSize,attempts,durationMs:clock()-started,detail:JSON.stringify(r.data).slice(0,500),budget:budgetStatus()};
      }
      noteProviderOk();
      const cost=reserve?usageCost(r.data,cfg.reservePerCallUsd,body):0;
      try{fs.appendFileSync(path.join(root,'logs','jev-request-result.log'),JSON.stringify({
        at:new Date(clock()).toISOString(),pass:requestSize.pass,bytes:requestSize.bytes,
        httpStatus:r.status,inputTokens:r.data?.usage?.input_tokens??r.data?.usage?.prompt_tokens??null})+'\n','utf8');}catch{}
      if(reserve)settleBudget(reservation,cost);
      const sentPacket=JSON.parse(prepared.serialized)?.state?.coreMarketPacket;
      return {ok:true,configured:true,required:true,data:r.data,jevSeen:sentPacket?mirrorDigest(sentPacket):null,requestSize,attempts,durationMs:clock()-started,costUsd:cost,budget:budgetStatus()};
    }catch(e){
      if(reserve)settleBudget(reservation,cfg.reservePerCallUsd);
      return {ok:false,configured:true,required:true,reason:'JEV_REQUEST_ERROR',attempts,durationMs:clock()-started,detail:String(e?.message||e).slice(0,300),budget:budgetStatus()};
    }
  }

  async function sovereignPass1({candidate,unified}={}){
    if(!configured)return {ok:false,configured:false,required:cfg.enabled,called:false,pass:1,reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    const record=sovereignAttentionRecord(candidate,unified);
    const liveContext=liveReasoningContext(root,unified?.learning);
    const coreMarket=marketPacket(unified);
    const snapshotHash=hashJson(protectedCoreTruth({state:{coreMarketPacket:coreMarket}})).slice(0,24);
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
    questions.knowledge_research={
      type:'choice',
      instructions:'Is there a material trading concept, formation, indicator, microstructure term, derivatives concept or execution concept in the supplied state that is not adequately covered by the professional Cortex/dynamic knowledge? Request research only for a real knowledge gap, never just to delay a decision.',
      criteria:{SKIP:'Existing verified knowledge is adequate for this decision.',RESEARCH_IF_GAP:'A material knowledge gap should be researched by the free-model research desk before PASS-2.'}
    };
    questions.knowledge_family={
      type:'choice',
      instructions:'If research is requested, choose the closest family. This routes research only; it never approves a trade.',
      criteria:{AUTO:'Let BrainHub detect the unfamiliar term.',PATTERN:'Chart/candlestick formation.',INDICATOR:'Indicator or quantitative transform.',MICROSTRUCTURE:'Order flow/depth/tape concept.',DERIVATIVES:'OI/funding/liquidation/positioning concept.',EXECUTION:'Futures execution/risk mechanics.',OTHER:'Other trading knowledge.'}
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
        description:'JEV PASS-1 is the sole strategic evidence director. chartOverlayLevels carries protected trendLines and breakoutEvidence for every TF; closed-candle rejections are observations, never predictions or automatic vetoes. Radar is ATTENTION_ONLY; JEV chooses lane, direction and only material extra evidence. Chart evidence is fulfilled in the mainline by deterministic closed-candle chartNarrative without GPU/VLM; Vision is audit-on-demand only and never overrides numeric truth. coreMarketPacket.levelMap lists the nearest levels for location/path reasoning. Frame readout (closed candles, compact) is context, not a vote. experienceMemory.tradeLessons is YOUR OWN measured P&L and remains soft context with winners and losses. Numeric Binance/BrainHub truth outranks visual interpretation. Missing optional evidence is not negative evidence.',
        decisionContract:{version:'R2544.26',authority:'JEV_FINAL',phase:'PASS1_EVIDENCE_ROUTING',lanes:['5M_SCALP','15M_TRADE'],rules:['NO_FIXED_SCORE','NO_2_OF_3','NO_HARD_15M_VETO','FORMING_CANDLE_CONTEXT_ONLY'],microstructure:'R2544.26 PREENTRY EVIDENCE_ONLY; active-symbol sequence-safe local L2 is confidence-weighted; samplingConfidence keeps SPARSE/VERY_SPARSE windows down-weighted, depth20 remains fallback, SPARSE/RESYNC/UNAVAILABLE is never a veto; never infer participant identity/intent.',memory:'MEASURED_SOFT_CONTEXT_WINNERS_PLUS_COUNTEREXAMPLES_NO_HARD_RULE; MFE/MAE, repeat/flip/NONE_WAIT and exit-authority are context only.',frameLegend:'st=stretch/location; ch=side chase risk; sq=squeeze; dp=displacement/retrace; pl=liquidity clusters; ef=exhaustion. Use by relevance, never as vote counting.'},
        professionalTraderCortex:liveContext.professionalTraderCortex,
        dynamicKnowledge:liveContext.dynamicKnowledge,
        experienceMemory:liveContext.experienceMemory,
        coreMarketPacket:coreMarket,
        record
      },
      questions
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok){const notCalled=out.called===false;return {...out,called:!notCalled,attempted:!notCalled,pass:1,mode:'SOVEREIGN_CHOICE'};}
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const laneFocus=choiceValue(answers.lane_focus);
    const directionFocus=choiceValue(answers.direction_focus);
    const rawKnowledgeResearch=choiceValue(answers.knowledge_research)||'SKIP';
    const knowledgeResearch=['SKIP','RESEARCH_IF_GAP'].includes(rawKnowledgeResearch)?rawKnowledgeResearch:'SKIP';
    const rawKnowledgeFamily=choiceValue(answers.knowledge_family)||'AUTO';
    const knowledgeFamily=['AUTO','PATTERN','INDICATOR','MICROSTRUCTURE','DERIVATIVES','EXECUTION','OTHER'].includes(rawKnowledgeFamily)?rawKnowledgeFamily:'AUTO';
    const requestedEvidence=[];
    for(const [id] of SOVEREIGN_EVIDENCE){
      const v=choiceValue(answers['evidence_'+id.toLowerCase()]);
      if(v==='REQUEST')requestedEvidence.push(id);
    }
    if(!laneFocus||!directionFocus)return {ok:false,configured:true,required:true,called:true,pass:1,reason:'JEV_SOVEREIGN_PASS1_SCHEMA_MISMATCH',mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    return {
      ok:true,configured:true,required:true,called:true,pass:1,finalAuthority:'JEV',
      laneFocus,directionFocus,requestedEvidence,snapshotHash,
      knowledgeResearchRequested:knowledgeResearch==='RESEARCH_IF_GAP',knowledgeFamily,
      model:cfg.model,mode:'SOVEREIGN_CHOICE',durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget
    };
  }

  async function sovereignFinal({candidate,unified,evidence,planOptions,pass1=null}={}){
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
        'basis='+String(p.basis||'STRUCTURE'),
        // CLAUDE_R2544_5_GEOMETRY: ölçü; karar JEV'in.
        ...(Number.isFinite(Number(p.stopPct))?['stopDistance='+p.stopPct+'%'+(Number.isFinite(Number(p.stopAtr))?' ('+p.stopAtr+'x '+p.originTF+' ATR)':'')]:[]),
        ...(p.geometryNote?['geometry='+p.geometryNote]:[]),
        ...(p.formingOwnerTF&&p.formingOwnerTF.changeAtr!==null?['forming '+p.originTF+' candle (not closed) '+p.formingOwnerTF.direction+' '+p.formingOwnerTF.changeAtr+' ATR'+(p.formingOwnerTF.againstSide?' AGAINST this side':'')]:[])
      ].join(' | ');
    }
    const liveContext=liveReasoningContext(root,unified?.learning);
    const coreMarket=marketPacket(unified);
    const boundedEvidence=compactSovereignEvidence(evidence,Math.min(9000,Math.max(4500,PASS2_TARGET_BYTES-37000)));
    const edgeQ=jevEdge.buildEdgeQuestions(plans); // R2544.55
    const body={
      model:cfg.model,
      state:{
        ...(Object.keys(edgeQ.questions).length?{edgeContext:jevEdge.EDGE_CONTEXT}:{}),
        description:'JEV PASS-2 final strategic choice. Read protected chartOverlayLevels trendLines and breakoutEvidence per TF; rejected breaks are observations, not a guaranteed reversal or automatic veto. 5M_SCALP is a professional scalper desk; 15M_TRADE is a professional trader desk. Choose one supplied executable plan or WAIT. WAIT is an active strategic decision that requires a concrete market reason, not generic uncertainty. Weight evidence by freshness, independence, reliability and relevance; disagreement is normal. MARKET_NOW requires coherent direction, location, invalidation, execution quality and remaining path; when those are already sound, do not demand textbook confirmation before MARKET_NOW. coreMarketPacket.levelMap lists the nearest levels for location, stop and remaining path. Read exact core-frame OB boundaries and priceAction confirmations; distinguish internal versus swing/prior10 scope, full-range versus rejection zones, origin versus confirmation time and mitigated/broken/reclaimed state. A 5m zone is not a 15m zone. These observations are not automatic trade permission. FVG lifecycle is closed-bar evidence: fillPct is penetration depth, never probability; testCount counts separate visits, ce50Touched requires actual overlap, INVALIDATED is a close beyond the far boundary. reaction is observed relative to the entry-side edge and excludes first-touch-bar extrema from subsequent excursion; it is not a prediction or a rule. Frame readout (closed candles, compact), volatility spike/extAtr/trail and order-block context are soft closed-candle context for chase risk and location, never a checklist, threshold or veto. experienceMemory.tradeLessons is YOUR OWN measured P&L and remains soft context with winners and losses.',
        decisionContract:{version:'R2544.26',authority:'JEV_FINAL',phase:'PASS2_FINAL',lanes:{'5M_SCALP':'prioritize immediate execution,1m/3m timing,5m structure,spread/flow/depth,near liquidity','15M_TRADE':'prioritize 15m structure/location/invalidation/liquidity path; lower-TF noise alone is not a veto'},rules:['NO_MANDATORY_CHECKLIST','NO_FIXED_SCORE','NO_2_OF_3','NO_HARD_15M_VETO','NUMERIC_TRUTH_OVER_VISUAL','OPTIONAL_MISSING_NOT_NEGATIVE'],microstructure:'R2544.26 PREENTRY is timing evidence only; sequence-safe local L2 is used only when healthy/confident; samplingConfidence down-weights SPARSE/VERY_SPARSE windows, depth20 is fallback, missing/resync L2 is not negative evidence or a hard gate.',memory:'MEASURED_SOFT_CONTEXT_WINNERS_PLUS_COUNTEREXAMPLES; MFE giveback, fast adverse move, repeat/flip/NONE_WAIT and exitAuthority are soft analog context only; current market evidence overrides history.',knowledge:'Do not invent unfamiliar concepts; choose WAIT when a material knowledge gap remains.'},
        professionalTraderCortex:liveContext.professionalTraderCortex,
        dynamicKnowledge:liveContext.dynamicKnowledge,
        experienceMemory:liveContext.experienceMemory,
        pass1Handoff:pass1?{laneFocus:pass1.laneFocus||null,directionFocus:pass1.directionFocus||null,requestedEvidence:Array.isArray(pass1.requestedEvidence)?pass1.requestedEvidence.slice(0,12):[],knowledgeResearchRequested:pass1.knowledgeResearchRequested===true,knowledgeFamily:pass1.knowledgeFamily||null,snapshotHash:pass1.snapshotHash||null}:null,
        coreMarketPacket:coreMarket,
        record:{
          attention:sovereignAttentionRecord(candidate,unified),
          requestedEvidence:boundedEvidence,
          executablePlanOptions:plans
        }
      },
      questions:{
        ...edgeQ.questions,
        trade_plan:{
          type:'choice',
          instructions:'Choose the single best action now. Select one supplied executable plan only when direction, lane, timing, location and risk geometry are justified by the complete core market packet plus requested evidence; otherwise choose WAIT. Explicitly weigh the supplied geometryNote, stopAtr and formingOwnerTF: a stop inside owner-frame noise with adverse live movement is not made sound by a supportive aggregate flow label. For countertrend mean reversion distinguish observed rejection from an accepted break or squeeze; oversold/overbought alone does not establish exhaustion. JEV retains the strategic choice; these are evidence considerations, not new code vetoes.',
          criteria
        },
        setup_family:{
          type:'choice',
          instructions:'Classify the actual setup family for measured learning. Do not use a generic lane label.',
          criteria:{
            TREND_PULLBACK:'Trend continuation after a controlled pullback.',
            BREAKOUT_RETEST:'Breakout with acceptance/retest and remaining path.',
            SWEEP_RECLAIM:'Liquidity sweep followed by reclaim/acceptance.',
            FAILED_BREAKOUT:'Failed breakout/trap reversal.',
            RANGE_FADE:'Range extreme rejection toward equilibrium/opposite boundary.',
            MOMENTUM_CONTINUATION:'Immediate continuation with enough room and execution quality.',
            MEAN_REVERSION:'Exhaustion/stretched location reverting toward a credible mean.',
            SQUEEZE_CROWDING:'Squeeze/crowding setup supported by derivatives/liquidity.',
            STRUCTURAL_REVERSAL:'Structure transition/reversal with coherent invalidation.',
            NONE_WAIT:'No trade setup is strong enough now; use with WAIT.'
          }
        },
        entry_timing:{
          type:'choice',
          instructions:'Decide whether this is actually an entry NOW. If direction may be right but location/timing is not, choose a WAIT_* timing.',
          criteria:{
            MARKET_NOW:'Current price is a justified entry location now.',
            WAIT_PULLBACK:'Wait for a better pullback into structure/OB/FVG/OTE location.',
            WAIT_BREAKOUT_RETEST:'Wait for breakout acceptance and/or retest.',
            WAIT_SWEEP_RECLAIM:'Wait for the relevant liquidity sweep and reclaim/rejection.',
            WAIT_STRUCTURE_CLOSE:'Wait for a confirming closed-candle structure event.',
            WAIT_NEW_EVIDENCE:'Wait for materially changed evidence.'
          }
        },
        wait_reason:{
          type:'choice',
          instructions:'Explain why entry is not MARKET_NOW. This is diagnostic discipline, not an extra veto. Choose NONE_MARKET_NOW only when a concrete plan is selected and current entry is justified. Any WAIT_* timing must have one specific reason rather than generic uncertainty.',
          criteria:{
            NONE_MARKET_NOW:'Current location and execution quality justify entry now.',
            LOCATION_POOR:'Direction/setup may be valid but current price is a poor location or too extended.',
            STRUCTURE_UNCONFIRMED:'A specific closed-candle structure event is still materially required.',
            BREAKOUT_RETEST_REQUIRED:'Breakout acceptance/retest is materially required before entry.',
            SWEEP_RECLAIM_REQUIRED:'A specific liquidity sweep/reclaim or rejection is materially required.',
            EDGE_INSUFFICIENT:'Available evidence does not provide enough edge right now.',
            ADVERSE_SELECTION_RISK:'The setup direction may remain valid, but current public order-flow/depth behavior makes immediate entry vulnerable to being trapped; wait for flow normalization/new evidence.',
            DATA_QUALITY:'Material market/execution data is stale, missing, or unreliable.',
            KNOWLEDGE_GAP:'A material concept is not understood well enough to act without verified research.'
          }
        },
        edge_basis:{
          type:'choice',
          instructions:'Identify the primary evidence family carrying the edge. Diagnostic/learning context only.',
          criteria:{
            STRUCTURE_LOCATION:'Structure plus location/dealing range.',
            LIQUIDITY_SMC:'Sweep/reclaim, FVG, OB, OTE/Fib or liquidity geometry.',
            ORDER_FLOW_DEPTH:'Order-flow/CVD/depth/microstructure.',
            DERIVATIVES_POSITIONING:'OI/funding/taker/positioning/liquidations.',
            PATTERN_PRICE_ACTION:'Classical/candlestick pattern plus price action.',
            COMBINATION:'Coherent combination; no single family dominates.',
            NO_EDGE:'No robust edge.'
          }
        },
        pre_entry_flow_assessment:{
          type:'choice',
          instructions:'Read coreMarketPacket.microstructure.preEntryAdverseSelection for the selected direction. Support/risk indices share a total evidence-weight denominator; opposing price progress and accepted breaks must not be discarded because resting book imbalance favors the plan. A rejection that was reclaimed inside a closed range is historical evidence, not proof that the current forming breakout will fail. This is diagnostic telemetry for JEV entry timing, not a hard gate and not a probability. Sequence-safe local L2 is higher-quality when healthy; depth20 is fallback. Warming/sparse/resync/unavailable L2 is DATA_INSUFFICIENT, never negative evidence by itself. If usable public flow/depth is materially adverse to entry now choose TRAP_RISK_WAIT even when the higher-level setup remains valid.',
          criteria:{
            SUPPORTS_PLAN:'Pre-entry microstructure materially supports immediate execution for the selected side.',
            NEUTRAL_OR_MIXED:'Pre-entry flow is usable but not directionally decisive.',
            TRAP_RISK_WAIT:'The directional thesis may remain valid, but immediate adverse-selection/trap evidence makes MARKET_NOW inferior.',
            DATA_INSUFFICIENT:'The pre-entry layer is warming, sparse, stale or otherwise not reliable enough to influence timing.'
          }
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
    if(!out.ok){const notCalled=out.called===false;return {...out,called:!notCalled,attempted:!notCalled,pass:2,mode:'SOVEREIGN_CHOICE'};}
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const selectedId=choiceValue(answers.trade_plan);
    const setupFamily=choiceValue(answers.setup_family);
    const rawEntryTiming=choiceValue(answers.entry_timing);
    const entryTiming=selectedId==='WAIT'&&rawEntryTiming==='MARKET_NOW'?'WAIT_UNSPECIFIED':rawEntryTiming;
    const waitReasonRaw=choiceValue(answers.wait_reason);
    const edgeBasis=choiceValue(answers.edge_basis);
    const preEntryFlowAssessment=choiceValue(answers.pre_entry_flow_assessment)||null;
    const managementStyle=choiceValue(answers.management_style);
    const targetProfile=choiceValue(answers.target_profile);
    const partialProfile=choiceValue(answers.partial_profile);
    const breakevenRule=choiceValue(answers.breakeven_rule);
    const trailRule=choiceValue(answers.trail_rule);
    const validWaitReasons=new Set(['NONE_MARKET_NOW','LOCATION_POOR','STRUCTURE_UNCONFIRMED','BREAKOUT_RETEST_REQUIRED','SWEEP_RECLAIM_REQUIRED','EDGE_INSUFFICIENT','ADVERSE_SELECTION_RISK','DATA_QUALITY','KNOWLEDGE_GAP']);
    const waitReason=entryTiming==='MARKET_NOW'?'NONE_MARKET_NOW':
      (validWaitReasons.has(waitReasonRaw)&&waitReasonRaw!=='NONE_MARKET_NOW'?waitReasonRaw:'UNSPECIFIED');
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
    const jevEdgeResult=jevEdge.parseEdge(answers,plans,selectedId,edgeQ.map); // R2544.55: probabilities + confidence kept
    const consistency=sovereignFinalConsistency({selectedId,selectedPlan,setupFamily,entryTiming,waitReasonRaw,edgeBasis,preEntryFlowAssessment,coreMarket});
    if(!consistency.ok){
      return {ok:false,configured:true,required:true,called:true,pass:2,finalAuthority:false,reason:'JEV_SOVEREIGN_FINAL_SEMANTIC_CONTRADICTION',consistencyIssues:consistency.issues,selectedPlanId:selectedId,setupFamily:setupFamily||null,entryTiming:entryTiming||null,waitReasonRaw:waitReasonRaw||null,edgeBasis:edgeBasis||null,preEntryFlowAssessment,mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    }
    return {
      ok:true,configured:true,required:true,called:true,pass:2,finalAuthority:true,veto:false,
      action:selectedId==='WAIT'?'WAIT':selectedPlan.side,
      selectedPlanId:selectedId,selectedPlan,setupFamily:setupFamily||null,entryTiming:entryTiming||null,waitReason,edgeBasis:edgeBasis||null,preEntryFlowAssessment,
      managementStyle,targetProfile,partialProfile,breakevenRule,trailRule,evidenceTrimmed:boundedEvidence.evidenceTrimmed===true,
      jevEdge:jevEdgeResult,
      jevSeen:out.jevSeen,requestSize:out.requestSize,
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
      },
      // CLAUDE_R2544_16_TRADE_LESSONS: deterministik ders kartı (etiketler + karar) ve karşılaştırılabilir geçmiş.
      lessonCard:src.lessonCard&&typeof src.lessonCard==='object'?src.lessonCard:null,
      comparable:src.comparable&&typeof src.comparable==='object'?src.comparable:null
    };
    const cortex=traderCortexReference(root);
    const dynamic=dynamicKnowledgeReference(root);
    const body={
      model:cfg.model,
      state:{
        description:'JEV is the BrainHub teacher for closed-trade learning. Use the professional trader/scalper Cortex plus only JEV-verified dynamic knowledge when interpreting the measured outcome, but keep the result SHADOW-only. Do not create hard rules, scores, vetoes, automatic code changes, or auto-promotion. A single trade must not become a mandatory rule. record.lessonCard carries deterministic tags of this trade (attention tier, re-entry gap, stop width, exit type, oversized loss, leader chase) and record.comparable carries the measured history of comparable trades (same attention tier and side, same setup family and side, and the tags that repeat). When comparable history has at least 5 samples that point the same way, do not answer OBSERVE_MORE: choose UPWEIGHT_SOFT or DOWNWEIGHT_SOFT for the focus that the evidence supports. OBSERVE_MORE is only for thin or contradictory history.',
        professionalTraderCortex:cortex.loaded?{version:cortex.version,mode:cortex.mode,reference:cortex.text}:null,
        dynamicKnowledge:dynamic.loaded?{mode:dynamic.mode,entries:dynamic.entries}:null,
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
    if(!out.ok)return {...out,called:out.called!==false,teacher:'JEV',mode:'SOVEREIGN_SHADOW_TEACHER'};
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


  async function sovereignKnowledgeReview({topic,family,router,openRouter,sources}={}){
    if(!configured)return {ok:false,configured:false,called:false,verdict:'REJECT',reason:'JEV_KEY_UNAVAILABLE'};
    const body={
      model:cfg.model,
      state:{
        description:'JEV research gate. Decide whether this read-only knowledge note is sufficiently grounded to enter the dynamic trading knowledge reference. It must never change code, capital settings, risk limits, permissions, or hard safety. Model agreement without fetched source evidence is insufficient.',
        record:{
          topic:String(topic||'').slice(0,120),family:String(family||'OTHER').slice(0,32),
          router:router||null,openRouter:openRouter||null,
          verifiedSources:Array.isArray(sources)?sources.slice(0,4):[],
          authority:{application:'READ_ONLY_KNOWLEDGE_REFERENCE',selfModify:false,autoPromotionToRules:false,executionAuthority:false}
        }
      },
      questions:{
        research_verdict:{
          type:'choice',
          instructions:'Accept only if the supplied fetched source excerpts materially support the research summary and there is no important unsupported claim. Reject hallucinated, contradictory, source-free, identity/intent speculation, or trading-rule promotion.',
          criteria:{ACCEPT_REFERENCE:'Grounded enough for a read-only knowledge reference.',REJECT:'Not sufficiently grounded or contains unsupported claims.',RESEARCH_MORE:'Potentially useful, but evidence is incomplete or conflicting.'}
        }
      }
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:out.called!==false,verdict:'REJECT'};
    const verdict=choiceValue(out.data?.answers?.research_verdict);
    if(!['ACCEPT_REFERENCE','REJECT','RESEARCH_MORE'].includes(verdict))return {ok:false,called:true,verdict:'REJECT',reason:'JEV_KNOWLEDGE_REVIEW_SCHEMA_MISMATCH',budget:out.budget,costUsd:out.costUsd};
    return {ok:true,called:true,verdict,model:cfg.model,mode:'SOVEREIGN_KNOWLEDGE_REVIEW',durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget};
  }

  // R2544.29 BURST_SCALP: JEV pre-authorizes only a short-lived conditional watch.
  // This call never places an order. A later deterministic WebSocket ignition must independently
  // satisfy direction/TTL/strictness before the PC-only burst executor may act.
  async function sovereignBurstArm({candidate,preMove,stream,chartContext=null,position=null,pause=null,learning=null}={}){
    if(!configured)return {ok:false,configured:false,required:cfg.enabled,called:false,decision:'DO_NOT_ARM',reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    const symbol=String(candidate?.symbol||stream?.symbol||'').toUpperCase();
    if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))return {ok:false,called:false,decision:'DO_NOT_ARM',reason:'BURST_SYMBOL_INVALID'};
    if(!chartContext?.packet||chartContext.symbol!==symbol||chartContext.available!==true)return {ok:false,called:false,decision:'DO_NOT_ARM',reason:'BURST_CHART_CONTEXT_NOT_READY'};
    const compact={
      contract:'R2544.29_BURST_PREAUTH',symbol,
      radar:{source:candidate?.deepScanReason||candidate?.burstReason||null,sideHint:candidate?.burstSideHint||null,targetSources:Array.isArray(candidate?.targetSources)?candidate.targetSources.slice(0,8):[],gainerRank:finiteNumber(candidate?.gainerRank),projectedGainerRank:finiteNumber(candidate?.projectedGainerRank),gainerRankVelocity:finiteNumber(candidate?.gainerRankVelocity),loserRank:finiteNumber(candidate?.loserRank),projectedLoserRank:finiteNumber(candidate?.projectedLoserRank),loserRankVelocity:finiteNumber(candidate?.loserRankVelocity),change24hPct:finiteNumber(candidate?.change24hPct??candidate?.priceChangePercent),shortChangePct:finiteNumber(candidate?.shortChangePct),shortPer5mPct:finiteNumber(candidate?.shortPer5mPct)},
      preMove:preMove&&typeof preMove==='object'?{state:preMove.state||null,direction:preMove.direction||null,priority:finiteNumber(preMove.priority),frame:preMove.frame||null,triggers:preMove.triggers||null,reasons:Array.isArray(preMove.reasons)?preMove.reasons.slice(0,8):[]}:null,
      stream:stream&&typeof stream==='object'?{
        available:stream.available===true,ageMs:finiteNumber(stream.ageMs),spreadBps:finiteNumber(stream.spreadBps),
        // R2544.46: trade-clock flow (never empty on thin coins) replaces the fixed 1s/3s/5s windows.
        orderFlow:burstFlowDigest(stream),
        level1Ofi:{fast:burstOfiDigest(stream?.level1Ofi?.eventClock?.fast),slow:burstOfiDigest(stream?.level1Ofi?.eventClock?.slow)},
        localL2:stream?.localL2?{available:stream.localL2.available===true,sequenceHealthy:stream.localL2.sequenceHealthy===true,ageMs:finiteNumber(stream.localL2.ageMs),confidence:finiteNumber(stream.localL2.confidence),multiLevelOfi:finiteNumber(stream.localL2.multiLevelOfi),depthImbalance:finiteNumber(stream.localL2.depthImalance??stream.localL2.depthImbalance),wallPersistence:stream.localL2.wallPersistence||null,liquidityPull:stream.localL2.liquidityPull||null,replenishment:stream.localL2.replenishment||null,absorption:stream.localL2.absorption||null}:null
      }:null,
      existingPosition:position?{symbol:String(position.symbol||'').toUpperCase(),side:String(position.side||'').toUpperCase(),quantity:finiteNumber(position.quantity),ownerTF:position.ownerTF||null}:null,
      lossStreakPause:pause?{active:true,streak:Number(pause.streak)||0,remainingMin:Number(pause.remainingMin)||null}:null
    };
    const body={
      model:cfg.model,
      state:{description:'JEV conditional preauthorization, never an entry order. Select ONE LONG/SHORT symbol for a PC-only burst watcher. Read closed-candle OB/FVG/Fib/OTE, protected trendLines/breakoutEvidence (age/stillInside), Office overlays and higher context. Timeframes are context, not votes; 45m is synthetic. Current record.stream is timing evidence; cached packet flow is historical. Missing/stale data is not confirmation. Plausible compression/pre-move/location can authorize BEFORE ignition; do not demand the later trigger now. stream.orderFlow is a TRADE CLOCK (fast>=20 trades, slow>=60; noiseBps20=typical 20-trade move): an empty 1s window on a thin coin is not missing data; FLOW gap only if fast <8 trades. Missing OFI is neutral. Execution later needs fresh stream, spread<=8bps, sequence-safe L2, trade-clock trigger. Another-symbol core trade permits a separate burst slot. At most one unusually strict exception per 2-loss/30m pause. Never infer participant identity or bypass exchange safety.',record:compact,experienceMemory:compactExperienceMemory(learning,3500),coreMarketPacket:chartContext.packet,chartCache:{asOf:chartContext.asOf,ageMs:chartContext.ageMs,source:chartContext.source}},
      questions:{
        burst_decision:{type:'choice',instructions:'Pre-authorize a conditional burst direction or do not arm.',criteria:{ARM_LONG:'Arm LONG only; later trigger may execute LONG.',ARM_SHORT:'Arm SHORT only; later trigger may execute SHORT.',DO_NOT_ARM:'Do not arm this symbol now.'}},
        burst_reason:{type:'choice',instructions:'Report the primary reason for this conditional authorization or refusal. Do not confuse preauthorization with an entry order.',criteria:{EARLY_EXPANSION:'Plausible early expansion; watcher must confirm ignition.',LOCATION_ADVERSE:'Location/remaining path is adverse.',FLOW_ADVERSE:'Observed public flow is adverse.',DATA_NOT_READY:'Material data is unavailable/stale.',NO_EARLY_EDGE:'No credible early expansion setup.',POSITION_CONFLICT:'Same-symbol opposite core position.',RISK_OR_PAUSE:'Risk or pause makes this authorization unsuitable.'}},
        burst_data_gap:{type:'choice',instructions:'Identify DATA_NOT_READY subsystem; otherwise NO_GAP.',criteria:{NO_GAP:'None.',CHART:'Closed chart.',STREAM:'Freshness.',L2:'Local book.',FLOW:'Trades/OFI.',DERIVATIVES:'Derivatives.',OTHER:'Other evidence.'}},
        ttl:{type:'choice',instructions:'How long may this authorization wait for ignition?',criteria:{TTL_120S:'120 seconds',TTL_180S:'180 seconds'}},
        trigger_strictness:{type:'choice',instructions:'Trade-clock trigger score threshold.',criteria:Object.fromEntries(Object.entries(BURST_STRICTNESS).map(([k,v])=>[k,'score >='+v.toFixed(2)]))},
        leverage_mode:{type:'choice',instructions:'User burst mandate: highest safe leverage, never above 25x; not panel leverage.',criteria:{MAX_SAFE:'Highest exchange-allowed leverage up to 25x passing burst stop safety.'}},
        pause_exception:{type:'choice',instructions:'If the account is currently in the 2-loss/30m entry pause, may this authorization use the single strict burst exception?',criteria:{ALLOW_ONE_STRICT_EXCEPTION:'Allow the one-per-pause strict burst exception.',NO_PAUSE_EXCEPTION:'Do not allow burst execution during the pause.'}}
      }
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:out.called!==false,decision:'DO_NOT_ARM',mode:'BURST_PREAUTH'};
    const a=out.data?.answers||{};
    const decision=choiceValue(a.burst_decision),ttl=choiceValue(a.ttl),strict=choiceValue(a.trigger_strictness),lev=choiceValue(a.leverage_mode),pex=choiceValue(a.pause_exception);
    if(!['ARM_LONG','ARM_SHORT','DO_NOT_ARM'].includes(decision)||!Object.hasOwn(BURST_TTL_MS,ttl)||!Object.hasOwn(BURST_STRICTNESS,strict)||lev!=='MAX_SAFE'||!['ALLOW_ONE_STRICT_EXCEPTION','NO_PAUSE_EXCEPTION'].includes(pex))return {ok:false,configured:true,called:true,decision:'DO_NOT_ARM',reason:'JEV_BURST_SCHEMA_MISMATCH',budget:out.budget,costUsd:out.costUsd};
    const chosenSide=decision==='ARM_LONG'?'LONG':decision==='ARM_SHORT'?'SHORT':null,pmDir=String(preMove?.direction||'').toUpperCase();
    if(chosenSide&&['LONG','SHORT'].includes(pmDir)&&chosenSide!==pmDir)return {ok:false,configured:true,called:true,decision:'DO_NOT_ARM',reason:'JEV_BURST_DIRECTION_CONTRADICTS_PREMOVE',budget:out.budget,costUsd:out.costUsd};
    return {ok:true,configured:true,called:true,finalAuthority:'JEV',decision,reason:['EARLY_EXPANSION','LOCATION_ADVERSE','FLOW_ADVERSE','DATA_NOT_READY','NO_EARLY_EDGE','POSITION_CONFLICT','RISK_OR_PAUSE'].includes(choiceValue(a.burst_reason))?choiceValue(a.burst_reason):'JEV_REASON_NOT_PROVIDED',dataGap:['NO_GAP','CHART','STREAM','L2','FLOW','DERIVATIVES','OTHER'].includes(choiceValue(a.burst_data_gap))?choiceValue(a.burst_data_gap):'NOT_REPORTED',side:chosenSide,ttlMs:BURST_TTL_MS[ttl],triggerThreshold:BURST_STRICTNESS[strict],leverageMode:lev,pauseExceptionAllowed:pex==='ALLOW_ONE_STRICT_EXCEPTION',model:cfg.model,mode:'BURST_PREAUTH',durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget,requestSize:out.requestSize};
  }

  async function sovereignBurstExit({active,stream,progress,chartContext,learning=null}={}){
    if(!configured)return {ok:false,called:false,action:'HOLD',reason:'JEV_KEY_UNAVAILABLE'};
    if(!active?.burstId||stream?.available!==true||!(Number(stream.ageMs)<=2500))return {ok:false,called:false,action:'HOLD',reason:'BURST_STREAM_STALE'};
    // R2544.47: the record carries the burst's age and the fee already paid (in R), and the same compact
    // trade-clock flow digest as the pre-authorization. On 05.10 21:18 JEV exited ORCA 1 s after entry without
    // knowing the position was 1 s old, and the whole orderFlow/level1Ofi objects (9 kB) crowded out chart context.
    const entryPx=finiteNumber(active.entryPrice),stopPx=finiteNumber(active.stopPrice),opened=finiteNumber(active.openedAt);
    const stopPct=entryPx>0&&stopPx>0?Math.abs(entryPx-stopPx)/entryPx*100:null;
    const l2=stream.localL2||{};
    const record={contract:'R2544.47_BURST_POSITION_MANAGEMENT',position:{burstId:active.burstId,symbol:active.symbol,side:active.side,quantity:active.quantity,entryPrice:active.entryPrice,stopPrice:active.stopPrice,leverage:active.leverage,openedAt:active.openedAt,ageSec:opened>0?Math.max(0,Math.round((clock()-opened)/100)/10):null,entryTriggerScore:finiteNumber(active.triggerScore),mfeR:active.mfeR,maeR:active.maeR},
      costs:{roundTripFeePct:BURST_ROUND_TRIP_FEE_PCT,roundTripFeeR:stopPct>0?Number((BURST_ROUND_TRIP_FEE_PCT/stopPct).toFixed(3)):null,stopDistancePct:stopPct===null?null:Number(stopPct.toFixed(3))},
      progress:{progressR:progress?.progressR,givebackR:progress?.givebackR,reviewReason:progress?.reviewReason},
      stream:{ageMs:stream.ageMs,bid:stream.bid,ask:stream.ask,spreadBps:stream.spreadBps,orderFlow:burstFlowDigest(stream),level1Ofi:{fast:burstOfiDigest(stream?.level1Ofi?.eventClock?.fast),slow:burstOfiDigest(stream?.level1Ofi?.eventClock?.slow)},
        localL2:{available:l2.available===true,sequenceHealthy:l2.sequenceHealthy===true,confidence:finiteNumber(l2.confidence),multiLevelOfi:finiteNumber(l2.multiLevelOfi),depthImbalance:finiteNumber(l2.depthImbalance)}}};
    const body={model:cfg.model,state:{description:'JEV owns whether this short-lived LONG/SHORT burst has earned enough profit or should continue. There is no fixed profit/R target. Weigh current expansion quality, public flow, spread, giveback, costs and risk from leverage. record.position.ageSec is seconds since entry; record.costs.roundTripFeeR is the round-trip fee in R that any exit realizes. Choose EXIT_NOW or HOLD. The independent exchange stop and fast-fail remain mandatory. After 120 seconds the burst continues only while it is in profit and you keep answering HOLD; absolute ceiling 10 minutes. A later PC watcher executes only against the still-active burst identity, never the core lot. Missing/stale chart context is explicitly unavailable, never confirmation. Experience is soft context, never automatic strategy promotion.',record,experienceMemory:compactExperienceMemory(learning,3500),...(chartContext?.available===true?{coreMarketPacket:chartContext.packet}:{chartContext:{available:false,reason:chartContext?.reason||'CHART_UNAVAILABLE'}})},questions:{burst_exit:{type:'choice',instructions:'Decide this burst position from current evidence; profit sufficiency has no fixed target.',criteria:{HOLD:'Continue while this specific expansion still supports the exposure.',EXIT_NOW:'Realize the available profit or exit because further exposure is no longer justified.'}}}};
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,action:'HOLD'};
    const action=choiceValue(out.data?.answers?.burst_exit);
    return {...out,called:true,action:['HOLD','EXIT_NOW'].includes(action)?action:'HOLD',ok:['HOLD','EXIT_NOW'].includes(action),finalAuthority:'JEV'};
  }

  async function sovereignExit({position,lifecycle,currentPlan,unified,evidence=null}={}){
    if(!configured)return {ok:false,configured:false,required:cfg.enabled,called:false,finalAuthority:false,action:'HOLD_REVIEW',reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    if(unified?.dataQuality?.advisoryUsable!==true)return {ok:false,configured:true,required:true,called:false,finalAuthority:false,action:'HOLD_REVIEW',reason:'JEV_EXIT_CONTEXT_NOT_USABLE'};
    const entry=finiteNumber(position?.entryPrice),mark=finiteNumber(position?.markPrice);
    const side=String(position?.side||lifecycle?.side||'').toUpperCase();
    const pnlPct=entry!==null&&entry>0&&mark!==null&&['LONG','SHORT'].includes(side)
      ? (side==='LONG'?(mark-entry)/entry:(entry-mark)/entry)*100:null;
    const liveContext=liveReasoningContext(root,unified?.learning);
    const original=lifecycle?.entryPlan||{};
    const entryContext=lifecycle?.entryContext||{};
    const coreMarket=marketPacket(unified);
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
        managementStyle:original.managementStyle||entryContext.managementStyle||null,
        // CLAUDE_R2543_EXIT_RISK_CONTEXT: ilk (değişmez) değerler ile GÜNCEL değerler ayrı alanlardır.
        // Trailing stop hareket ederse initialStop değişmez; JEV "tez gerçekten bozuldu mu?" sorusunu ölçebilsin.
        initialInvalidation:finiteNumber(lifecycle?.initialInvalidationPrice??original.invalidationPrice??lifecycle?.invalidationPrice),
        initialStop:finiteNumber(lifecycle?.initialStopPrice??lifecycle?.originalStopPrice??original.stopPrice),
        currentStop:finiteNumber(lifecycle?.stopPrice),
        initialQuantity:finiteNumber(lifecycle?.initialQuantity),
        initialEntryPrice:finiteNumber(lifecycle?.initialEntryPrice??lifecycle?.entryPrice),
        tp1:finiteNumber(original.takeProfit1??lifecycle?.takeProfit1),tp2:finiteNumber(original.takeProfit2),tp3:finiteNumber(original.takeProfit3)
      },
      // CLAUDE_R2543_EXIT_RISK_CONTEXT: planlanan risk ve mevcut hareketin R cinsinden ölçüsü.
      // Yeni bir kural/kapı DEĞİLDİR; yalnız eksik ölçüyü taşır. JEV nihai otorite olarak kalır.
      riskState:(()=>{
        const initStop=finiteNumber(lifecycle?.initialStopPrice??lifecycle?.originalStopPrice??original.stopPrice);
        const initQty=finiteNumber(lifecycle?.initialQuantity);
        const initEntry=finiteNumber(lifecycle?.initialEntryPrice??lifecycle?.entryPrice??entry);
        const planned=finiteNumber(lifecycle?.plannedRiskQuote)??
          (initEntry!==null&&initStop!==null&&initQty!==null?Math.abs(initEntry-initStop)*Math.abs(initQty):null);
        const unreal=finiteNumber(position?.unrealizedPnl);
        const stopDistancePct=finiteNumber(lifecycle?.stopDistancePct)??
          (initEntry!==null&&initEntry!==0&&initStop!==null?Math.abs(initEntry-initStop)/Math.abs(initEntry)*100:null);
        const movedPct=entry!==null&&entry!==0&&mark!==null&&['LONG','SHORT'].includes(side)
          ? ((side==='LONG'?(mark-entry):(entry-mark))/entry)*100 : null;
        return {
          plannedRiskQuote:planned,
          currentPnlQuote:unreal,
          currentR:planned!==null&&planned>0&&unreal!==null?Number((unreal/planned).toFixed(3)):null,
          stopDistancePct:stopDistancePct===null?null:Number(stopDistancePct.toFixed(4)),
          movedPctOfEntry:movedPct===null?null:Number(movedPct.toFixed(4)),
          movedShareOfStopDistance:movedPct!==null&&stopDistancePct!==null&&stopDistancePct>0
            ? Number((movedPct/stopDistancePct).toFixed(3)) : null,
          remainingQuantity:finiteNumber(position?.quantity),
          initialQuantity:initQty,
          note:'currentR = mevcut açık K/Z ÷ PLANLANAN risk (ilk miktar × ilk stop mesafesi). movedShareOfStopDistance 1,0 = fiyat ilk stop mesafesi kadar aleyhte hareket etti. Bunlar ölçüdür; karar JEV\'indir.'
        };
      })(),
      positionProgress:(()=>{
        const initStop=finiteNumber(lifecycle?.initialStopPrice??lifecycle?.originalStopPrice??original.stopPrice);
        const initEntry=finiteNumber(lifecycle?.initialEntryPrice??lifecycle?.entryPrice??entry);
        const initQty=finiteNumber(lifecycle?.initialQuantity);
        const remQty=finiteNumber(position?.quantity);
        const R=initEntry!==null&&initStop!==null?Math.abs(initEntry-initStop):null;
        const dir=side==='LONG'?1:side==='SHORT'?-1:0;
        const priceProgressR=R!==null&&R>0&&mark!==null&&initEntry!==null?dir*(mark-initEntry)/R:null;
        const planned=R!==null&&initQty!==null?R*Math.abs(initQty):null;
        const open=finiteNumber(position?.unrealizedPnl);
        const ms=lifecycle?.managementState||{};
        return {
          priceProgressR:priceProgressR===null?null:Number(priceProgressR.toFixed(3)),
          openPositionR:planned!==null&&planned>0&&open!==null?Number((open/planned).toFixed(3)):null,
          mfeR:finiteNumber(ms.mfeR),maeR:finiteNumber(ms.maeR),
          initialQuantity:initQty,remainingQuantity:remQty,remainingFraction:initQty!==null&&initQty>0&&remQty!==null?Number((Math.abs(remQty)/Math.abs(initQty)).toFixed(4)):null,
          reducedFraction:finiteNumber(ms.reducedFraction),phase:ms.phase||null,
          managementStyle:ms.managementStyle||original.managementStyle||null,partialProfile:ms.partialProfile||original.partialProfile||null,
          partialFractions:ms.partialFractions||original.partialFractions||null,breakevenRule:ms.breakevenRule||original.breakevenRule||null,trailRule:ms.trailRule||original.trailRule||null,
          recentManagementEvents:Array.isArray(ms.recentManagementEvents)?ms.recentManagementEvents.slice(-12):[],
          recentJevActions:Array.isArray(ms.recentJevActions)?ms.recentJevActions.slice(-8):[],
          note:'priceProgressR measures market movement from original entry in units of original stop distance; openPositionR measures only remaining unrealized PnL versus original planned risk. After partial exits these are intentionally different.'
        };
      })(),
      entryThesis:{why:entryContext.why||original.why||null,setupFamily:entryContext.setupFamily||original.setupFamily||null,entryTiming:entryContext.entryTiming||original.entryTiming||null,edgeBasis:entryContext.edgeBasis||original.edgeBasis||null,lane:entryContext.lane||original.lane||null,source:lifecycle?.entryPlanSource||null,marketSignature:entryContext.marketSignature||null},
      marketContext:'SEE_STATE_CORE_MARKET_PACKET',
      noisePolicy:'Lower-timeframe noise is evidence, not by itself proof that the original owner-timeframe thesis failed. Evaluate the supplied original thesis against current owner and higher context; JEV retains final strategic authority.',
      experienceMemory:liveContext.experienceMemory,
      requestedEvidence:evidence||null,
      // CLAUDE_R2544_4_PARTIAL_CONTRACT: kısmi kâr yürütme sözleşmesi ve bu pozisyonda şimdiye kadar alınan kısmiler.
      managementContract:lifecycle?.managementContract||null
    };
    const body={
      model:cfg.model,
      state:{
        coreMarketPacket:coreMarket,
        description:'JEV is the sole strategic position manager. state.coreMarketPacket.chartOverlayLevels includes protected trendLines and breakoutEvidence per TF; weigh their age and stillInside state as context, never automatic exits. record.managementContract states the execution contract for PARTIAL_TAKE_PROFIT (minimum progress in R, maximum review partials, minimum spacing) and what the position guard already does automatically; a PARTIAL_TAKE_PROFIT outside that contract is recorded as HOLD, so choose HOLD, PROTECT_PROFIT or EXIT_NOW instead when the contract does not allow a partial. EXIT_NOW is never restricted. Frame volatility.trail (3-ATR trail) and volatility.spike (a fresh displacement against the position) are soft context for runner management, not automatic exits. The professional trader/scalper Cortex and measured experience memory are ALWAYS ON read-only reasoning context. Choose HOLD, REDUCE_RISK, protect profit, take a partial, or exit now from the supplied evidence. REDUCE_RISK is for a losing/adverse position whose thesis is not fully invalidated but full exposure is no longer justified; it is not profit taking. Do not require fixed 1m/3m/5m/15m alignment and do not use a score threshold. Weight conflicting evidence by its actual importance. Code after this decision may enforce execution integrity and exchange safety only; it must not downgrade the strategic action, except the stated partial-take-profit contract. If a material concept is not understood, do not invent it. experienceMemory.caseMemory, when available, contains the most similar ENTRY-STATE cases and deliberately includes both winners and losers/counterexamples; experienceMemory.caseMemoryByLane provides LONG/SHORT × 5M_SCALP/15M_TRADE analogs so direction/lane differences are explicit. Similarity is soft context only, legacy partial signatures are discounted, and a single case never becomes a rule. experienceMemory.tradeLessons is YOUR OWN measured P&L: byTierSide/byFamilySide/byRegimeSide/byPreEntryFlow/byExit rows [key,n,win%,netUSDT,PF,avgWin,avgLoss], worked/failed lines, repeatedMistakes (e.g. RAPID_REENTRY_AFTER_WIN, LEADER_CHASE_LONG, WIDE_STOP, OVERSIZED_LOSS), current = attention-tier stats of this coin per side, symbol = your recent trades on this coin, sequence = recent 60m realized P&L/coin switches plus quickSwitchAfterLoss/returnToRecentSymbol. Learn from it: repeat what worked, do not mechanically rotate between recently traded coins or flip direction after a loss/win unless the CURRENT structure, location and execution evidence is materially different; explicitly explain that difference in reasoning. Regime rows describe whether past trades were with/counter to aligned 5m+15m trend and whether entry was stretched/chase-risk. byPreEntryFlow calibrates whether the same pre-entry trap/support state historically produced winners AND losers; treat it as measured timing evidence, never a hard rule. It is soft experience, never a veto.',
        professionalTraderCortex:liveContext.professionalTraderCortex,
        dynamicKnowledge:liveContext.dynamicKnowledge,
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
            REDUCE_RISK:'Reduce 25-50% of current exposure while the position is losing/adverse because entry quality or short-horizon execution evidence deteriorated, but the strategic thesis is not yet invalidated. Do not use this as profit taking.',
            PARTIAL_TAKE_PROFIT:'Reduce part of the position while keeping a runner because reward remains but some profit should be secured.',
            EXIT_NOW:'Close the position because the JEV thesis, invalidation, or current opportunity has materially failed or been replaced.'
          }
        },
        partial_fraction:{
          type:'choice',
          instructions:'Used only when PARTIAL_TAKE_PROFIT or REDUCE_RISK is selected. Choose how much of the current remaining position to reduce. Otherwise this answer is ignored.',
          criteria:{P25:'Reduce 25% and keep 75% runner.',P33:'Reduce about one third and keep about two thirds.',P50:'Reduce 50% and keep 50% runner.'}
        }
      }
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:out.called!==false,finalAuthority:false,action:'HOLD_REVIEW',mode:'SOVEREIGN_CHOICE'};
    const action=choiceValue(out.data?.answers?.position_action);
    const partialChoice=choiceValue(out.data?.answers?.partial_fraction)||'P33';
    const partialFraction={P25:0.25,P33:1/3,P50:0.5}[partialChoice]||1/3;
    if(!['HOLD','PROTECT_PROFIT','REDUCE_RISK','PARTIAL_TAKE_PROFIT','EXIT_NOW'].includes(action)){
      return {ok:false,configured:true,required:true,called:true,finalAuthority:false,action:'HOLD_REVIEW',reason:'JEV_SOVEREIGN_EXIT_SCHEMA_MISMATCH',mode:'SOVEREIGN_CHOICE',budget:out.budget,costUsd:out.costUsd};
    }
    const actionTr={HOLD:'TUT',PROTECT_PROFIT:'KÂRI KORU',REDUCE_RISK:'RİSKİ AZALT',PARTIAL_TAKE_PROFIT:'KISMİ KÂR AL',EXIT_NOW:'ÇIK'}[action];
    return {
      ok:true,configured:true,required:true,called:true,finalAuthority:true,action,actionTr,
      partialFraction:['PARTIAL_TAKE_PROFIT','REDUCE_RISK'].includes(action)?partialFraction:null,
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
    if(!out.ok)return {...out,called:out.called!==false,action:'HOLD_REVIEW',mode:cfg.mode};
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
    if(!out.ok)return {...out,called:out.called!==false,veto:true,mode:cfg.mode};
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
  return {config:cfg,localStatus,remoteStatus,billingStatus,billingSnapshot,probe,judge,judgeExit,sovereignPass1,sovereignFinal,sovereignLesson,sovereignKnowledgeReview,sovereignBurstArm,sovereignBurstExit,sovereignExit,budgetStatus};
}
module.exports={prepareDecisionRequest,rankKnowledgeByPacket,compactPass1Questions,compactMemoryForPass1Routing,compactPass2Questions,compactPass2Record,compactMemoryForPass2Final,compactPass2QuestionsResidual,compactPass2RecordResidual,compactMemoryForPass2Residual,MAX_DECISION_REQUEST_BYTES,PASS1_TARGET_BYTES,PASS2_TARGET_BYTES,OTHER_TARGET_BYTES,protectedCoreTruth,compactChartNarrative,compactCortexReference,compactMemoryForDecision,CHECKS,EXIT_CHECKS,SOVEREIGN_EVIDENCE,decisionQuestions,exitDecisionQuestions,DEFAULTS,normalizeConfig,sanitizedKeyMetadata,noulProbability,choiceValue,compactDecisionRecord,compactSovereignEvidence,compactExperienceMemory,compactSignature,dynamicKnowledgeReference,sovereignFinalConsistency,createJevClient};
