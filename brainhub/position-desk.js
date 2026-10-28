'use strict';
// R2544.84 POZİSYON MASASI (kullanıcı 26.10: "bir trade ofisinde açılan pozisyonların grafikleri, verileri, lazım olan her şeyi
// ekranlarında gören traderler ... profesyonel hareket ediyor"; "test için ücretsiz, JEV için canlıda kullanılabilecek yapı olsun;
// canlıda ücretsiz kapalı olduğunda da çalışsın").
// İlk 3 ve ZİRVE-5'in AÇIK lotlarına bir trader bakar: 5 dk / 15 dk / 1 sa mumlar (taker payı dahil), seviyeler, açık pozisyon,
// BTC, girişteki bilgi (indikatör, otopsi bağlamı, tecrübe, benzer durumlar) ve lotun planı (stop, 2R kâr koruma, hedef, süre).
// Karar: TUT / KISMİ KÂR AL / STOPU YAKLAŞTIR / ÇIK. TEST'te ücretsiz model, CANLI'da JEV (ücretsiz yedek); ikisi de yoksa kural sürer.
// GÖLGE: karar kaydedilir ve Office'te görünür, EMİR GÖNDERİLMEZ. Kapanınca aynı 5 dk yolda "masa uygulasaydı" ile "yalnız kural"
// aynı benzetimle karşılaştırılır (fark R). Yetki ancak ölçümden sonra kullanıcı onayıyla açılır.
const fs = require('fs'), path = require('path');
const DESK_VERSION = 'R2544.98-POSITION-DESK-PRO';
const M5 = 300000, HOUR = 3600000;
const ACTIONS = ['HOLD', 'TAKE_PARTIAL', 'TIGHTEN_STOP', 'EXIT'];
const STOP_CHOICES = ['KEEP', 'BREAKEVEN', 'LAST_5M_SWING', 'LOCK_1R'];
const REASONS = ['STRUCTURE_INTACT', 'MOMENTUM_FADING', 'STRUCTURE_BROKEN_AGAINST', 'TARGET_ZONE_NEAR', 'OPPOSITE_FLOW_STRONG', 'VOLUME_CLIMAX', 'TIME_DECAY', 'NO_EDGE'];
const ACTION_TR = { HOLD:'TUT', TAKE_PARTIAL:'KISMİ KÂR AL', TIGHTEN_STOP:'STOPU YAKLAŞTIR', EXIT:'ÇIK' };
const REASON_TR = { STRUCTURE_INTACT:'yapı sağlam', MOMENTUM_FADING:'ivme zayıflıyor', STRUCTURE_BROKEN_AGAINST:'yapı aleyhe kırıldı', TARGET_ZONE_NEAR:'hedef bölgesine yakın',
  OPPOSITE_FLOW_STRONG:'karşı akış güçlü', VOLUME_CLIMAX:'hacim doruğu', TIME_DECAY:'süre doluyor', NO_EDGE:'belirgin avantaj yok' };
// R2544.86: 9Router (Kiro'daki ücretsiz Claude Sonnet/Haiku, DeepSeek, GLM) önce, OpenRouter ücretsiz sonra; CANLI'da JEV en önde
const DEFAULT_CONFIG = { enabled:true, cadenceMin:15, firstAfterMin:5, moveTriggerR:0.5, freeDailyCap:300, routerDailyCap:300, testJudges:['COMMITTEE', 'FREE'], liveJudges:['JEV', 'COMMITTEE', 'FREE'], authority:false };
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const configFile = root => path.join(root, 'config', 'position-desk.json');
function readConfig(root) {
  let raw = {}; try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')); } catch {}
  const c = { ...DEFAULT_CONFIG, ...raw };
  const num = (v, lo, hi, d) => { const n = finite(v); return n !== null && n >= lo && n <= hi ? n : d; };
  const judges = (v, d) => Array.isArray(v) ? v.filter(x => ['FREE', 'JEV', 'ROUTER', 'COMMITTEE'].includes(x)) : d;
  // authority stays false in this build: the desk is shadow-only until it is measured
  return { enabled:c.enabled !== false, cadenceMin:num(c.cadenceMin, 5, 120, 15), firstAfterMin:num(c.firstAfterMin, 1, 60, 5), moveTriggerR:num(c.moveTriggerR, 0.2, 3, 0.5),
    freeDailyCap:num(c.freeDailyCap, 0, 2000, 300), routerDailyCap:num(c.routerDailyCap, 0, 2000, 300), testJudges:judges(c.testJudges, DEFAULT_CONFIG.testJudges), liveJudges:judges(c.liveJudges, DEFAULT_CONFIG.liveJudges), authority:false };
}
const rows = k => (Array.isArray(k) ? k : []).map(r => ({ t:Number(r[0]), o:+r[1], h:+r[2], l:+r[3], c:+r[4], v:+r[5], tb:r.length > 9 ? +r[9] : null })).filter(r => Number.isFinite(r.t) && r.c > 0);
const rnd = (x, p) => x === null || !Number.isFinite(x) ? null : Number(x.toPrecision(p));
function riskOf(lot) { const e = finite(lot.entryPrice), s = finite(lot.initialStopPrice) ?? finite(lot.stopPrice); return e > 0 && s > 0 ? Math.abs(e - s) : null; }
function favR(lot, p) { const e = finite(lot.entryPrice), r = riskOf(lot); return r ? (lot.side === 'LONG' ? p - e : e - p) / r : null; }
// last confirmed 5m swing on the protective side (LONG: swing low, SHORT: swing high), 2 candles each side
function lastSwing(k5, side) {
  for (let i = k5.length - 3; i >= 2; i--) {
    const x = k5[i], L = side === 'LONG';
    const ok = L ? [i - 2, i - 1, i + 1, i + 2].every(j => k5[j].l > x.l) : [i - 2, i - 1, i + 1, i + 2].every(j => k5[j].h < x.h);
    if (ok) return L ? x.l : x.h;
  }
  return null;
}
// stop choices that only TIGHTEN (never widen) and stay on the safe side of the mark
function stopCandidates(lot, mark, k5) {
  const L = lot.side === 'LONG', e = finite(lot.entryPrice), cur = finite(lot.stopPrice), r = riskOf(lot), fee = finite(lot.part?.beFee) ?? 0.0012;
  const out = { KEEP:cur }; if (!(e > 0 && cur > 0 && r > 0 && mark > 0)) return out;
  const tighter = p => p > 0 && (L ? p > cur && p < mark * 0.999 : p < cur && p > mark * 1.001);
  const add = (k, p) => { if (tighter(p)) out[k] = Number(p.toPrecision(8)); };
  add('BREAKEVEN', L ? e * (1 + fee) : e * (1 - fee));
  const sw = lastSwing(k5, lot.side); if (sw) add('LAST_5M_SWING', L ? sw * 0.999 : sw * 1.001);
  add('LOCK_1R', L ? e + r : e - r);
  return out;
}
function compactK(k, n) { return k.slice(-n).map(x => [new Date(x.t).toISOString().slice(5, 16), rnd(x.o, 6), rnd(x.h, 6), rnd(x.l, 6), rnd(x.c, 6), rnd(x.v, 4), x.tb !== null && x.v > 0 ? Number((x.tb / x.v).toFixed(2)) : null]); }
// the screen the trader looks at (compact: free models have small context; JEV's 48 kB cap)
// R2544.98: the timeframe the trade was opened on (trigger) and the one its idea lives on (structure)
const TRADE_TF = { ILK3:{ trigger:'5m', structure:'15m', context:'1h', note:'Ilk 3: 5m breakout/retest of a day/week/month level (LONG) or a 5m break of the pre-top structure (SHORT); intraday trade, 24 h at most' },
  ZIRVE5:{ trigger:'15m', structure:'1h', context:'1h', note:'ZIRVE-5: 15m swing break and retest of the breakout zone; intraday trade, 24 h at most' } };
function atrR(k, r) { if (!(r > 0) || k.length < 15) return null; const a = k.slice(-15); let s = 0; for (let i = 1; i < a.length; i++) s += Math.max(a[i].h - a[i].l, Math.abs(a[i].h - a[i - 1].c), Math.abs(a[i].l - a[i - 1].c)); return Number((s / 14 / r).toFixed(2)); }
function packet({ lot, mark, k5, k15, k1h, btc5, oi, why, now, lane, chart = null }) {
  const L = lot.side === 'LONG', e = finite(lot.entryPrice), r = riskOf(lot), nowR = favR(lot, mark);
  const path5 = k5.filter(x => x.t + M5 > lot.openedAt);
  const mfeR = path5.length ? Math.max(...path5.map(x => favR(lot, L ? x.h : x.l))) : null, maeR = path5.length ? Math.min(...path5.map(x => favR(lot, L ? x.l : x.h))) : null;
  const day = k1h.slice(-24), cands = stopCandidates(lot, mark, k5), f = lot.entryFeatures || {};
  const lv = { high24h:day.length ? Math.max(...day.map(x => x.h)) : null, low24h:day.length ? Math.min(...day.map(x => x.l)) : null, brokenLevel:finite(lot.level), top:finite(lot.top), zone:lot.z5zone || null };
  const btc1h = btc5.length >= 12 ? Number(((btc5.at(-1).c / btc5.at(-12).o - 1) * 100).toFixed(2)) : null;
  const oiChg1h = oi.length >= 13 ? Number(((oi.at(-1) / oi.at(-13) - 1) * 100).toFixed(2)) : null;
  return {
    contract:DESK_VERSION, lane, symbol:lot.symbol, side:lot.side, rule:lot.rule, mode:lot.mode, why:why || null, tradeTimeframe:TRADE_TF[lane] || TRADE_TF.ILK3,
    noiseR:{ m5:atrR(k5, r), m15:atrR(k15, r), h1:atrR(k1h, r) },
    position:{ entry:e, initialStop:finite(lot.initialStopPrice) ?? finite(lot.stopPrice), currentStop:finite(lot.stopPrice), target:finite(lot.tpPrice), targetR:r && finite(lot.tpPrice) ? Number(Math.abs(lot.tpPrice - e) / r).toFixed(2) * 1 : null,
      mark, nowR:rnd(nowR, 3), mfeR:rnd(mfeR, 3), maeR:rnd(maeR, 3), givebackR:mfeR !== null && nowR !== null ? rnd(Math.max(0, mfeR - nowR), 3) : null,
      toPartR:lot.part && lot.part.done !== true && nowR !== null ? rnd(finite(lot.part.atR) - nowR, 3) : null, toTargetR:r && finite(lot.tpPrice) && nowR !== null ? rnd(Math.abs(lot.tpPrice - e) / r - nowR, 3) : null, minutesOpen:Math.round((now - lot.openedAt) / 60000), minutesLeft:Math.max(0, Math.round((lot.deadline - now) / 60000)), leverage:lot.leverage,
      profitProtection:lot.part ? { atR:lot.part.atR, share:lot.part.share, price:finite(lot.part.price), done:lot.part.done === true } : null, breakEvenMoved:lot.beMoved === true },
    stopChoices:cands,
    entryInfo:{ indicators:f.ind?.ok ? { vdpmObstacle2R:f.ind.vdpm?.obstacle2R ?? null, lthTrend:f.ind.lth?.trend ?? null, lrvpTrendWith:f.ind.lrvp?.trendWith ?? null } : null, entryContext:f.entryCtx || null,
      experience:f.experience ? { verdict:f.experience.verdict, text:String(f.experience.text || '').slice(0, 300) } : null, similar:f.similar?.text ? String(f.similar.text).slice(0, 300) : null },
    market:{ levels:lv, btc1hPct:btc1h, openInterestChange1hPct:oiChg1h, chartReading:chart, // R2544.88: code-computed price action (15m, 1h)
      candles:{ note:'[time UTC, open, high, low, close, volume, takerBuyShare]', m5:compactK(k5, 36), m15:compactK(k15, 24), h1:compactK(k1h, 24) } },
    measuredFacts:['the plan already takes half at +2R and moves the rest to break-even by itself (6 months: +0.41R per trade versus +0.27R at +1R)',
      'mechanical habits did not help on average over 6 months: always trailing the stop, or always exiting early; a fixed trailing stop on TOP SHORT was clearly worse (t -3.3)',
      'what is tested now is case-by-case judgment on this screen: holding through a broken trade and choking a healthy one both cost R'],
  };
}
// R2544.98 (kullanıcı 28.10: "modellere masa giriş ve çıkışlarda mütabık ve tam yetkili olması lazım ... hassas talimat vermen lazım ki
// şaşırmasınlar; veriler, grafik, kâr durumu asla göz ardı edilmemeli; işlem açılan zaman dilimi çok önemli; insan hissi: pro trader burada
// ne yapardı"). Eski talimat "HOLD is the measured default" diyordu: 13 işlemde 90 kararın 85'i TUT, LAB +2R'den stopa döndü (benim hatam).
// Yeni talimat tarafsız: TUT da ÇIK da ekrandan kanıt ister; işlemin kendi zaman dilimi, açık kâr, geri verilen kâr ve gürültü payı önce gelir.
const SYSTEM = 'You are a senior discretionary crypto-futures trader on a professional desk. You manage ONE open position that a rule opened; every decision you make adds or costs R. ' +
  'You see everything the desk sees: the plan, the open profit, the charts and the code-computed chartReading. Work through it like a professional at the screen, in this order:\n' +
  '1) WHAT TRADE IS THIS. tradeTimeframe tells you the timeframe the trade was opened on (trigger) and the timeframe its idea lives on (structure). Judge the trade first on those two. ' +
  'Higher timeframes are context: they do not excuse sitting through a trade whose own trigger and structure have turned, and one candle on a lower timeframe is not a reason to leave a healthy trade.\n' +
  '2) WHERE AM I IN THE PLAN. position.nowR (now), mfeR (best so far), givebackR (how much of the best open profit is already given back), toPartR (distance to the automatic +2R profit protection), toTargetR, minutesOpen and minutesLeft. ' +
  'Open profit is money. Giving back most of it while the chart turns is a mistake; so is choking a trade that is trending normally.\n' +
  '3) NOISE OR SIGNAL. noiseR is one average candle (ATR14) of each timeframe in R. A pullback inside about one trigger-timeframe candle with the structure intact is normal. ' +
  'A close back through the broken level or the entry zone, a break of the last trigger-timeframe swing against the position, or a CHoCH against it on the structure timeframe means the idea is failing.\n' +
  '4) READ THE SCREEN. chartReading (5m, 15m, 1h; computed by code from the candles, trust its numbers over your own estimate): BOS/CHoCH against the position, an opposite FVG or order block just ahead, ' +
  'a liquidity sweep and rejection at the target zone, a volume climax with long wicks, taker flow flipping, open interest, BTC moving hard against.\n' +
  '5) ACT LIKE A PROFESSIONAL.\n' +
  ' - HOLD: the trigger and structure timeframes still agree with the position and nothing concrete on the screen argues against it. Let it work.\n' +
  ' - TIGHTEN_STOP (choose BREAKEVEN, LAST_5M_SWING or LOCK_1R from stopChoices; never wider): the trade has already paid (around mfeR >= 1) and the screen starts to turn: momentum fading, rejection at a level, giveback growing. Protect what is paid but leave room for a live trend.\n' +
  ' - TAKE_PARTIAL (close half of what is left): in profit at or near a strong opposite level or the target zone and it is being rejected, or a climax candle against you.\n' +
  ' - EXIT (close everything): the idea is broken on its own timeframe, or open profit is about to become a loss with the chart against the position. Do not wait for the stop when the chart already says the trade is over.\n' +
  'Neither holding nor acting is a default: both need evidence from THIS screen. Mechanical habits (always trail, always hold, always exit early) did not help over 6 months; case-by-case judgment is why you are at this desk. ' +
  'Before you answer, ask yourself what changed since entry, what would prove you wrong, and which mistake you would regret more here: giving the profit back or cutting a winner.\n' +
  'Answer ONLY with JSON: {"action":"HOLD|TAKE_PARTIAL|TIGHTEN_STOP|EXIT","stopChoice":"KEEP|BREAKEVEN|LAST_5M_SWING|LOCK_1R","reason":"' + REASONS.join('|') + '","confidence":0-100,"reasonTr":"Türkçe tek cümle: hangi zaman dilimi ve kâr durumu ne diyor","watchTr":"Türkçe: fikrini ne değiştirir"}';
function freePrompt(p) { return { system:SYSTEM, prompt:JSON.stringify(p) }; }
// R2544.87: desk seats (the same committee members, each owning a part of the open position's screen)
const DESK_ROLES = [
  { key:'büyük resim', prefer:['GEMINI', 'CLAUDE', 'MINIMAX'], text:'HIGHER-TIMEFRAME TRADER. You own the 1h candles and the day levels: is the larger picture still with the position, and is a big level or a liquidity pool right ahead? Context only: do not overrule a broken trigger/structure timeframe with it.' },
  { key:'price action', prefer:['CLAUDE', 'GEMINI'], text:'PRICE ACTION READER. You own the chartReading (15m and 1h): BOS/CHoCH against the position, FVGs and order blocks in the way, Fibonacci/OTE, liquidity sweeps, patterns.' },
  { key:'5dk+akış', prefer:['DEEPSEEK'], text:'TAPE READER. You own the 5m candles and the 5m chartReading (the trigger timeframe of Ilk 3): volume, taker-buy share, wicks, the last 5m swing, BTC and open interest right now. Say whether the tape still pushes with the position or has flipped.' },
  { key:'risk', prefer:['GLM'], text:'RISK OFFICER. You own the plan and the open profit: nowR, mfeR, givebackR, toPartR, toTargetR, noiseR, time left and the stopChoices. Protect profit that is already paid when the screen turns against it; do not choke a trade that is working inside normal noise.' },
  { key:'yapı', prefer:['MINIMAX'], text:'STRUCTURE TRADER. You own the structure timeframe of this trade (tradeTimeframe.structure: 15m for Ilk 3, 1h for ZIRVE-5): has structure broken against the position (CHoCH, close back through the broken level), is the move extended, is the target zone being rejected?' }];
function parseFree(text) {
  try { const raw = String(text || '').match(/\{[\s\S]*\}/)?.[0]; const j = JSON.parse(raw);
    if (!ACTIONS.includes(j.action)) return { ok:false, reason:'DESK_ACTION_INVALID' };
    return { ok:true, action:j.action, stopChoice:STOP_CHOICES.includes(j.stopChoice) ? j.stopChoice : 'KEEP', reason:REASONS.includes(j.reason) ? j.reason : 'NO_EDGE',
      confidence:Math.max(0, Math.min(100, finite(j.confidence) ?? 50)), reasonTr:String(j.reasonTr || '').slice(0, 300), watchTr:String(j.watchTr || '').slice(0, 200) };
  } catch { return { ok:false, reason:'DESK_JSON_INVALID' }; }
}
const validFree = text => parseFree(text).ok;
// a decision is accepted only inside the safe contract: TIGHTEN_STOP must name an offered (tighter) stop, otherwise it is HOLD
function validate(d, cands) {
  if (!d?.ok) return d;
  if (d.action === 'TIGHTEN_STOP') { const p = finite(cands?.[d.stopChoice]); if (d.stopChoice === 'KEEP' || !(p > 0)) return { ...d, action:'HOLD', downgraded:'STOP_CHOICE_NOT_TIGHTER' }; return { ...d, stopPrice:p }; }
  return d;
}
function decisionText(d) { if (!d) return null; return `${ACTION_TR[d.action] || d.action}${d.action === 'TIGHTEN_STOP' && d.stopPrice ? ' → ' + d.stopPrice : ''} • ${REASON_TR[d.reason] || d.reason || ''}${d.reasonTr ? ' • ' + d.reasonTr : ''}`; }
// same 5m path, same rules for both: plan only vs plan + desk decisions (each applied from the next candle on)
function simulate(plan, k5, decisions) {
  const L = plan.side === 'LONG', e = plan.entry, r = Math.abs(e - plan.stop), fv = p => (L ? p - e : e - p) / r; if (!(r > 0)) return null;
  let open = 1, R = 0, stop = plan.stop, partDone = false; const dq = [...(decisions || [])].sort((a, b) => a.at - b.at); let di = 0;
  const close = (frac, p) => { const q = Math.min(open, frac); R += q * fv(p); open -= q; };
  const tighter = p => p > 0 && (L ? p > stop : p < stop);
  for (const x of k5) {
    if (x.t + M5 <= plan.openedAt) continue;
    if (x.t >= plan.deadline) { close(open, x.o); break; }
    while (di < dq.length && dq[di].at <= x.t) { const d = dq[di++];
      if (d.action === 'EXIT') close(open, d.mark); else if (d.action === 'TAKE_PARTIAL') close(open * 0.5, d.mark); else if (d.action === 'TIGHTEN_STOP' && tighter(d.stopPrice)) stop = d.stopPrice; }
    if (open <= 1e-9) break;
    if (L ? x.l <= stop : x.h >= stop) { close(open, L ? Math.min(x.o, stop) : Math.max(x.o, stop)); break; }
    if (!partDone && plan.partAtR > 0 && (L ? x.h : -x.l) >= (L ? e + plan.partAtR * r : -(e - plan.partAtR * r))) {
      partDone = true; close(open * plan.partShare, L ? e + plan.partAtR * r : e - plan.partAtR * r); const be = L ? e * (1 + plan.beFee) : e * (1 - plan.beFee); if (tighter(be)) stop = be; }
    if (plan.tp > 0 && (L ? x.h >= plan.tp : x.l <= plan.tp)) { close(open, plan.tp); break; }
  }
  if (open > 1e-9 && k5.length) close(open, k5.at(-1).c);
  return Number(R.toFixed(3));
}
function counterfactual(desk, k5raw) {
  const plan = desk?.plan, ds = (desk?.decisions || []).filter(d => d.action !== 'HOLD'), k5 = rows(k5raw);
  if (!plan || !k5.length) return { ok:false, reason:'NO_PATH' };
  const ruleR = simulate(plan, k5, []), deskR = ds.length ? simulate(plan, k5, ds) : ruleR;
  if (ruleR === null || deskR === null) return { ok:false, reason:'SIM_FAILED' };
  return { ok:true, version:DESK_VERSION, ruleR, deskR, deltaR:Number((deskR - ruleR).toFixed(3)), acted:ds.length, reviews:(desk.decisions || []).length };
}
function planOf(lot) {
  const r = riskOf(lot); if (!r) return null;
  return { side:lot.side, entry:finite(lot.entryPrice), stop:finite(lot.initialStopPrice) ?? finite(lot.stopPrice), tp:finite(lot.tpPrice), partAtR:finite(lot.part?.atR) ?? 0, partShare:finite(lot.part?.share) ?? 0.5,
    beFee:finite(lot.part?.beFee) ?? 0.0012, openedAt:finite(lot.openedAt), deadline:finite(lot.deadline) };
}
// comparison table for Office: closed lessons whose desk counterfactual is computed
function summary(lessons) {
  const c = (lessons || []).filter(l => l?.desk?.cf?.ok);
  const by = {}; for (const l of c) { const k = l.lane === 'ZIRVE5' ? 'ZIRVE5' : 'ILK3'; (by[k] ||= []).push(l.desk.cf); }
  const agg = a => ({ n:a.length, acted:a.filter(x => x.acted > 0).length, ruleR:Number((a.reduce((s, x) => s + x.ruleR, 0) / a.length).toFixed(3)), deskR:Number((a.reduce((s, x) => s + x.deskR, 0) / a.length).toFixed(3)),
    deltaR:Number((a.reduce((s, x) => s + x.deltaR, 0) / a.length).toFixed(3)), better:a.filter(x => x.deltaR > 0.05).length, worse:a.filter(x => x.deltaR < -0.05).length });
  return Object.fromEntries(Object.entries(by).map(([k, a]) => [k, agg(a)]));
}
// which trader looks: TEST -> testJudges (free), LIVE -> liveJudges (JEV, then free). Nothing available -> the rule keeps managing.
async function judge({ packet, mode, cfg, judges, stats }) {
  const order = mode === 'LIVE' ? cfg.liveJudges : cfg.testJudges, st = stats || {}, tried = [];
  for (const j of order) {
    if (j === 'JEV') {
      if (typeof judges?.jev !== 'function') { tried.push('JEV_NOT_WIRED'); continue; }
      let r; try { r = await judges.jev({ packet, choices:{ reasons:REASONS } }); } catch { r = { ok:false, reason:'JEV_DESK_EXCEPTION' }; }
      if (r?.called) st.jev = (st.jev || 0) + 1;
      if (r?.ok && ACTIONS.includes(r.action)) return { ok:true, judge:'JEV', model:r.model || 'jev', d:{ ok:true, action:r.action, stopChoice:STOP_CHOICES.includes(r.stopChoice) ? r.stopChoice : 'KEEP', reason:REASONS.includes(r.reason) ? r.reason : 'NO_EDGE', confidence:null, reasonTr:'', watchTr:'' }, costUsd:finite(r.costUsd), tried };
      tried.push('JEV:' + (r?.reason || 'FAILED')); continue;
    }
    if (j === 'COMMITTEE') { // R2544.86: free models decide together (round 1 independent, round 2 debate, majority; no majority -> HOLD)
      if (!judges?.committee || typeof judges.committee.decide !== 'function') { tried.push('COMMITTEE_NOT_WIRED'); continue; }
      const q = freePrompt(packet); let r;
      try { r = await judges.committee.decide({ system:q.system, prompt:q.prompt, validate:validFree, parse:parseFree, field:'action', fallback:'HOLD', roles:DESK_ROLES }); } catch { r = { ok:false, reason:'COMMITTEE_EXCEPTION' }; }
      st.committee = (st.committee || 0) + 1;
      if (r?.ok) {
        // R2544.98 "mütabık": no single majority, but MORE THAN HALF of the final voters want to reduce risk -> the mildest reducing action they voted
        const finalV = (r.round2 || r.votes || []).filter(v => v.ok), REDUCE = ['TIGHTEN_STOP', 'TAKE_PARTIAL', 'EXIT'], red = finalV.filter(v => REDUCE.includes(v.vote.action));
        const reduceAgreed = r.consensus === 'NO_MAJORITY_DEFAULT' && finalV.length >= 2 && red.length > finalV.length / 2;
        const fin = reduceAgreed ? REDUCE.find(a => red.some(v => v.vote.action === a)) : r.final, all = [...(r.round2 || []), ...(r.votes || [])].filter(v => v.ok), pickV = all.find(v => v.vote.action === fin)?.vote || null;
        const stops = all.filter(v => v.vote.action === 'TIGHTEN_STOP').map(v => v.vote.stopChoice), order = ['BREAKEVEN', 'LAST_5M_SWING', 'LOCK_1R'];
        const stopChoice = fin === 'TIGHTEN_STOP' ? (order.find(k => stops.includes(k)) || 'KEEP') : 'KEEP'; // the least aggressive tightening that was voted
        const votes = (r.round2 || r.votes || []).map(v => ({ m:String(v.member).replace(/^ROUTER:|^FREE:|^OR:/, ''), a:v.vote?.action || 'ERR', s:v.seat || null }));
        return { ok:true, judge:'COMMITTEE', model:votes.map(v => v.m).join(' + '), d:{ ok:true, action:fin, stopChoice, reason:pickV?.reason || 'NO_EDGE', confidence:null,
          reasonTr:(r.consensus === 'UNANIMOUS' ? 'oybirliği: ' : r.consensus === 'MAJORITY_AFTER_DEBATE' ? 'tartışma sonrası çoğunluk: ' : reduceAgreed ? `çoğunluk riski azaltmak istedi (${red.length}/${finalV.length}) → en yumuşağı: ` : r.consensus === 'SINGLE_VOTER_DEFAULT' ? 'tek oy, yetki yok → TUT: ' : 'çoğunluk yok → TUT: ') + (pickV?.reasonTr || ''), watchTr:pickV?.watchTr || '' },
          committee:{ consensus:reduceAgreed ? 'REDUCE_MAJORITY' : r.consensus, rounds:r.rounds, votes }, tried };
      }
      tried.push('COMMITTEE:' + (r?.reason || 'FAILED')); continue;
    }
    if (j === 'FREE' || j === 'ROUTER') { // same text contract for both free sources
      const w = j === 'FREE' ? judges?.free : judges?.router, key = j === 'FREE' ? 'free' : 'router', cap = j === 'FREE' ? cfg.freeDailyCap : (cfg.routerDailyCap ?? 300);
      if (!w || typeof w.review !== 'function') { tried.push(j + '_NOT_WIRED'); continue; }
      if ((st[key] || 0) >= cap) { tried.push(j + '_DAILY_CAP'); continue; }
      const q = freePrompt(packet); let r;
      try { r = await w.review({ system:q.system, prompt:q.prompt, validate:validFree, role:'POSITION_DESK' }); } catch { r = { ok:false, reason:j + '_DESK_EXCEPTION' }; }
      if (r?.called) st[key] = (st[key] || 0) + 1;
      const d = r?.ok ? parseFree(r.text) : null;
      if (d?.ok) return { ok:true, judge:j, model:r.model || (j === 'FREE' ? 'openrouter/free' : '9router'), d, tried };
      tried.push(j + ':' + (r?.reason || d?.reason || 'FAILED'));
    }
  }
  return { ok:false, tried };
}
module.exports = { DESK_VERSION, TRADE_TF, atrR, ACTIONS, STOP_CHOICES, REASONS, ACTION_TR, REASON_TR, DEFAULT_CONFIG, configFile, readConfig, rows, riskOf, favR, lastSwing, stopCandidates, packet,
  SYSTEM, DESK_ROLES, freePrompt, parseFree, validFree, judge, validate, decisionText, simulate, counterfactual, planOf, summary };
