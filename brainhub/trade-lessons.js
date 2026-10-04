'use strict';
const {profitGiveback}=require('./outcome-metrics');
function priceActionAtEntry(ec){return Object.fromEntries(['5m','15m'].map(tf=>{const f=ec?.entryCase?.frames?.[tf];return [tf,f?.priceAction?.available?{version:f.priceAction.version,asOf:f.asOf,orderBlocks:(f.orderBlocks||[]).slice(0,4),events:(f.priceAction.events||[]).slice(-2)}:null];}));}
// CLAUDE_R2544_16_TRADE_LESSONS (Claude Work, 2026-09-29) — beynin kâr/zarardan KESİN öğrenmesi.
// Önceki durum: JEV_LESSON'lar tek işlemden genel "OBSERVE_MORE" üretiyordu; deneyim hafızası kurulumu hangi
// dikkat katmanından (ilk 3 / 4–10 / 11–24 / aday / erken ilgi / patlamaya yakın) geldiğini hiç bilmiyordu.
// Şimdi: her kapanan işlem için DETERMİNİSTİK ders kartı (etiket + karar + tek cümle ders) ve bütün geçmişten
// katman×yön, kurulum ailesi×yön, çıkış türü, hızlı yeniden giriş, stop genişliği özetleri + Beta sonrası (azalan ağırlık).
// JEV'e her PASS-1/PASS-2/pozisyon kararında yumuşak bağlam olarak gider. Kapı/veto/eşik DEĞİL; sermaye ayarını değiştirmez.
// Yöntem fikirleri (kod kopyası yok): etiket bazlı beklenti tabloları (işlem günlüğü analitiği), azalan ağırlıklı
// Beta–Bernoulli sonrası (Thompson örneklemesi literatürü).
function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function r2(n,d=2){return n===null||!Number.isFinite(n)?null:Number(n.toFixed(d));}
const TIER_OF_SOURCE={
  GAINER_APPROACH:'APPROACH',TOP3_APPROACH:'APPROACH',TOP10_APPROACH:'APPROACH',APPROACHING:'APPROACH',APPROACH_CONTINUITY:'APPROACH',EARLY_TOP5:'APPROACH',
  GAINER_TOP10:'TOP4_10',PREV_ATTACK_4_10:'TOP4_10',
  GAINER_TOP24:'TOP11_24',
  APP_EARLY_ATTENTION:'EARLY_ATTN',
  NEAR_EXPLOSION:'NEAR_EXPLOSION',ACCUMULATION_PROXY:'NEAR_EXPLOSION',ACCUMULATION_BREAKOUT_PROXY:'NEAR_EXPLOSION',
  GAINER_TOP3:'TOP3',PREV_ATTACK_TOP3:'TOP3',
  LIGHTWEIGHT_ACCELERATION:'ACCEL_OTHER',LIGHTWEIGHT_NEW_ACCELERATION:'ACCEL_OTHER',LIGHTWEIGHT_FILL:'ACCEL_OTHER',CURRENT_ATTACK_TOP10:'ACCEL_OTHER',EARLY_EXPANSION:'ACCEL_OTHER'
};
function tierOf(att){
  if(!att||typeof att!=='object')return 'UNKNOWN';
  const srcs=[att.deepScanReason,att.attentionSource,...(Array.isArray(att.targetSources)?att.targetSources:[])].filter(Boolean).map(String);
  // Önce belirli katman (ilk 3 / 4–10 / 11–24 / aday / erken ilgi / patlamaya yakın); eski saldırı-sırası nedenleri
  // (CURRENT_ATTACK_TOP10 vb.) yalnız başka bilgi yoksa 'hızlanan/eski havuz' sayılır.
  let fallback=null;
  for(const s of srcs){const t=TIER_OF_SOURCE[s];if(t&&t!=='ACCEL_OTHER')return t;if(t)fallback=t;}
  const rank=num(att.gainerRank);
  if(rank!==null&&rank>=1&&rank<=24)return rank<=3?'TOP3':rank<=10?'TOP4_10':'TOP11_24';
  if(srcs.includes('BINANCE_TOP24_GAINER'))return 'TOP11_24';
  return fallback||(srcs.length?'ACCEL_OTHER':'UNKNOWN');
}
function attentionFromCandidate(c){
  if(!c||typeof c!=='object')return null;
  return {
    deepScanReason:c.deepScanReason||null,attentionSource:c.attentionSource||null,
    targetSources:Array.isArray(c.targetSources)?c.targetSources.slice(0,6):[],
    gainerRank:num(c.gainerRank)??num(c.gainerRank24),ladderTier:c.ladderTier||null,ladderApproach:c.ladderApproach||c.approach||null,
    gainerRankVelocity:num(c.gainerRankVelocity),change24hPct:num(c.priceChange24hPct)??num(c.change24hPct),
    nearExplosion:c.nearExplosion&&typeof c.nearExplosion==='object'?{source:c.nearExplosion.source||null,direction:c.nearExplosion.direction||null}:null,
    preMove:c.preMove&&typeof c.preMove==='object'?{state:c.preMove.state||null,direction:c.preMove.direction||null}:null
  };
}

function normTrend(v){
  const x=String(v||'').toUpperCase();
  if(x.includes('UP'))return 'UP';
  if(x.includes('DOWN'))return 'DOWN';
  return x?'MIXED':'UNKNOWN';
}
function regimeKeyFromSignature(sig,side){
  if(!sig||typeof sig!=='object')return 'REGIME_UNKNOWN';
  const t5=normTrend(sig?.regime5m?.trend),t15=normTrend(sig?.regime15m?.trend);
  let base='REGIME_MIXED';
  if(t5==='UP'&&t15==='UP')base='TREND_UP_ALIGNED';
  else if(t5==='DOWN'&&t15==='DOWN')base='TREND_DOWN_ALIGNED';
  else if((t5==='UP'&&t15==='DOWN')||(t5==='DOWN'&&t15==='UP'))base='TREND_CONFLICT';
  const sd=String(side||'').toUpperCase();
  let relation='MIXED_SIDE';
  if(base==='TREND_UP_ALIGNED')relation=sd==='LONG'?'WITH_TREND':'COUNTER_TREND';
  else if(base==='TREND_DOWN_ALIGNED')relation=sd==='SHORT'?'WITH_TREND':'COUNTER_TREND';
  const r5=sig?.regime5m?.readout||{},r15=sig?.regime15m?.readout||{};
  const chase=sd==='LONG'?(r5.chaseLong||r15.chaseLong):(sd==='SHORT'?(r5.chaseShort||r15.chaseShort):null);
  const stretched=[r5.stretchState,r15.stretchState].some(x=>['EXTENDED','EXTREME'].includes(String(x||'').toUpperCase()));
  return [base,relation,chase&&String(chase).toUpperCase()!=='LOW'?'CHASE_'+String(chase).toUpperCase():null,stretched?'STRETCHED':null].filter(Boolean).join('|');
}

function canonicalR(p){
  const r=num(p?.rMultiple),risk=num(p?.riskQuote),qty=num(p?.initialQuantity??p?.quantity);
  if(risk===null||risk<=0||qty===null||qty<=0||r===null)return {r:null,status:'UNMEASURED'};
  if(Math.abs(r)>20)return {r:null,status:'OUTLIER_R'};
  // Stop mesafesi anlamsız derecede darsa (≤%0,05) R şişer: ölçülmüş sayılmaz.
  const sd=num(p?.stopDistancePct);
  if(sd!==null&&sd<=0.05)return {r:null,status:'OUTLIER_R'};
  return {r,status:'MEASURED'};
}
function preEntryForSide(ec,side){
  const pe=ec?.entryCase?.flow?.preEntryAdverseSelection||ec?.preEntryAdverseSelection||null;
  if(!pe||typeof pe!=='object')return {available:false,state:'NO_PREENTRY_DATA',quality:null,trapRisk:null,support:null,assessment:ec?.preEntryFlowAssessment||ec?.entryCase?.decision?.preEntryFlowAssessment||null};
  const s=String(side||'').toUpperCase()==='SHORT'?pe.short:pe.long;
  return {available:!!s,state:s?.state||'NO_PREENTRY_STATE',quality:pe?.reliability?.quality||null,trapRisk:num(s?.trapRiskIndex),support:num(s?.supportIndex),assessment:ec?.preEntryFlowAssessment||ec?.entryCase?.decision?.preEntryFlowAssessment||null,actionHint:pe?.actionHint||null};
}
const WIN_EXITS=new Set(['TP1_RUNNER_TRAIL','TP1_BREAKEVEN','TAKE_PROFIT','JEV_PARTIAL_TAKE_PROFIT','JEV_PARTIAL_THEN_EXTERNAL_CLOSE']);
function exitAuthorityOf(exit){
  const x=String(exit||'').toUpperCase();
  if(x==='JEV_EXIT_NOW'||x==='JEV_PARTIAL_TAKE_PROFIT')return 'JEV';
  if(x==='GUARD_CLOSE'||x==='STOP_LOSS'||x==='TP1_THEN_STOP'||x==='TP1_RUNNER_TRAIL'||x==='TP1_BREAKEVEN'||x==='TAKE_PROFIT')return 'SYSTEM';
  if(x.includes('EXTERNAL'))return x.includes('JEV_PARTIAL')?'JEV_PARTIAL_THEN_EXTERNAL':'EXTERNAL';
  return x?'OTHER':'UNKNOWN';
}
function lessonCard(close,{attention=null,prev=null,prevGlobal=null,prevTwo=[],avgWin=null}={}){
  const p=close||{},ec=p.entryContext&&typeof p.entryContext==='object'?p.entryContext:{};
  const att=attention||ec.attention||null;
  const tier=tierOf(att);
  const net=num(p.netPnl),hold=num(p.holdMinutes),stopPct=num(p.stopDistancePct);
  const cr=canonicalR(p);
  const opened=Date.parse(p.openedAt||''),closed=Date.parse(p.closedAt||'');
  const gapMin=prev&&Number.isFinite(opened)&&Number.isFinite(prev.closedMs)?r2((opened-prev.closedMs)/60000,1):null;
  const side=String(p.side||'').toUpperCase()||null;
  const exit=p.exitType||null;
  const exitAuthority=exitAuthorityOf(exit);
  const op=p.outcomePath&&typeof p.outcomePath==='object'?p.outcomePath:{};
  const mfeR=num(op.mfeR),maeR=num(op.maeR),timeToMfeMin=num(op.timeToMfeMin),timeToMaeMin=num(op.timeToMaeMin);
  const realizedR=cr.r!==null?cr.r:num(op.rMultiple);
  const mfeGivebackR=profitGiveback(mfeR,realizedR);
  const captureEfficiency=num(op.captureEfficiency)??(mfeR!==null&&mfeR>0&&realizedR!==null&&realizedR>0?Math.max(0,Math.min(2,realizedR/mfeR)):null);
  const preEntry=preEntryForSide(ec,side);
  const regime=regimeKeyFromSignature(ec.marketSignature||null,side);
  const globalGapMin=prevGlobal&&Number.isFinite(opened)&&Number.isFinite(prevGlobal.closedMs)?r2((opened-prevGlobal.closedMs)/60000,1):null;
  const ch24=num(att?.change24hPct);
  const tags=[];
  if(exit==='TP1_RUNNER_TRAIL')tags.push('WIN_TP1_RUNNER');
  else if(exit==='TP1_BREAKEVEN')tags.push('WIN_TP1_BREAKEVEN');
  else if(net!==null&&net>0)tags.push('WIN_OTHER_CLOSE');
  if(exit==='STOP_LOSS')tags.push(hold!==null&&hold<=5?'LOSS_FAST_STOP':'LOSS_FULL_STOP');
  if(exit==='JEV_EXIT_NOW'&&net!==null&&net<0)tags.push('LOSS_JEV_EXIT');
  if(exit==='TP1_THEN_STOP')tags.push('RUNNER_GAVE_BACK');
  if(gapMin!==null&&gapMin>=0&&gapMin<15)tags.push(num(prev?.net)!==null&&prev.net>0?'RAPID_REENTRY_AFTER_WIN':'RAPID_REENTRY_AFTER_LOSS');
  if(globalGapMin!==null&&globalGapMin>=-2&&globalGapMin<20&&prevGlobal?.symbol&&String(prevGlobal.symbol)!==String(p.symbol)){
    tags.push(num(prevGlobal?.net)!==null&&prevGlobal.net>0?'QUICK_SYMBOL_SWITCH_AFTER_WIN':'QUICK_SYMBOL_SWITCH_AFTER_LOSS');
  }
  if(gapMin!==null&&gapMin>=-2&&gapMin<30&&prev?.side&&side&&String(prev.side)!==side){
    tags.push(num(prev?.net)!==null&&prev.net>0?'SAME_SYMBOL_DIRECTION_FLIP_AFTER_WIN':'SAME_SYMBOL_DIRECTION_FLIP_AFTER_LOSS');
  }
  if(prevGlobal&&num(prevGlobal.net)!==null&&prevGlobal.net>0&&net!==null&&net<0&&-net>Math.max(1,1.25*prevGlobal.net))tags.push('WIN_GIVEBACK_SEQUENCE');
  if(Array.isArray(prevTwo)&&prevTwo.length>=2){
    const a=prevTwo[prevTwo.length-2],b=prevTwo[prevTwo.length-1];
    if(a?.symbol&&b?.symbol&&String(a.symbol)===String(p.symbol)&&String(b.symbol)!==String(p.symbol)&&globalGapMin!==null&&globalGapMin>=-2&&globalGapMin<30)tags.push('TWO_SYMBOL_PING_PONG');
  }
  if(stopPct!==null&&stopPct>=3)tags.push('WIDE_STOP');
  if(stopPct!==null&&stopPct<0.6)tags.push('TIGHT_STOP');
  if(tier==='TOP3'&&side==='LONG')tags.push('LEADER_CHASE_LONG');
  if(tier==='TOP3'&&side==='SHORT')tags.push('LEADER_FADE_SHORT');
  if(ch24!==null&&ch24>=25&&side==='LONG')tags.push('EXTENDED_24H_LONG');
  if(preEntry.available){
    if(preEntry.quality==='INSUFFICIENT')tags.push('PREENTRY_DATA_INSUFFICIENT');
    if(preEntry.state==='TRAP_RISK_HIGH'||preEntry.state==='TRAP_RISK_ELEVATED'){
      tags.push('PREENTRY_TRAP_RISK');
      if(net!==null&&net<0)tags.push('LOSS_AFTER_PREENTRY_TRAP_RISK');
      if(net!==null&&net>0)tags.push('WIN_DESPITE_PREENTRY_TRAP_RISK');
    }
    if(preEntry.state==='CONTINUATION_SUPPORT'||preEntry.state==='CONTINUATION_SUPPORT_STRONG'){
      tags.push('PREENTRY_FLOW_SUPPORT');
      if(net!==null&&net>0)tags.push('WIN_WITH_PREENTRY_FLOW_SUPPORT');
      if(net!==null&&net<0)tags.push('LOSS_DESPITE_PREENTRY_FLOW_SUPPORT');
    }
  }
  if(net!==null&&net<0&&avgWin!==null&&avgWin>0&&-net>1.5*avgWin)tags.push('OVERSIZED_LOSS');
  if(net!==null&&net<0&&hold!==null&&hold>=90)tags.push('LONG_HOLD_LOSS');
  if(String(ec.entryTiming||'').toUpperCase()==='NONE_WAIT')tags.push(net!==null&&net<0?'NONE_WAIT_LOSS':'NONE_WAIT_USED');
  if(mfeGivebackR!==null&&mfeGivebackR>=1)tags.push('MFE_GIVEBACK_GE_1R');
  if(net!==null&&net>0&&mfeR!==null&&mfeR>=0.75&&captureEfficiency!==null&&captureEfficiency<0.65)tags.push('LOW_PROFIT_CAPTURE');
  if(net!==null&&net>0&&mfeGivebackR!==null&&mfeGivebackR>=0.35)tags.push('WINNER_GAVE_BACK_PROFIT');
  if(maeR!==null&&maeR<=-0.5&&hold!==null&&hold<=10)tags.push('FAST_ADVERSE_MOVE');
  const entryTiming=String(ec.entryTiming||'').toUpperCase();
  const flowAssessment=String(preEntry.assessment||'').toUpperCase();
  if(net!==null&&net<0&&hold!==null&&hold<=10&&entryTiming==='MARKET_NOW'&&['NEUTRAL_OR_MIXED','TRAP_RISK_WAIT'].includes(flowAssessment))tags.push('MARKET_NOW_MIXED_FLOW_FAST_LOSS');
  if(net!==null&&net<0&&String(ec.edgeBasis||'').toUpperCase()==='ORDER_FLOW_DEPTH'&&['TRAP_RISK_HIGH','TRAP_RISK_ELEVATED'].includes(String(preEntry.state||'').toUpperCase()))tags.push('ORDER_FLOW_EDGE_CONTRADICTION_LOSS');
  if(cr.status!=='MEASURED')tags.push('R_'+cr.status);
  let verdict='NEUTRAL';
  if(net!==null&&net>0&&(WIN_EXITS.has(exit)||(cr.r!==null&&cr.r>=0.5)))verdict='SUCCESS';
  else if(net!==null&&net<0&&(exit==='STOP_LOSS'||exit==='JEV_EXIT_NOW'||exit==='TP1_THEN_STOP'||(cr.r!==null&&cr.r<=-0.5)))verdict='MISTAKE';
  const L=[];
  if(tags.includes('RAPID_REENTRY_AFTER_WIN')&&net<0)L.push('kazançtan hemen sonra aynı coine yeniden giriş zararla bitti');
  if(tags.includes('RAPID_REENTRY_AFTER_LOSS')&&net<0)L.push('zarardan hemen sonra aynı coine intikam girişi');
  if(tags.includes('QUICK_SYMBOL_SWITCH_AFTER_LOSS')&&net<0)L.push('başka coindeki zarardan hemen sonra sembol değişimi de zarar üretti');
  if(tags.includes('QUICK_SYMBOL_SWITCH_AFTER_WIN')&&net<0)L.push('kazançtan hemen sonra hızlı sembol rotasyonu zararla bitti');
  if(tags.includes('SAME_SYMBOL_DIRECTION_FLIP_AFTER_WIN')&&net<0)L.push('aynı coinde kazançtan sonra hızlı yön tersleme zararla bitti');
  if(tags.includes('SAME_SYMBOL_DIRECTION_FLIP_AFTER_LOSS')&&net<0)L.push('aynı coinde kayıptan sonra hızlı yön tersleme zararla bitti');
  if(tags.includes('WIN_GIVEBACK_SEQUENCE'))L.push('önceki kazançtan daha büyük sonraki kayıp seans kârını geri verdi');
  if(tags.includes('TWO_SYMBOL_PING_PONG')&&net<0)L.push('iki coin arasında hızlı gidip gelme zarar üretti');
  if(tags.includes('LEADER_CHASE_LONG')&&net<0)L.push('ilk 3 yükselende LONG kovalama');
  if(tags.includes('EXTENDED_24H_LONG')&&net<0)L.push('24s +%'+Math.round(ch24)+' uzamış coinde LONG');
  if(tags.includes('LOSS_FAST_STOP'))L.push('stop '+(hold??'?')+' dk içinde vuruldu: giriş yeri/zamanlaması zayıf');
  if(tags.includes('WIDE_STOP')&&net<0)L.push('%'+r2(stopPct,1)+' geniş stop büyük kayıp üretti');
  if(tags.includes('OVERSIZED_LOSS'))L.push('kayıp ortalama kazancın '+r2(-net/avgWin,1)+' katı');
  if(tags.includes('WIN_TP1_RUNNER'))L.push('TP1 + iz süren stop: kârı büyüten çıkış');
  if(tags.includes('LOSS_AFTER_PREENTRY_TRAP_RISK'))L.push('giriş öncesi akış/depth tuzak riski yüksekken MARKET_NOW zarar üretti; aynı durumda karşı örnekleri de kontrol et');
  if(tags.includes('WIN_DESPITE_PREENTRY_TRAP_RISK'))L.push('giriş öncesi tuzak riski yüksek görünmesine rağmen işlem kazandı; tuzak sinyalini tek başına veto yapma');
  if(tags.includes('WIN_WITH_PREENTRY_FLOW_SUPPORT'))L.push('giriş öncesi mikroyapı plan yönünü destekledi ve işlem kazandı');
  if(tags.includes('LOSS_DESPITE_PREENTRY_FLOW_SUPPORT'))L.push('giriş öncesi akış planı destekledi ama işlem kaybetti; mikroyapı tek başına yeterli değil');
  if(tags.includes('NONE_WAIT_LOSS'))L.push('NONE_WAIT girişi zarar üretti; bu yalnız yumuşak zamanlama uyarısıdır, otomatik veto değildir');
  if(tags.includes('MFE_GIVEBACK_GE_1R'))L.push('işlem '+r2(mfeR,2)+'R MFE görüp '+r2(mfeGivebackR,2)+'R geri verdi; mevcut yapı/akış yeniden doğrulansın');
  if(tags.includes('FAST_ADVERSE_MOVE'))L.push('ilk '+(hold??'?')+' dk içinde belirgin adverse hareket: giriş zamanlaması yeniden değerlendirilsin');
  if(tags.includes('LOW_PROFIT_CAPTURE'))L.push('kazanan işlem MFE potansiyelinin yalnız %'+Math.round(captureEfficiency*100)+' kadarını realize etti; erken azaltma/runner yönetimi fırsat maliyeti üretti');
  if(tags.includes('WINNER_GAVE_BACK_PROFIT'))L.push('kazanan runner tepe MFE’den '+r2(mfeGivebackR,2)+'R geri verdi; trend bozulmasında kâr koruma daha erken olabilirdi');
  if(tags.includes('MARKET_NOW_MIXED_FLOW_FAST_LOSS'))L.push('MARKET_NOW girişi karışık/adverse akışta ilk '+(hold??'?')+' dk içinde kaybetti; location iyi olsa bile timing teyidi yetersizdi');
  if(tags.includes('ORDER_FLOW_EDGE_CONTRADICTION_LOSS'))L.push('ORDER_FLOW_DEPTH edge seçildi ama seçilen yönün pre-entry akışı tuzak riski gösteriyordu; edge-kanıt tutarlılığı kontrol edilmeli');
  if(verdict==='SUCCESS'&&ec.setupFamily)L.push(ec.setupFamily+' '+side+' çalıştı');
  if(verdict==='MISTAKE'&&!L.length&&ec.setupFamily)L.push(ec.setupFamily+' '+side+' stop oldu');
  return {
    id:p.id||null,eventId:p.eventId||null,symbol:p.symbol||null,side,tier,
    source:att?(att.deepScanReason||att.attentionSource||(att.targetSources||[])[0]||null):null,
    rank:num(att?.gainerRank),ch24:ch24===null?null:r2(ch24,1),
    family:ec.setupFamily||null,lane:p.tradeLane||ec.lane||null,timing:ec.entryTiming||null,regime,
    preEntry:{state:preEntry.state,quality:preEntry.quality,trapRisk:preEntry.trapRisk===null?null:r2(preEntry.trapRisk,3),support:preEntry.support===null?null:r2(preEntry.support,3),assessment:preEntry.assessment||null},
    priceActionAtEntry:priceActionAtEntry(ec),exit,exitAuthority,net:net===null?null:r2(net,2),r:cr.r===null?null:r2(cr.r,2),rStatus:cr.status,
    outcome:{mfeR:mfeR===null?null:r2(mfeR,2),maeR:maeR===null?null:r2(maeR,2),mfeGivebackR:mfeGivebackR===null?null:r2(mfeGivebackR,2),captureEfficiency:captureEfficiency===null?null:r2(captureEfficiency,3),timeToMfeMin:timeToMfeMin===null?null:r2(timeToMfeMin,1),timeToMaeMin:timeToMaeMin===null?null:r2(timeToMaeMin,1)},
    holdMin:hold,stopPct:stopPct===null?null:r2(stopPct,2),gapMin,globalGapMin,
    openedAt:p.openedAt||null,closedMs:Number.isFinite(closed)?closed:null,
    tags,verdict,lesson:L.slice(0,3).join('; ')||null
  };
}
function stats(cards){
  const xs=cards.filter(c=>c.net!==null);
  const n=xs.length,w=xs.filter(c=>c.net>0);
  const gw=w.reduce((a,c)=>a+c.net,0),gl=-xs.filter(c=>c.net<0).reduce((a,c)=>a+c.net,0);
  const losses=xs.filter(c=>c.net<0).length;
  return {n,winPct:n?r2(100*w.length/n,1):null,net:r2(gw-gl,2),pf:gl>0?r2(gw/gl,2):(gw>0?99:null),
    avgWin:w.length?r2(gw/w.length,2):null,avgLoss:losses?r2(gl/losses,2):null};
}
// Azalan ağırlıklı Beta sonrası: kazanma olasılığı ortalaması ve alt %10 (normal yaklaşım).
function posterior(cards,decay=0.97){
  let a=1,b=1;
  for(const c of cards){if(c.net===null)continue;a=a*decay;b=b*decay;if(c.net>0)a+=1;else if(c.net<0)b+=1;}
  const m=a/(a+b),sd=Math.sqrt(a*b/((a+b)**2*(a+b+1)));
  return {mean:r2(m,3),p10:r2(Math.max(0,m-1.2816*sd),3),effN:r2(a+b-2,1)};
}
function group(cards,key){const m=new Map();for(const c of cards){const k=key(c);if(k===null)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(c);}return m;}
function rows(m,{minN=1,limit=10}={}){
  return [...m.entries()].map(([k,v])=>{const s=stats(v);return [k,s.n,s.winPct,s.net,s.pf,s.avgWin,s.avgLoss];})
    .filter(r=>r[1]>=minN).sort((a,b)=>a[3]-b[3]).slice(0,limit);
}
function buildCards(closes,{attentionOf=null}={}){
  const sorted=[...closes].sort((a,b)=>(Date.parse(a.openedAt||a.closedAt||'')||0)-(Date.parse(b.openedAt||b.closedAt||'')||0));
  const lastBySym=new Map(),cards=[],closedSeq=[];let wins=[];
  for(const p of sorted){
    const att=(p.entryContext&&p.entryContext.attention)||(typeof attentionOf==='function'?attentionOf(p):null);
    const avgWin=wins.length>=3?wins.slice(-30).reduce((a,x)=>a+x,0)/Math.min(30,wins.length):null;
    const prevGlobal=closedSeq.length?closedSeq[closedSeq.length-1]:null;
    const card=lessonCard(p,{attention:att,prev:lastBySym.get(p.symbol)||null,prevGlobal,prevTwo:closedSeq.slice(-2),avgWin});
    cards.push(card);
    if(card.net!==null&&card.net>0)wins.push(card.net);
    if(card.closedMs){
      const row={closedMs:card.closedMs,net:card.net,symbol:card.symbol,side:card.side};
      lastBySym.set(p.symbol,row); closedSeq.push(row);
    }
  }
  return cards;
}
const TIER_TR={APPROACH:'ilk 10 adayı',TOP4_10:'4–10',TOP11_24:'11–24',EARLY_ATTN:'erken ilgi',NEAR_EXPLOSION:'patlamaya yakın',TOP3:'ilk 3',ACCEL_OTHER:'hızlanan/eski havuz',UNKNOWN:'bilinmiyor'};
function digest(cards,{symbol=null,candidate=null,now=Date.now()}={}){
  const xs=cards.filter(c=>c.net!==null);
  const life=stats(xs);
  const tierSide=group(xs,c=>c.tier+'|'+c.side);
  const famSide=group(xs.filter(c=>c.family),c=>c.family+'|'+c.side);
  const regimeSide=group(xs.filter(c=>c.regime&&c.regime!=='REGIME_UNKNOWN'),c=>c.regime+'|'+c.side);
  const preEntrySide=group(xs.filter(c=>c.preEntry&&c.preEntry.state&&c.preEntry.state!=='NO_PREENTRY_DATA'),c=>c.preEntry.state+'|'+c.side);
  const paGroups=new Map();
  for(const c of xs)for(const [tf,f] of Object.entries(c.priceActionAtEntry||{})){
    if(!f)continue;
    const keys=new Set((f.orderBlocks||[]).map(z=>[tf,z.scope||'UNKNOWN',z.side,z.state||'UNKNOWN',c.side].join('|')));
    for(const k of keys){if(!paGroups.has(k))paGroups.set(k,[]);paGroups.get(k).push(c);}
  }
  const tagG=new Map();for(const c of xs)for(const t of c.tags){if(!tagG.has(t))tagG.set(t,[]);tagG.get(t).push(c);}
  const tagRows=[...tagG.entries()].filter(([t])=>!t.startsWith('R_')).map(([t,v])=>{const s=stats(v);return [t,s.n,s.winPct,s.net];}).sort((a,b)=>a[3]-b[3]);
  // Ne çalıştı / ne çalışmadı: n≥4 grup; PF ve net ile sıralı.
  const cand=[];
  for(const [k,v] of tierSide){const s=stats(v);if(s.n>=4)cand.push({k:'katman '+TIER_TR[k.split('|')[0]]+' '+k.split('|')[1],s,post:posterior(v)});}
  for(const [k,v] of famSide){const s=stats(v);if(s.n>=4)cand.push({k:'kurulum '+k.replace('|',' '),s,post:posterior(v)});}
  const fmt=x=>x.k+': n'+x.s.n+' %'+Math.round(x.s.winPct)+' net'+(x.s.net>0?'+':'')+x.s.net+'$ PF'+x.s.pf+' kaz/kay '+x.s.avgWin+'/'+x.s.avgLoss+' p≈'+x.post.mean;
  const worked=cand.filter(x=>x.s.pf!==null&&x.s.pf>=1.3&&x.s.net>0).sort((a,b)=>b.s.net-a.s.net).slice(0,4).map(fmt);
  const failed=cand.filter(x=>x.s.pf!==null&&x.s.pf<0.8&&x.s.net<0).sort((a,b)=>a.s.net-b.s.net).slice(0,4).map(fmt);
  const tagFailed=tagRows.filter(r=>r[1]>=3&&r[3]<0).slice(0,5).map(r=>r[0]+': n'+r[1]+' net'+r[3]+'$ %'+Math.round(r[2]));
  const out={
    version:'R2544.21',samples:xs.length,
    lifetime:life,
    payoffRatio:life.avgWin&&life.avgLoss?r2(life.avgWin/life.avgLoss,2):null,
    cols:['key','n','win%','netUSDT','PF','avgWin','avgLoss'],
    byTierSide:rows(tierSide,{minN:2,limit:12}),
    byFamilySide:rows(famSide,{minN:4,limit:8}),
    byRegimeSide:rows(regimeSide,{minN:3,limit:10}),
    byPreEntryFlow:rows(preEntrySide,{minN:2,limit:10}),
    byPriceAction:rows(paGroups,{minN:2,limit:8}),
    priceActionGrouping:'Overlapping immutable-entry cohorts; a trade may appear in multiple rows. Association, not causal attribution or trained weights.',
    byExit:rows(group(xs,c=>c.exit||'UNKNOWN'),{minN:3,limit:6}).map(r=>r.slice(0,4)),
    worked,failed,repeatedMistakes:tagFailed,
    howToUse:'Geçmiş sonuçlar yalnız yumuşak bağlamdır; kazanan hem kaybeden karşı örnekleri birlikte değerlendirilir. MFE/MAE, NONE_WAIT, hızlı adverse hareket, yeniden giriş ve yön tersleme benzer vakaları açıklar; otomatik veto/onay üretmez. Mevcut piyasa kanıtı önce gelir.'
  };
  if(candidate){
    const att=attentionFromCandidate(candidate),tier=tierOf(att);
    const pick=side=>{const v=tierSide.get(tier+'|'+side)||[];const s=stats(v);const q=posterior(v);return [s.n,s.winPct,s.net,s.pf,s.avgWin,s.avgLoss,q.mean,q.p10];};
    out.current={tier,tierTr:TIER_TR[tier]||tier,cols:['n','win%','net','PF','avgWin','avgLoss','pMean','pP10'],LONG:pick('LONG'),SHORT:pick('SHORT')};
  }
  const recent60=xs.filter(c=>c.closedMs&&now-c.closedMs<=60*60000).sort((a,b)=>a.closedMs-b.closedMs);
  let switches=0;for(let i=1;i<recent60.length;i++)if(recent60[i-1].symbol!==recent60[i].symbol)switches++;
  let lossStreak=0;for(let i=recent60.length-1;i>=0&&recent60[i].net<0;i--)lossStreak++;
  let cum=0,peak=0;for(const c of recent60){cum+=c.net||0;peak=Math.max(peak,cum);}
  const ordered=xs.slice().sort((a,b)=>(a.closedMs||0)-(b.closedMs||0));
  const last=ordered.at(-1)||null,prior=ordered.at(-2)||null;
  const candSym=String(candidate?.symbol||symbol||'').toUpperCase();
  const lastMin=last?.closedMs?r2((now-last.closedMs)/60000,1):null;
  const priorMin=prior?.closedMs?r2((now-prior.closedMs)/60000,1):null;
  out.sequence={
    recent60:{n:recent60.length,net:r2(recent60.reduce((a,c)=>a+(c.net||0),0),2),symbolSwitches:switches,lossStreak,peakToNowGiveback:r2(Math.max(0,peak-cum),2)},
    lastClose:last?[last.symbol,last.side,last.net,last.exit,lastMin]:null,
    candidate:candSym||null,
    quickSwitchAfterLoss:!!(candSym&&last&&last.net<0&&lastMin!==null&&lastMin<=20&&String(last.symbol).toUpperCase()!==candSym),
    returnToRecentSymbol:!!(candSym&&prior&&last&&priorMin!==null&&priorMin<=45&&String(prior.symbol).toUpperCase()===candSym&&String(last.symbol).toUpperCase()!==candSym),
    sameSymbolRecent:last&&candSym&&String(last.symbol).toUpperCase()===candSym?{side:last.side,net:last.net,minAgo:lastMin}:null,
    note:'Hızlı sembol rotasyonu/yön tersleme yalnız yumuşak risk bağlamıdır. Yeni giriş için mevcut piyasa kanıtının önceki kaybeden işlemden gerçekten farklı olup olmadığını JEV açıkça kontrol etsin; otomatik veto değildir.'
  };
  const sym=String(symbol||'').toUpperCase();
  if(sym){
    const mine=xs.filter(c=>String(c.symbol||'').toUpperCase()===sym);
    if(mine.length){
      const last=mine.at(-1);
      out.symbol={symbol:sym,trades:mine.length,net:stats(mine).net,
        lastCloseMinAgo:last.closedMs?r2((now-last.closedMs)/60000,0):null,
        recent:mine.slice(-3).reverse().map(c=>[c.side,c.tier,c.net,c.exit,c.tags.filter(t=>!t.startsWith('R_')).slice(0,3).join('+'),c.closedMs?r2((now-c.closedMs)/60000,0):null])};
    }
  }
  return out;
}
module.exports={tierOf,attentionFromCandidate,lessonCard,buildCards,digest,stats,posterior,canonicalR,regimeKeyFromSignature,preEntryForSide,exitAuthorityOf,TIER_OF_SOURCE};
