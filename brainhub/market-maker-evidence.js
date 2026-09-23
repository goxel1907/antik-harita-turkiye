'use strict';

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function compactFlow(w){
  if(!w||typeof w!=='object')return null;
  return {
    trades:Number(w.trades)||0,buyQuote:finite(w.buyQuote),sellQuote:finite(w.sellQuote),deltaQuote:finite(w.deltaQuote),
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
    version:'JEV_MARKET_MAKER_EVIDENCE_V1',
    authority:'EVIDENCE_ONLY',
    canQualify:false,canVeto:false,canSize:false,canExecute:false,
    participantIdentity:'NOT_IDENTIFIED',
    participantIntent:'NOT_ASSERTED',
    source:'Binance public L2/aggTrade/forceOrder + public derivatives REST; BrainHub heuristics',
    asOf:streaming?.asOf||derivatives?.asOf||null,
    orderFlow:{
      '10s':compactFlow(flow['10s']),
      '30s':compactFlow(flow['30s']),
      '120s':compactFlow(flow['120s']),
      cvdQuote120s:finite(streaming?.cvdQuote120s),
      depth20Imbalance:finite(streaming?.depth20Imbalance),
      spreadBps:finite(streaming?.spreadBps)
    },
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
      trueOfiClaimed:false
    },
    interpretationRules:[
      'Absorption/replenishment/liquidity-pull/TWAP-like labels are probabilistic public-data footprints, not participant identity.',
      'Observed forceOrder prints are real observed liquidations; projected liquidation levels are not fabricated.',
      'Top-trader and long/short ratios are positioning context, not market-maker identity.',
      'No single microstructure signal may independently create LONG/SHORT, QUALIFIED, size, stop, target or execution.',
      'Binance/BrainHub numeric truth outranks visual interpretation when evidence conflicts.'
    ]
  };
}
module.exports={buildMarketMakerEvidence};
