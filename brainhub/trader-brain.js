'use strict';
// R2544.86 TRADER BEYNİ (kullanıcı 27.10: "erken long için trader gibi düşünen, tüm verileri harmanlamayı bilen, grafikleri tüm zaman
// dilimlerinde ne dediğini anlayan bir robot ... diğer stratejilere de yardımcı"; "ücretsiz şekilde").
// Bir sinyalin "trader ekranı": 5 dk / 15 dk / 1 sa / 4 sa / 1 gün mumlar + kodun hesapladığı yapı özeti (trend, salınımlar, EMA, aralık
// konumu, hacim, taker payı), gün/hafta/ay seviyeleri, BTC, plan (giriş/stop/hedef R). Coin adı ve tarih GİZLİ, fiyatlar giriş = 100
// ölçeğinde: model fiyatı "hatırlayamaz" (sınav dönemi bazı modellerin eğitim verisiyle çakışıyor). Karar: TAKE / SKIP + güven + neden.
// Bu sürümde YALNIZ SINAV: 6 aylık geçmiş sinyaller ücretsiz modele sorulur; giriş kararı vermez.
const TB_VERSION = 'R2544.86-TRADER-BRAIN';
const TF = { m5:{ ms:300000, n:48 }, m15:{ ms:900000, n:32 }, h1:{ ms:3600000, n:36 }, h4:{ ms:14400000, n:30 }, d1:{ ms:86400000, n:20 } };
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const rows = k => (Array.isArray(k) ? k : []).map(r => Array.isArray(r) ? { t:+r[0], o:+r[1], h:+r[2], l:+r[3], c:+r[4], v:+r[5], tb:r.length > 9 ? +r[9] : null } : r).filter(r => Number.isFinite(r.t) && r.c > 0);
const med = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
function ema(a, n) { let e = null; const k = 2 / (n + 1); for (const x of a) e = e === null ? x : x * k + e * (1 - k); return e; }
function swings(k, w = 2) {
  const hs = [], ls = [];
  for (let i = w; i < k.length - w; i++) {
    let H = true, L = true; for (let j = i - w; j <= i + w; j++) { if (j === i) continue; if (k[j].h >= k[i].h) H = false; if (k[j].l <= k[i].l) L = false; }
    if (H) hs.push({ i, p:k[i].h }); if (L) ls.push({ i, p:k[i].l });
  }
  return { hs, ls };
}
// a structure summary per timeframe on CLOSED candles only
function structure(k) {
  if (k.length < 12) return null;
  const c = k.map(x => x.c), last = k.at(-1), sw = swings(k), h2 = sw.hs.slice(-2), l2 = sw.ls.slice(-2);
  let trend = 'RANGE';
  if (h2.length === 2 && l2.length === 2) { if (h2[1].p > h2[0].p && l2[1].p > l2[0].p) trend = 'UP'; else if (h2[1].p < h2[0].p && l2[1].p < l2[0].p) trend = 'DOWN'; }
  const e20 = ema(c, 20), e50 = ema(c, Math.min(50, c.length)), w = k.slice(-20), hi = Math.max(...w.map(x => x.h)), lo = Math.min(...w.map(x => x.l));
  const tr = k.slice(-14).map((x, i, a) => i ? Math.max(x.h - x.l, Math.abs(x.h - a[i - 1].c), Math.abs(x.l - a[i - 1].c)) : x.h - x.l), atr = tr.reduce((s, x) => s + x, 0) / tr.length;
  const v3 = k.slice(-3).reduce((s, x) => s + x.v, 0) / 3, vm = med(k.slice(-23, -3).map(x => x.v));
  const tb3 = k.slice(-3).reduce((s, x) => s + (x.tb ?? 0), 0), vv3 = k.slice(-3).reduce((s, x) => s + x.v, 0);
  const lastBreak = (() => { const H = sw.hs.at(-1), L = sw.ls.at(-1); const brokeUp = H && k.slice(H.i + 3).some(x => x.c > H.p), brokeDn = L && k.slice(L.i + 3).some(x => x.c < L.p);
    return brokeUp && !brokeDn ? 'BROKE_SWING_HIGH' : brokeDn && !brokeUp ? 'BROKE_SWING_LOW' : brokeUp && brokeDn ? 'BOTH' : 'NONE'; })();
  return { trend, lastBreak, closeVsEma20:e20 ? +((last.c / e20 - 1) * 100).toFixed(2) : null, ema20VsEma50:e50 ? +((e20 / e50 - 1) * 100).toFixed(2) : null,
    rangePos20:hi > lo ? +((last.c - lo) / (hi - lo)).toFixed(2) : null, change12Pct:k.length > 12 ? +((last.c / k.at(-13).c - 1) * 100).toFixed(2) : null,
    atrPct:+(atr / last.c * 100).toFixed(2), volLast3VsMedian:vm > 0 ? +(v3 / vm).toFixed(2) : null, takerBuyShareLast3:vv3 > 0 && last.tb !== null ? +(tb3 / vv3).toFixed(2) : null,
    lastCandle:{ bodyPct:+((last.c - last.o) / last.o * 100).toFixed(2), upperWickPct:+((last.h - Math.max(last.o, last.c)) / last.o * 100).toFixed(2), lowerWickPct:+((Math.min(last.o, last.c) - last.l) / last.o * 100).toFixed(2) } };
}
// previous day / week / month high-low from daily candles closed before `t`
function htfLevels(d1, t) {
  const day = 86400000, done = d1.filter(x => x.t + day <= t); if (!done.length) return {};
  const pd = done.at(-1), dt = new Date(t), dow = (dt.getUTCDay() + 6) % 7, weekStart = Math.floor(t / day) * day - dow * day;
  const pw = done.filter(x => x.t >= weekStart - 7 * day && x.t < weekStart), ms = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1), pms = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() - 1, 1);
  const pm = done.filter(x => x.t >= pms && x.t < ms), hl = a => a.length ? { high:Math.max(...a.map(x => x.h)), low:Math.min(...a.map(x => x.l)) } : null;
  return { prevDay:{ high:pd.h, low:pd.l }, prevWeek:hl(pw), prevMonth:hl(pm) };
}
const SETUP_TEXT = {
  LONG_EARLY_RETEST:'EARLY LONG: a coin climbing the gainer list broke a previous day/week/month high on a 5m candle with >= 3x volume and has just retested that level; stop under the retest, target just under the next higher level (or 3R).',
  SHORT_TOP_BREAK:'TOP SHORT: a coin that was a top-10 gainer made a fresh 24h high, swept liquidity above a swing high and the next 5m candles broke the pre-top structure low; stop above the top.',
  ZIRVE5_FIBO_LONG:'ZIRVE-5 LONG: one of the 5 most volatile coins broke its last confirmed 15m swing high; price came back into the breakout zone and a volume-backed bull candle closed in it.',
  ZIRVE5_FIBO_SHORT:'ZIRVE-5 SHORT: one of the 5 most volatile coins broke its last confirmed 15m swing low; price came back into the breakdown zone and a volume-backed bear candle closed in it.'
};
// the screen. k = { m5, m15, h1, h4, d1, btc1h } raw klines CLOSED before t; plan = { side, rule, entry, stop, target }
function entryPacket({ k, plan, t, extra = null }) {
  const L = plan.side === 'LONG', s = 100 / plan.entry, P = x => x === null || x === undefined || !Number.isFinite(x) ? null : +(x * s).toFixed(3);
  const risk = Math.abs(plan.entry - plan.stop), R = p => p === null || p === undefined ? null : +(((L ? p - plan.entry : plan.entry - p) / risk)).toFixed(2);
  const tfs = {};
  for (const [name, cfg] of Object.entries(TF)) {
    const kk = rows(k[name]).filter(x => x.t + cfg.ms <= t); if (kk.length < 12) { tfs[name] = null; continue; }
    const vm = med(kk.slice(-20).map(x => x.v)) || 1;
    tfs[name] = { structure:structure(kk), candles:{ fields:'[open,high,low,close,volVsMedian20,takerBuyShare] price scaled: entry = 100', rows:kk.slice(-cfg.n).map(x => [P(x.o), P(x.h), P(x.l), P(x.c), +(x.v / vm).toFixed(2), x.tb !== null && x.v > 0 ? +(x.tb / x.v).toFixed(2) : null]) } };
  }
  const d1 = rows(k.d1), lv = htfLevels(d1, t), h24 = rows(k.h1).filter(x => x.t + 3600000 <= t).slice(-24);
  const level = (name, v) => v ? { name, price:P(v), R:R(v) } : null;
  const levels = [level('prevDayHigh', lv.prevDay?.high), level('prevDayLow', lv.prevDay?.low), level('prevWeekHigh', lv.prevWeek?.high), level('prevWeekLow', lv.prevWeek?.low),
    level('prevMonthHigh', lv.prevMonth?.high), level('prevMonthLow', lv.prevMonth?.low), level('high24h', h24.length ? Math.max(...h24.map(x => x.h)) : null), level('low24h', h24.length ? Math.min(...h24.map(x => x.l)) : null)].filter(Boolean);
  const b = rows(k.btc1h).filter(x => x.t + 3600000 <= t), bs = b.length >= 12 ? structure(b) : null;
  return { contract:TB_VERSION, task:'ENTRY', side:plan.side, setup:SETUP_TEXT[plan.rule] || plan.rule,
    plan:{ entry:100, stop:P(plan.stop), target:P(plan.target), targetR:R(plan.target), stopDistancePct:+(risk / plan.entry * 100).toFixed(2),
      management:'half closed at +2R, the rest moved to break-even; exit after 24 h at the latest' },
    timeframes:tfs, levels, btc:bs ? { trend1h:bs.trend, change12hPct:bs.change12Pct, closeVsEma20Pct:bs.closeVsEma20 } : null, extra,
    baseRate:'Over 6 months most signals of this setup lost; the average result was about 0R per trade. Taking every signal earns nothing.' };
}
const ENTRY_SYSTEM = 'You are an experienced crypto futures trader. A fixed rule has fired a trade setup; you see the same screen a desk trader sees: the plan, ' +
  'five timeframes (5m, 15m, 1h, 4h, 1d) with a structure summary computed by code and the recent candles, the day/week/month levels around the price (with their distance in R), and BTC. ' +
  'Prices are scaled so that entry = 100; the coin name and the date are hidden on purpose. ' +
  'Read the timeframes top-down (1d and 4h context, 1h structure, 15m and 5m trigger), weigh where the opposite levels sit before the target, whether the move is extended or fresh, volume and taker flow, and BTC. ' +
  'Decide whether a disciplined professional TAKES this trade or SKIPS it. Skipping is fine: most signals of this setup lose. ' +
  'Answer ONLY with JSON: {"decision":"TAKE|SKIP","confidence":0-100,"pTarget":0-100,"reasonTr":"Türkçe 1-2 cümle: hangi zaman dilimi ne diyor","keyRisk":"Türkçe kısa: en büyük risk"}. pTarget = your probability that price reaches the target before the stop.';
// R2544.87 (kullanıcı 27.10: zaman dilimlerine entegre): kurulda her üyenin bir koltuğu var; aynı ekranı görür ama kendi bölümünden sorumludur
const ENTRY_ROLES = [
  { key:'1g/4sa', text:'HIGHER-TIMEFRAME ANALYST. You own the 1d and 4h timeframes and the day/week/month levels: the larger trend, where price sits in the larger range, which levels are above and below and how far they are in R. Judge the trade from that context first.' },
  { key:'1sa/15dk', text:'STRUCTURE ANALYST. You own the 1h and 15m timeframes: swing structure, the last break, whether the move is fresh or already extended, and how the retest/rejection looks.' },
  { key:'5dk+akış', text:'TRIGGER AND FLOW ANALYST. You own the 5m timeframe: the trigger candle and the last candles, wicks, volume versus median, taker-buy share, and BTC right now.' },
  { key:'risk', text:'RISK OFFICER. You own the plan: stop distance, target in R, every opposite level between entry and target, and the base rate. Argue against the trade unless the evidence for it is clear.' }];
function parseEntry(text) {
  try { const j = JSON.parse(String(text || '').match(/\{[\s\S]*\}/)?.[0]);
    if (!['TAKE', 'SKIP'].includes(j.decision)) return { ok:false, reason:'TB_DECISION_INVALID' };
    const cl = v => Math.max(0, Math.min(100, finite(v) ?? 50));
    return { ok:true, decision:j.decision, confidence:cl(j.confidence), pTarget:cl(j.pTarget), reasonTr:String(j.reasonTr || '').slice(0, 400), keyRisk:String(j.keyRisk || '').slice(0, 200) };
  } catch { return { ok:false, reason:'TB_JSON_INVALID' }; }
}
const validEntry = text => parseEntry(text).ok;
module.exports = { TB_VERSION, TF, rows, swings, structure, htfLevels, SETUP_TEXT, entryPacket, ENTRY_SYSTEM, ENTRY_ROLES, parseEntry, validEntry };
