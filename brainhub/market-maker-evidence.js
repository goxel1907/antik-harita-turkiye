'use strict';
const {buildPreEntryAdverseSelection}=require('./preentry-microstructure');

function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function compactFlow(w){
  if(!w||typeof w!=='object')return null;
  return {
    trades:Number(w.trades)||0,coverageMs:finite(w.coverageMs),buyQuote:finite(w.buyQuote),sellQuote:finite(w.sellQuote),deltaQuote:finite(w.deltaQuote),
    buyRatio:finite(w.buyRatio),sellRatio:finite(w.sellRatio),priceMoveBps:finite(w.priceMoveBps),
    largestTradeQuote:finite(w.largestTradeQuote),largeBuyCount:Number(w.largeBuyCount)||0,largeSellCount:Number(w.largeSellCount)||0,
    possibleTwapLike:w.possibleTwapLike||null
  };
}
function buildMarketMakerEvidence({streaming={},derivatives={},microstructure={}}={}){
  const dyn=streaming?.depthDynamics&&typeof streaming.depthDynamics==='object'?streaming.depthDynamics:{available:false};
  const flow=streaming?.orderFlow?.windows||{};
  const liq=streaming?.observedLiquidations||{};
  return {
    version:'JEV_MARKET_MAKER_EVIDENCE_V3_R2544_26',
    authority:'EVIDENCE_ONLY',
    canQualify:false,canVeto:false,canSize:false,canExecute:false,
    participantIdentity:'NOT_IDENTIFIED',
    participantIntent:'NOT_ASSERTED',
    source:'Binance public bookTicker/depth20/aggTrade/forceOrder + active-symbol sequence-safe local L2 + public derivatives REST; BrainHub deterministic heuristics',
    asOf:streaming?.asOf||derivatives?.asOf||null,
    orderFlow:(()=>{
      // CLAUDE_R2543_ORDER_FLOW_AVAILABILITY: bu nesnede `available` HİÇ üretilmiyordu; JEV paketi
      // `flow.available===true` diye baktığı için 595/595 karar paketinde orderFlowAvailable=false çıktı.
      // Kural: metadata dürüst olsun ama gerçek sayısal CVD sırf bayrak yüzünden silinmesin (veri uydurulmaz).
      const cvd=finite(streaming?.cvdQuote120s);
      const trades=Number(streaming?.cvdTrades120s);
      const ageMs=finite(Object.hasOwn(streaming,'cvdAgeMs')?streaming.cvdAgeMs:streaming?.ageMs);
      const stale=ageMs!==null&&ageMs>45000;
      const hasSample=Number.isFinite(trades)&&trades>0;
      // The market trade channel can be fresh while the separate public book channel warms up.
      const available=cvd!==null&&hasSample&&ageMs!==null&&!stale;
      const reason=available?null:(cvd===null?'NO_CVD_VALUE':(!hasSample?'NO_TRADE_SAMPLE':(stale?'STALE_STREAM':'UNKNOWN_TRADE_AGE')));
      return {
        available,
        reason,
        source:cvd!==null?'BINANCE_WS_AGGTRADE_PUBLIC_120S':null,
        asOf:streaming?.cvdAsOf||streaming?.asOf||null,
        ageMs,
        sampleTrades:Number.isFinite(trades)?trades:null,
        '5s':compactFlow(flow['5s']),
        '10s':compactFlow(flow['10s']),
        '15s':compactFlow(flow['15s']),
        '30s':compactFlow(flow['30s']),
        '60s':compactFlow(flow['60s']),
        '120s':compactFlow(flow['120s']),
        cvdQuote120s:cvd,
        depth20Imbalance:finite(streaming?.depth20Imbalance),
        spreadBps:finite(streaming?.spreadBps),
        semantics:'PUBLIC_AGGTRADE_EVIDENCE_ONLY_NOT_EXCHANGE_CVD'
      };
    })(),
    localL2:(()=>{const x=streaming?.localL2||{};return {available:x.available===true,state:x.state||null,sequenceHealthy:x.sequenceHealthy===true,ageMs:finite(x.ageMs),resyncCount5m:Number(x.resyncCount5m)||0,confidence:finite(x.confidence),confidenceQuality:x.confidenceQuality||null,multiLevelOfi:finite(x.multiLevelOfi),depthImbalance:finite(x.depthImbalance),wallPersistence:x.wallPersistence||null,liquidityPull:x.liquidityPull?{side:x.liquidityPull.side||'NONE'}:null,replenishment:x.replenishment?{side:x.replenishment.side||'NONE'}:null,absorption:x.absorption||null,authority:'EVIDENCE_ONLY_JEV_FINAL',canVeto:false,executionAuthority:false};})(),
    bookBehavior:{
      available:dyn.available===true,
      bidWalls:Array.isArray(dyn.bidWalls)?dyn.bidWalls.slice(0,4):[],
      askWalls:Array.isArray(dyn.askWalls)?dyn.askWalls.slice(0,4):[],
      possibleLiquidityPulls:Array.isArray(dyn.possibleLiquidityPulls)?dyn.possibleLiquidityPulls.slice(0,6):[],
      replenishment:Array.isArray(dyn.replenishment)?dyn.replenishment.slice(0,6):[],
      absorption:dyn.absorption||{available:false},
      semantics:dyn.semantics||'HEURISTIC_PUBLIC_L2_PLUS_AGGTRADE_EVIDENCE_ONLY'
    },
    liquidation:{
      observed:liq.available===true,
      count:Number(liq.count)||0,
      longLiquidatedQuote:finite(liq.longLiquidatedQuote),
      shortLiquidatedQuote:finite(liq.shortLiquidatedQuote),
      zones:Array.isArray(liq.zones)?liq.zones.slice(0,6):[],
      velocity:liq.velocity||null,
      cascade:liq.cascade||{available:false},
      semantics:liq.semantics||'OBSERVED_BINANCE_FORCE_ORDER_ONLY'
    },
    derivatives:{
      available:derivatives?.available===true,
      modeledLiquidation:derivatives?.modeledLiquidation?{available:derivatives.modeledLiquidation.available===true,authority:derivatives.modeledLiquidation.authority||'SHADOW_EVIDENCE_ONLY',observed:false,estimated:true,events:Number(derivatives.modeledLiquidation.events)||0,baselineHours:finite(derivatives.modeledLiquidation.baselineHours),density:derivatives.modeledLiquidation.density||null,canVeto:false,executionAuthority:false}:null,
      openInterest:derivatives?.openInterest||null,
      funding:derivatives?.funding||null,
      taker:derivatives?.taker||null,
      topTraderPosition:derivatives?.topTraderPosition||null,
      topTraderAccount:derivatives?.topTraderAccount||null,
      globalAccount:derivatives?.globalAccount||null,
      semantics:derivatives?.semantics||'DERIVATIVES_POSITIONING_CONTEXT_ONLY'
    },
    softMicrostructure:{
      sourceQuality:microstructure?.sourceQuality||null,
      depthSoftContext:microstructure?.depthSoftContext||null,
      ofiProxyQuote:finite(microstructure?.ofiProxyQuote),
      level1OfiAvailable:streaming?.level1Ofi?.windows?.['15s']?.available===true||streaming?.level1Ofi?.windows?.['30s']?.available===true,
      level1OfiSemantics:streaming?.level1Ofi?.semantics||null,
      fullMultiLevelOfiClaimed:false
    },
    preEntryAdverseSelection:buildPreEntryAdverseSelection({streaming,derivatives,microstructure}),
    interpretationRules:[
      'Absorption/replenishment/liquidity-pull/TWAP-like labels are probabilistic public-data footprints, not participant identity.',
      'Level-1 OFI uses sequenced public bookTicker; true multi-level OFI is used only when active-symbol local L2 U/u/pu continuity is healthy. Partial depth20 remains fallback context.',
      'Observed forceOrder prints remain separate from MODELED_OI_LIQUIDATION_DENSITY; the modeled layer is estimated SHADOW_EVIDENCE_ONLY and never a veto.',
      'Top-trader and long/short ratios are positioning context, not market-maker identity.',
      'No single microstructure signal may independently create LONG/SHORT, QUALIFIED, size, stop, target or execution.',
      'R2544.26 pre-entry evidence confidence-downweights sparse or unhealthy L2 windows; it is timing evidence only, not probability, and never hard-vetoes a JEV plan.',
      'Binance/BrainHub numeric truth outranks visual interpretation when evidence conflicts.'
    ]
  };
}
module.exports={buildMarketMakerEvidence};
