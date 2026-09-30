'use strict';
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
function canonicalR(p){
  const r=num(p?.rMultiple),risk=num(p?.riskQuote),qty=num(p?.initialQuantity??p?.quantity);
  if(risk===null||risk<=0||qty===null||qty<=0||r===null)return {r:null,status:'UNMEASURED'};
  if(Math.abs(r)>20)return {r:null,status:'OUTLIER_R'};
  // Stop mesafesi anlamsız derecede darsa (≤%0,05) R şişer: ölçülmüş sayılmaz.
  const sd=num(p?.stopDistancePct);
  if(sd!==null&&sd<=0.05)return {r:null,status:'OUTLIER_R'};
  return {r,status:'MEASURED'};
}
const WIN_EXITS=new Set(['TP1_RUNNER_TRAIL','TP1_BREAKEVEN','TAKE_PROFIT','JEV_PARTIAL_TAKE_PROFIT','JEV_PARTIAL_THEN_EXTERNAL_CLOSE']);
function lessonCard(close,{attention=null,prev=null,avgWin=null}={}){
  const p=close||{},ec=p.entryContext&&typeof p.entryContext==='object'?p.entryContext:{};
  const att=attention||ec.attention||null;
  const tier=tierOf(att);
  const net=num(p.netPnl),hold=num(p.holdMinutes),stopPct=num(p.stopDistancePct);
  const cr=canonicalR(p);
  const opened=Date.parse(p.openedAt||''),closed=Date.parse(p.closedAt||'');
  const gapMin=prev&&Number.isFinite(opened)&&Number.isFinite(prev.closedMs)?r2((opened-prev.closedMs)/60000,1):null;
  const side=String(p.side||'').toUpperCase()||null;
  const exit=p.exitType||null;
  const ch24=num(att?.change24hPct);
  const tags=[];
  if(exit==='TP1_RUNNER_TRAIL')tags.push('WIN_TP1_RUNNER');
  else if(exit==='TP1_BREAKEVEN')tags.push('WIN_TP1_BREAKEVEN');
  else if(net!==null&&net>0)tags.push('WIN_OTHER_CLOSE');
  if(exit==='STOP_LOSS')tags.push(hold!==null&&hold<=5?'LOSS_FAST_STOP':'LOSS_FULL_STOP');
  if(exit==='JEV_EXIT_NOW'&&net!==null&&net<0)tags.push('LOSS_JEV_EXIT');
  if(exit==='TP1_THEN_STOP')tags.push('RUNNER_GAVE_BACK');
  if(gapMin!==null&&gapMin>=0&&gapMin<15)tags.push(num(prev?.net)!==null&&prev.net>0?'RAPID_REENTRY_AFTER_WIN':'RAPID_REENTRY_AFTER_LOSS');
  if(stopPct!==null&&stopPct>=3)tags.push('WIDE_STOP');
  if(stopPct!==null&&stopPct<0.6)tags.push('TIGHT_STOP');
  if(tier==='TOP3'&&side==='LONG')tags.push('LEADER_CHASE_LONG');
  if(tier==='TOP3'&&side==='SHORT')tags.push('LEADER_FADE_SHORT');
  if(ch24!==null&&ch24>=25&&side==='LONG')tags.push('EXTENDED_24H_LONG');
  if(net!==null&&net<0&&avgWin!==null&&avgWin>0&&-net>1.5*avgWin)tags.push('OVERSIZED_LOSS');
  if(net!==null&&net<0&&hold!==null&&hold>=90)tags.push('LONG_HOLD_LOSS');
  if(cr.status!=='MEASURED')tags.push('R_'+cr.status);
  let verdict='NEUTRAL';
  if(net!==null&&net>0&&(WIN_EXITS.has(exit)||(cr.r!==null&&cr.r>=0.5)))verdict='SUCCESS';
  else if(net!==null&&net<0&&(exit==='STOP_LOSS'||exit==='JEV_EXIT_NOW'||exit==='TP1_THEN_STOP'||(cr.r!==null&&cr.r<=-0.5)))verdict='MISTAKE';
  const L=[];
  if(tags.includes('RAPID_REENTRY_AFTER_WIN')&&net<0)L.push('kazançtan hemen sonra aynı coine yeniden giriş zararla bitti');
  if(tags.includes('RAPID_REENTRY_AFTER_LOSS')&&net<0)L.push('zarardan hemen sonra aynı coine intikam girişi');
  if(tags.includes('LEADER_CHASE_LONG')&&net<0)L.push('ilk 3 yükselende LONG kovalama');
  if(tags.includes('EXTENDED_24H_LONG')&&net<0)L.push('24s +%'+Math.round(ch24)+' uzamış coinde LONG');
  if(tags.includes('LOSS_FAST_STOP'))L.push('stop '+(hold??'?')+' dk içinde vuruldu: giriş yeri/zamanlaması zayıf');
  if(tags.includes('WIDE_STOP')&&net<0)L.push('%'+r2(stopPct,1)+' geniş stop büyük kayıp üretti');
  if(tags.includes('OVERSIZED_LOSS'))L.push('kayıp ortalama kazancın '+r2(-net/avgWin,1)+' katı');
  if(tags.includes('WIN_TP1_RUNNER'))L.push('TP1 + iz süren stop: kârı büyüten çıkış');
  if(verdict==='SUCCESS'&&ec.setupFamily)L.push(ec.setupFamily+' '+side+' çalıştı');
  if(verdict==='MISTAKE'&&!L.length&&ec.setupFamily)L.push(ec.setupFamily+' '+side+' stop oldu');
  return {
    id:p.id||null,eventId:p.eventId||null,symbol:p.symbol||null,side,tier,
    source:att?(att.deepScanReason||att.attentionSource||(att.targetSources||[])[0]||null):null,
    rank:num(att?.gainerRank),ch24:ch24===null?null:r2(ch24,1),
    family:ec.setupFamily||null,lane:p.tradeLane||ec.lane||null,timing:ec.entryTiming||null,
    exit,net:net===null?null:r2(net,2),r:cr.r===null?null:r2(cr.r,2),rStatus:cr.status,
    holdMin:hold,stopPct:stopPct===null?null:r2(stopPct,2),gapMin,
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
  const lastBySym=new Map(),cards=[];let wins=[];
  for(const p of sorted){
    const att=(p.entryContext&&p.entryContext.attention)||(typeof attentionOf==='function'?attentionOf(p):null);
    const avgWin=wins.length>=3?wins.slice(-30).reduce((a,x)=>a+x,0)/Math.min(30,wins.length):null;
    const card=lessonCard(p,{attention:att,prev:lastBySym.get(p.symbol)||null,avgWin});
    cards.push(card);
    if(card.net!==null&&card.net>0)wins.push(card.net);
    if(card.closedMs)lastBySym.set(p.symbol,{closedMs:card.closedMs,net:card.net});
  }
  return cards;
}
const TIER_TR={APPROACH:'ilk 10 adayı',TOP4_10:'4–10',TOP11_24:'11–24',EARLY_ATTN:'erken ilgi',NEAR_EXPLOSION:'patlamaya yakın',TOP3:'ilk 3',ACCEL_OTHER:'hızlanan/eski havuz',UNKNOWN:'bilinmiyor'};
function digest(cards,{symbol=null,candidate=null,now=Date.now()}={}){
  const xs=cards.filter(c=>c.net!==null);
  const life=stats(xs);
  const tierSide=group(xs,c=>c.tier+'|'+c.side);
  const famSide=group(xs.filter(c=>c.family),c=>c.family+'|'+c.side);
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
    version:'R2544.16',samples:xs.length,
    lifetime:life,
    payoffRatio:life.avgWin&&life.avgLoss?r2(life.avgWin/life.avgLoss,2):null,
    cols:['key','n','win%','netUSDT','PF','avgWin','avgLoss'],
    byTierSide:rows(tierSide,{minN:2,limit:12}),
    byFamilySide:rows(famSide,{minN:4,limit:8}),
    byExit:rows(group(xs,c=>c.exit||'UNKNOWN'),{minN:3,limit:6}).map(r=>r.slice(0,4)),
    worked,failed,repeatedMistakes:tagFailed,
    howToUse:'Kendi kâr/zarar geçmişin: çalışanı tekrarla, zarar üreten kalıbı tekrarlama. Yumuşak bağlam; veto değil, piyasa kanıtı önce gelir.'
  };
  if(candidate){
    const att=attentionFromCandidate(candidate),tier=tierOf(att);
    const pick=side=>{const v=tierSide.get(tier+'|'+side)||[];const s=stats(v);const q=posterior(v);return [s.n,s.winPct,s.net,s.pf,s.avgWin,s.avgLoss,q.mean,q.p10];};
    out.current={tier,tierTr:TIER_TR[tier]||tier,cols:['n','win%','net','PF','avgWin','avgLoss','pMean','pP10'],LONG:pick('LONG'),SHORT:pick('SHORT')};
  }
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
module.exports={tierOf,attentionFromCandidate,lessonCard,buildCards,digest,stats,posterior,canonicalR,TIER_OF_SOURCE};
