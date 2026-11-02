'use strict';
// R2544.86 TRADER BEYNİ (kullanıcı 27.10: "erken long için trader gibi düşünen, tüm verileri harmanlamayı bilen, grafikleri tüm zaman
// dilimlerinde ne dediğini anlayan bir robot ... diğer stratejilere de yardımcı"; "ücretsiz şekilde").
// Bir sinyalin "trader ekranı": 5 dk / 15 dk / 1 sa / 4 sa / 1 gün mumlar + kodun hesapladığı yapı özeti (trend, salınımlar, EMA, aralık
// konumu, hacim, taker payı), gün/hafta/ay seviyeleri, BTC, plan (giriş/stop/hedef R). Coin adı ve tarih GİZLİ, fiyatlar giriş = 100
// ölçeğinde: model fiyatı "hatırlayamaz" (sınav dönemi bazı modellerin eğitim verisiyle çakışıyor). Karar: TAKE / SKIP + güven + neden.
// Bu sürümde YALNIZ SINAV: 6 aylık geçmiş sinyaller ücretsiz modele sorulur; giriş kararı vermez.
const TB_VERSION = 'R2544.114-TRADER-BRAIN-SCREEN';
const ENGINE = require('./engine'); // R2544.88: the same causal chart engine JEV uses (closed candles only)
const TF = { m5:{ ms:300000, n:48, frame:'5m' }, m15:{ ms:900000, n:32, frame:'15m' }, h1:{ ms:3600000, n:36, frame:'1h' }, h4:{ ms:14400000, n:30, frame:'4h' }, d1:{ ms:86400000, n:20, frame:'1d' } };
// candles to fetch per timeframe so the chart engine has >= 52 closed candles (EMA50, swings, FVG history)
const FETCH = { m5:80, m15:80, h1:80, h4:80, d1:80 };
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
// R2544.98: the timeframe each setup is triggered on and the one its idea lives on
const ENTRY_TF = { LONG_EARLY_RETEST:{ trigger:'5m', structure:'15m', context:'1h / 4h / 1d', holdMax:'24h' }, SHORT_TOP_BREAK:{ trigger:'5m', structure:'15m', context:'1h / 4h / 1d', holdMax:'24h' },
  ZIRVE5_FIBO_LONG:{ trigger:'15m', structure:'1h', context:'4h / 1d', holdMax:'24h' }, ZIRVE5_FIBO_SHORT:{ trigger:'15m', structure:'1h', context:'4h / 1d', holdMax:'24h' } };
const SETUP_TEXT = {
  LONG_EARLY_RETEST:'EARLY LONG: a coin climbing the gainer list broke a previous day/week/month high on a 5m candle with >= 3x volume and has just retested that level; stop under the retest, target just under the next higher level (or 3R).',
  SHORT_TOP_BREAK:'TOP SHORT: a coin that was a top-10 gainer made a fresh 24h high, swept liquidity above a swing high and the next 5m candles broke the pre-top structure low; stop above the top.',
  ZIRVE5_FIBO_LONG:'ZIRVE-5 LONG: one of the 5 most volatile coins broke its last confirmed 15m swing high; price came back into the breakout zone and a volume-backed bull candle closed in it.',
  ZIRVE5_FIBO_SHORT:'ZIRVE-5 SHORT: one of the 5 most volatile coins broke its last confirmed 15m swing low; price came back into the breakdown zone and a volume-backed bear candle closed in it.'
};
// R2544.88 GRAFİK OKUMASI (kullanıcı 27.10: "verileri ve oluşan formasyonları price action, fvg, fibo, trend ... grafik okumayı hangi model
// yapacak"): grafiği KOD kesin hesaplar (engine.js, JEV ile aynı; yalnız kapanmış mumlar), model yorumlar. Fiyatlar ekran ölçeğinde (P) ve
// işlemin R'si cinsinden uzaklık (R: + işlem yönünde, - aleyhte).
function chartReading(raw, frame, { t, P = x => x, R = () => null } = {}) {
  try {
    const c = ENGINE.parseKlines(Array.isArray(raw) ? raw : [], t); if (c.length < 52) return null;
    const s = ENGINE.structure(c, frame); if (!s?.available) return null;
    const lvl = p => p === null || p === undefined || finite(p) === null ? null : { price:P(p), R:R(p) }, near = (a, f) => (a || []).map(f).filter(Boolean).sort((x, y) => Math.abs(x.R ?? 99) - Math.abs(y.R ?? 99));
    const sw = s.swingStructure || {}, smc = s.smcContext || {}, fib = smc.fibLevels || {}, dr = smc.dealingRange || {}, rd = s.readout || {};
    const bars = at => finite(at) === null ? null : Math.max(0, Math.round((c.at(-1).closeTime - at) / (c.at(-1).closeTime - c.at(-2).closeTime || 1)));
    return {
      trend:s.trend, swing:{ state:sw.state || null, highs:sw.highSequence || null, lows:sw.lowSequence || null, lastHigh:lvl(sw.lastConfirmedSwingHigh?.price), lastLow:lvl(sw.lastConfirmedSwingLow?.price) },
      events:(s.priceAction?.events || []).slice(-4).map(e => ({ side:e.side, kind:e.kind, scope:e.scope, ...lvl(e.level), barsAgo:bars(e.confirmedAt) })),
      openFvg:near(s.recentFairValueGaps, g => g && !g.filled ? { side:g.side, low:P(g.low), high:P(g.high), R:R((g.low + g.high) / 2), state:g.lifecycle?.state || null, tests:g.lifecycle?.testCount ?? null } : null).slice(0, 3),
      fib:fib.retracement ? { leg:fib.leg || null, priceInLegPct:finite(fib.pricePositionPct), levels:Object.fromEntries(['0.382', '0.5', '0.618', '0.786'].filter(k => finite(fib.retracement[k]) !== null).map(k => [k, lvl(fib.retracement[k])])),
        ext1272:lvl(fib.extension?.['1.272']), ext1618:lvl(fib.extension?.['1.618']) } : null,
      dealingRange:dr.zone ? { zone:dr.zone, positionPct:finite(dr.positionPct), equilibrium:lvl(dr.equilibrium) } : null,
      orderBlocks:near([...(s.orderBlocks?.bullish || []), ...(s.orderBlocks?.bearish || [])], o => o && !o.broken && o.state !== 'MITIGATED' ? { side:o.side, state:o.state, low:P(o.low), high:P(o.high), R:R((o.low + o.high) / 2), breaker:o.breaker === true } : null).filter(o => Math.abs(o.R ?? 99) <= 6).slice(0, 4),
      patterns:(s.patterns || []).slice(0, 5).map(p => ({ type:p.type, side:p.side, status:p.status })),
      liquidity:{ equalHigh:lvl(s.liquidity?.equalHigh?.price ?? s.liquidity?.equalHigh), equalLow:lvl(s.liquidity?.equalLow?.price ?? s.liquidity?.equalLow), lastSweep:s.liquidity?.lastSweep ? { side:s.liquidity.lastSweep.side || null, ...lvl(s.liquidity.lastSweep.level ?? s.liquidity.lastSweep.price) } : null,
        buySide20:lvl(s.buySideLiquidity), sellSide20:lvl(s.sellSideLiquidity) },
      momentum:{ rsi14:finite(s.rsi14), squeeze:rd.squeeze?.state || null, displacement:rd.displacement ? { dir:rd.displacement.dir, barsAgo:rd.displacement.barsAgo, retracePct:rd.displacement.retracePct, inOte:rd.displacement.inOte } : null,
        stretchZone:rd.stretch?.zone || null, chaseRisk:rd.stretch?.chaseRisk || null }
    };
  } catch { return null; }
}
// R2544.114 NET EKRAN (kullanıcı 02.11: "modeller neye karar verdiğini net bilmeli görmeli ... pro traderın gözünü bağlamışsın al şimdi
// trade yap diyorsun"): ham sayılar duruyor ama önce KODUN yazdığı brifing gelir - kural neden tetiklendi, yönetim tam olarak ne,
// her zaman diliminde her olgu BU işlem için lehte mi aleyhte mi, hedefe kadar engeller (R), BTC, 6 aylık temel oran ve başabaş isabeti.
// Kod yorum katmanıdır: her satır yalnız dayandığı sayı varsa yazılır; tahmin yok. Karar yine modelin.
const BASE_RATES = { // 6 months, every signal of the rule (Claud-Work sınav anahtarı, 1248 sinyal)
  LONG_EARLY_RETEST:{ n:504, profitPct:34, avgR:0.03 }, SHORT_TOP_BREAK:{ n:513, profitPct:39, avgR:0.03 },
  ZIRVE5_FIBO_LONG:{ n:126, profitPct:40, avgR:0.01 }, ZIRVE5_FIBO_SHORT:{ n:105, profitPct:46, avgR:0.12 } };
const MANAGEMENT = { // the default (live config 02.11); live-controller passes the real one
  LONG_EARLY_RETEST:'at +1R the stop moves to entry (a later return to entry closes at about 0R); half is closed at +2R; the rest runs to the target; exit after 24 h at the latest',
  SHORT_TOP_BREAK:'half is closed at +2R and the rest moves to break-even; the rest runs to the target; exit after 24 h at the latest',
  ZIRVE5_FIBO_LONG:'half is closed at +2R and the rest moves to break-even; exit after 24 h at the latest',
  ZIRVE5_FIBO_SHORT:'half is closed at +2R and the rest moves to break-even; exit after 24 h at the latest' };
const f1 = x => (x > 0 ? '+' : '') + Number(x).toFixed(2);
const ago = n => n === 0 ? 'on the last closed candle' : n === 1 ? '1 candle ago' : `${n} candles ago`;
const LEVEL_NAME = { PDH:'previous day', PWH:'previous week', PMH:'previous month' };
const rTxt = r => r === null || r === undefined || !Number.isFinite(r) ? '' : ` (${f1(r)}R)`;
function triggerLines(rule, trig, P, R, L) {
  if (!trig || typeof trig !== 'object') return [];
  const out = [], v = x => finite(x), at = (x, name) => v(x) !== null ? `${name} ${P(v(x))}${rTxt(R(v(x)))}` : null;
  if (rule === 'LONG_EARLY_RETEST') {
    if (v(trig.level) !== null) out.push(`broke the ${LEVEL_NAME[trig.levelName] || trig.levelName || 'previous'} high ${at(trig.level, 'at').replace(/^at /, '')}${v(trig.volMult) !== null ? ` on a 5m candle with ${v(trig.volMult).toFixed(1)}x median volume` : ''}`);
    if (v(trig.retestLow) !== null) out.push(`then came back and retested it: retest low ${P(v(trig.retestLow))}${rTxt(R(v(trig.retestLow)))}, the level held on close`);
    if (v(trig.breakoutAt) !== null && v(trig.retestAt) !== null) out.push(`breakout to retest took ${Math.round((v(trig.retestAt) - v(trig.breakoutAt)) / 300000)} five-minute candles`);
  } else if (rule === 'SHORT_TOP_BREAK') {
    if (v(trig.top) !== null) out.push(`fresh 24h top ${P(v(trig.top))}${rTxt(R(v(trig.top)))}${v(trig.topVolMult) !== null ? ` made with ${v(trig.topVolMult).toFixed(1)}x median volume` : ''}`);
    if (trig.sweep && v(trig.sweep.level) !== null) out.push(`before the top, price swept the liquidity under ${P(v(trig.sweep.level))}${rTxt(R(v(trig.sweep.level)))} (${trig.sweep.barsAgo ?? '?'} five-minute candles earlier)`);
    if (v(trig.hl) !== null) out.push(`then a 5m candle closed below the pre-top structure low ${P(v(trig.hl))}${rTxt(R(v(trig.hl)))}: the move up broke`);
  } else {
    if (v(trig.top) !== null && v(trig.bottom) !== null) out.push(`15m ${L ? 'breakout' : 'breakdown'} zone ${P(v(trig.bottom))} - ${P(v(trig.top))}${v(trig.equilibrium) !== null ? `, its middle ${P(v(trig.equilibrium))}` : ''}`);
    if (trig.confirm) out.push(`a ${L ? 'bull' : 'bear'} 15m candle closed in the zone${v(trig.confirm.body) !== null ? ` (body ${Math.round(v(trig.confirm.body) * 100)}% of its range` : ''}${v(trig.confirm.volMult) !== null ? `, ${v(trig.confirm.volMult).toFixed(1)}x volume)` : v(trig.confirm.body) !== null ? ')' : ''}`);
    if (trig.sweep) out.push('liquidity on the zone side was swept within the last 24 candles');
  }
  return out;
}
function frameLine(name, s, c, L) {
  if (!s && !c) return null;
  const pro = [], con = [], info = [], ok = x => (L && x === 'UP') || (!L && x === 'DOWN'), bad = x => (L && x === 'DOWN') || (!L && x === 'UP');
  const tr = c?.trend || s?.trend, hl = c?.swing?.highs && c?.swing?.lows ? ` (${c.swing.highs}/${c.swing.lows})` : '';
  if (tr) (ok(tr) ? pro : bad(tr) ? con : info).push(`trend ${tr}${hl}`);
  const ev = (c?.events || []).filter(e => finite(e.barsAgo) !== null).sort((a, b) => a.barsAgo - b.barsAgo)[0];
  if (ev) { const w = (L && ev.side === 'BULL') || (!L && ev.side === 'BEAR'); (w ? pro : con).push(`last structure event ${ev.side} ${ev.kind} ${ago(ev.barsAgo)}${rTxt(ev.R)}`); }
  const zone = c?.dealingRange?.zone, pos = c?.dealingRange?.positionPct;
  if (zone) { const hi = /PREMIUM|ABOVE/.test(zone), lo = /DISCOUNT|BELOW/.test(zone), txt = `price in ${zone.toLowerCase().replace(/_/g, ' ')}${pos !== null && pos !== undefined ? ` (${Math.round(pos)}% of the dealing range)` : ''}`;
    ((L && lo) || (!L && hi) ? pro : (L && hi) || (!L && lo) ? con : info).push(txt); }
  const ext = s && finite(s.closeVsEma20) !== null && finite(s.atrPct) > 0 ? s.closeVsEma20 / s.atrPct : null;
  if (ext !== null && Math.abs(ext) >= 2) ((L && ext > 0) || (!L && ext < 0) ? con : pro).push(`close ${f1(s.closeVsEma20)}% from EMA20 = ${Math.abs(ext).toFixed(1)} ATR stretched ${ext > 0 ? 'up' : 'down'}`);
  const rsi = finite(c?.momentum?.rsi14);
  if (rsi !== null && (rsi >= 70 || rsi <= 30)) ((L && rsi >= 70) || (!L && rsi <= 30) ? con : pro).push(`RSI ${Math.round(rsi)} ${rsi >= 70 ? 'overbought' : 'oversold'}`);
  for (const p of (c?.patterns || []).filter(p => p.status === 'CONFIRMED').slice(0, 2)) ((L && p.side === 'LONG') || (!L && p.side === 'SHORT') ? pro : p.side ? con : info).push(`${String(p.type).toLowerCase().replace(/_/g, ' ')} confirmed`);
  const d = c?.momentum?.displacement; if (d && finite(d.barsAgo) !== null && d.barsAgo <= 3) ((L && d.dir === 'UP') || (!L && d.dir === 'DOWN') ? pro : con).push(`strong ${d.dir} displacement ${ago(d.barsAgo)}`);
  const ch = c?.momentum?.chaseRisk?.[L ? 'LONG' : 'SHORT']; if (ch === 'HIGH') con.push('chase risk HIGH (entry far from the base of the move)');
  const vm = finite(s?.volLast3VsMedian), tb = finite(s?.takerBuyShareLast3);
  if (vm !== null && vm >= 2) { const flow = tb === null ? '' : `, taker buy ${Math.round(tb * 100)}%`, w = tb === null ? 0 : L ? (tb >= 0.55 ? 1 : tb <= 0.45 ? -1 : 0) : (tb <= 0.45 ? 1 : tb >= 0.55 ? -1 : 0);
    (w > 0 ? pro : w < 0 ? con : info).push(`last 3 candles ${vm.toFixed(1)}x median volume${flow}`); }
  return { frame:name, for:pro, against:con, info, lean:pro.length > con.length ? 'FOR' : con.length > pro.length ? 'AGAINST' : 'MIXED' };
}
function roomLines(tfs, levels, targetR, L) {
  const obs = [], sup = [], seen = new Set(), add = (a, r, txt) => { if (!Number.isFinite(r)) return; const k = txt + r.toFixed(2); if (seen.has(k)) return; seen.add(k); a.push({ r, txt }); };
  for (const l of levels || []) { if (!Number.isFinite(l.R)) continue; const opp = L ? /High|high/.test(l.name) : /Low|low/.test(l.name);
    if (opp && l.R > 0 && l.R < targetR) add(obs, l.R, l.name); if (!opp && l.R < 0 && l.R > -1.5) add(sup, l.R, l.name); }
  for (const [n, t] of Object.entries(tfs || {})) { const c = t?.chartReading; if (!c) continue; const f = t && TF[n]?.frame;
    for (const g of c.openFvg || []) { const opp = (L && g.side === 'BEAR') || (!L && g.side === 'BULL'); if (opp && g.R > 0 && g.R < targetR) add(obs, g.R, `${f} ${g.side.toLowerCase()} FVG`); if (!opp && g.R < 0 && g.R > -1.5) add(sup, g.R, `${f} ${g.side.toLowerCase()} FVG`); }
    for (const o of c.orderBlocks || []) { const opp = (L && o.side === 'BEAR') || (!L && o.side === 'BULL'); if (opp && o.R > 0 && o.R < targetR) add(obs, o.R, `${f} ${o.side.toLowerCase()} order block`); if (!opp && o.R < 0 && o.R > -1.5) add(sup, o.R, `${f} ${o.side.toLowerCase()} order block`); } }
  obs.sort((a, b) => a.r - b.r); sup.sort((a, b) => b.r - a.r);
  return { obstacles:obs.slice(0, 6).map(x => `${x.txt} at ${f1(x.r)}R`), firstObstacleR:obs.length ? +obs[0].r.toFixed(2) : null,
    protection:sup.slice(0, 4).map(x => `${x.txt} at ${f1(x.r)}R`) };
}
function briefing({ side, rule, plan, tfs, levels, btc, trigger, management, P, R }) {
  const L = side === 'LONG', tR = finite(plan.targetR), be = tR > 0 ? Math.round(100 / (1 + tR)) : null, br = BASE_RATES[rule] || null;
  const frames = ['d1', 'h4', 'h1', 'm15', 'm5'].map(n => frameLine(TF[n].frame, tfs[n]?.structure, tfs[n]?.chartReading, L)).filter(Boolean);
  const room = roomLines(tfs, levels, tR ?? 99, L);
  const fr = frames.map(f => `${f.frame}: leans ${f.lean}${f.for.length ? ' | for: ' + f.for.join('; ') : ''}${f.against.length ? ' | against: ' + f.against.join('; ') : ''}${f.info.length ? ' | neutral: ' + f.info.join('; ') : ''}`);
  const tally = { for:frames.filter(f => f.lean === 'FOR').map(f => f.frame), against:frames.filter(f => f.lean === 'AGAINST').map(f => f.frame) };
  return {
    readFirst:'Desk briefing written by code from closed candles. Every line comes from a number below; nothing is guessed. Check it against the raw data if you doubt it.',
    trade:`${SETUP_TEXT[rule] ? SETUP_TEXT[rule].split(':')[0] : side + ' ' + rule}. Entry 100, stop ${plan.stop} (-1R = ${plan.stopDistancePct}% away), target ${plan.target} (${f1(tR)}R).`,
    management:management || MANAGEMENT[rule] || plan.management,
    whyTheRuleFired:triggerLines(rule, trigger, P, R, L),
    timeframes:fr,
    timeframeTally:`leaning FOR this ${side}: ${tally.for.join(', ') || 'none'}; leaning AGAINST: ${tally.against.join(', ') || 'none'}`,
    roomToTarget:room.obstacles.length ? `opposite levels between entry and the target: ${room.obstacles.join('; ')}. First one at ${f1(room.firstObstacleR)}R (the half close is at +2R).` : `no opposite level found between entry and the ${f1(tR)}R target`,
    behindEntry:room.protection.length ? `levels between entry and the stop side (they should hold for the trade): ${room.protection.join('; ')}` : 'no level between entry and the stop side',
    btc:btc ? `BTC 1h trend ${btc.trend1h}, ${f1(btc.change12hPct)}% in 12 h, ${f1(btc.closeVsEma20Pct)}% from its EMA20` : 'BTC data missing',
    odds:`${br ? `Over 6 months ${br.profitPct}% of all signals of this rule ended in profit (n ${br.n}, average ${f1(br.avgR)}R): taking every signal is about break-even, so the job is to tell the good ones from the bad ones. ` : ''}` +
      `${be !== null ? `With a ${f1(tR)}R target the trade has positive expectancy if price reaches the target before the stop in more than about ${be}% of cases like this one.` : ''}`
  };
}
// the screen. k = { m5, m15, h1, h4, d1, btc1h } raw klines CLOSED before t; plan = { side, rule, entry, stop, target }
function entryPacket({ k, plan, t, extra = null, trigger = null, management = null }) {
  const L = plan.side === 'LONG', s = 100 / plan.entry, P = x => x === null || x === undefined || !Number.isFinite(x) ? null : +(x * s).toFixed(3);
  const risk = Math.abs(plan.entry - plan.stop), R = p => p === null || p === undefined ? null : +(((L ? p - plan.entry : plan.entry - p) / risk)).toFixed(2);
  const tfs = {};
  for (const [name, cfg] of Object.entries(TF)) {
    const kk = rows(k[name]).filter(x => x.t + cfg.ms <= t); if (kk.length < 12) { tfs[name] = null; continue; }
    const vm = med(kk.slice(-20).map(x => x.v)) || 1;
    tfs[name] = { structure:structure(kk), chartReading:chartReading(k[name], cfg.frame, { t, P, R }), candles:{ fields:'[open,high,low,close,volVsMedian20,takerBuyShare] price scaled: entry = 100', rows:kk.slice(-cfg.n).map(x => [P(x.o), P(x.h), P(x.l), P(x.c), +(x.v / vm).toFixed(2), x.tb !== null && x.v > 0 ? +(x.tb / x.v).toFixed(2) : null]) } };
  }
  const d1 = rows(k.d1), lv = htfLevels(d1, t), h24 = rows(k.h1).filter(x => x.t + 3600000 <= t).slice(-24);
  const level = (name, v) => v ? { name, price:P(v), R:R(v) } : null;
  const levels = [level('prevDayHigh', lv.prevDay?.high), level('prevDayLow', lv.prevDay?.low), level('prevWeekHigh', lv.prevWeek?.high), level('prevWeekLow', lv.prevWeek?.low),
    level('prevMonthHigh', lv.prevMonth?.high), level('prevMonthLow', lv.prevMonth?.low), level('high24h', h24.length ? Math.max(...h24.map(x => x.h)) : null), level('low24h', h24.length ? Math.min(...h24.map(x => x.l)) : null)].filter(Boolean);
  const b = rows(k.btc1h).filter(x => x.t + 3600000 <= t), bs = b.length >= 12 ? structure(b) : null;
  const pl = { entry:100, stop:P(plan.stop), target:P(plan.target), targetR:R(plan.target), stopDistancePct:+(risk / plan.entry * 100).toFixed(2),
    management:management || MANAGEMENT[plan.rule] || 'half closed at +2R, the rest moved to break-even; exit after 24 h at the latest' };
  const btc = bs ? { trend1h:bs.trend, change12hPct:bs.change12Pct, closeVsEma20Pct:bs.closeVsEma20 } : null;
  // R2544.114: the briefing comes FIRST; the old "most signals lost / taking every signal earns nothing" line is replaced by the neutral odds in it
  const screen = briefing({ side:plan.side, rule:plan.rule, plan:pl, tfs, levels, btc, trigger, management:pl.management, P, R });
  return { contract:TB_VERSION, task:'ENTRY', side:plan.side, screen, setup:SETUP_TEXT[plan.rule] || plan.rule, tradeTimeframe:ENTRY_TF[plan.rule] || null,
    plan:pl, timeframes:tfs, levels, btc, extra };
}
// R2544.98 (kullanıcı 28.10: "işlem açılan zaman dilimi çok önemli; insan hissi: pro trader burada ne yapardı"): girişte de işlemin kendi
// zaman dilimi ve profesyonelin düşünme sırası açıkça verilir; yön dayatılmaz.
const ENTRY_SYSTEM = 'You are a senior discretionary crypto-futures trader on a professional desk. A fixed rule has fired a trade setup and the desk must agree whether to TAKE it or SKIP it; your vote counts. ' +
  'You see the same screen a desk trader sees: the plan, five timeframes (5m, 15m, 1h, 4h, 1d) with a structure summary AND a chartReading computed by code from closed candles (market structure BOS/CHoCH, open fair value gaps, Fibonacci of the last leg with OTE, dealing range premium/discount, fresh order blocks, candlestick and geometric patterns, equal highs/lows and liquidity sweeps, squeeze and displacement; every level with its distance in R, + in the trade direction) and the recent candles; trust the chartReading numbers over your own estimate from raw candles, the day/week/month levels around the price (with their distance in R), and BTC. ' +
  'Prices are scaled so that entry = 100; the coin name and the date are hidden on purpose. ' +
  'Think like a professional at the screen, in this order: (1) WHAT TRADE IS THIS: tradeTimeframe says the timeframe the trade is triggered on and the one its idea lives on; an intraday trade is won or lost on those, higher timeframes are context. ' +
  '(2) CONTEXT: read top-down (1d and 4h, then 1h): with or against the larger trend, premium or discount, which big levels and liquidity pools sit between entry and target. ' +
  '(3) TRIGGER: is the trigger fresh and clean (volume, taker flow, a real close beyond the level) or late and extended (chasing a move already far from its base)? ' +
  '(4) ROOM AND RISK: is there room to the target before the first opposite level, is the stop behind real structure or in the noise? (5) BTC and flow right now. ' +
  'START WITH `screen`: the desk briefing written by code from the same numbers - why the rule fired, the exact trade management, every timeframe fact marked FOR or AGAINST this trade, the opposite levels between entry and target in R, BTC, and the odds (6-month base rate and the break-even hit rate for this target). Then check the raw timeframes if you want. ' +
  'Decide whether a disciplined professional TAKES this trade or SKIPS it. Taking every signal of this rule was about break-even over 6 months, so the edge is in telling the good ones apart: do not skip by habit, and do not take by habit. ' +
  'Be consistent: pTarget is your probability that price reaches the target before the stop; if it is clearly above the break-even hit rate in screen.odds, the trade has positive expectancy and SKIP needs a concrete reason from the screen; if it is below, TAKE needs one. ' +
  'Before you answer, ask yourself what would have to happen for this trade to fail and how likely that is on this screen. ' +
  'Answer ONLY with JSON: {"decision":"TAKE|SKIP","confidence":0-100,"pTarget":0-100,"reasonTr":"Türkçe 1-2 cümle: hangi zaman dilimi ne diyor","keyRisk":"Türkçe kısa: en büyük risk"}. pTarget = your probability that price reaches the target before the stop.';
// R2544.87 (kullanıcı 27.10: zaman dilimlerine entegre): kurulda her üyenin bir koltuğu var; aynı ekranı görür ama kendi bölümünden sorumludur
// R2544.93 (TradingAgents fikri: boğa / ayı araştırmacı tartışması; 27.10 sınavda 69/69 GİRME - masada lehte savunan yoktu): koltuk SIRASI
// kurul küçükken hangi koltukların dolduğunu belirler -> 3 üyede de price action + BOĞA + AYI masada olur.
const ENTRY_ROLES = [
  { key:'price action', prefer:['CLAUDE', 'GEMINI', 'GEMMA'], text:'PRICE ACTION READER. You own the chartReading of every timeframe: BOS/CHoCH, open FVGs, Fibonacci/OTE, premium/discount, order blocks, patterns, equal highs/lows and sweeps. Say which of them supports or blocks this trade and where (in R). Judge neutrally.' },
  { key:'boğa', prefer:['DEEPSEEK', 'LLAMA', 'GEMMA', 'NEMOTRON'], text:'BULL ADVOCATE. Build the strongest honest case FOR taking this trade from the evidence on the screen (fresh structure, room to the target, supportive levels, flow). Vote TAKE unless the chart clearly contradicts it; if you vote SKIP, say exactly which evidence forced you.' },
  { key:'ayı', prefer:['GLM', 'NEMOTRON', 'GPTOSS', 'MINIMAX'], text:'BEAR ADVOCATE / RISK OFFICER. Build the strongest honest case AGAINST the trade: stop distance, opposite levels between entry and target, extension, the base rate. Vote SKIP unless the evidence for the trade is clear; if you vote TAKE, say what convinced you.' },
  { key:'1g/4sa', prefer:['GEMINI', 'MINIMAX', 'CLAUDE'], text:'HIGHER-TIMEFRAME ANALYST. You own the 1d and 4h timeframes and the day/week/month levels: the larger trend, where price sits in the larger range, which levels are above and below and how far they are in R. Judge the trade from that context first.' },
  { key:'5dk+akış', prefer:['DEEPSEEK', 'MINIMAX', 'XING'], text:'TRIGGER AND FLOW ANALYST. You own the 5m timeframe: the trigger candle and the last candles, wicks, volume versus median, taker-buy share, and BTC right now.' }];
function parseEntry(text) {
  try { const j = JSON.parse(String(text || '').match(/\{[\s\S]*\}/)?.[0]);
    if (!['TAKE', 'SKIP'].includes(j.decision)) return { ok:false, reason:'TB_DECISION_INVALID' };
    const cl = v => Math.max(0, Math.min(100, finite(v) ?? 50));
    return { ok:true, decision:j.decision, confidence:cl(j.confidence), pTarget:cl(j.pTarget), reasonTr:String(j.reasonTr || '').slice(0, 400), keyRisk:String(j.keyRisk || '').slice(0, 200) };
  } catch { return { ok:false, reason:'TB_JSON_INVALID' }; }
}
const validEntry = text => parseEntry(text).ok;
module.exports = { TB_VERSION, ENTRY_TF, TF, FETCH, chartReading, rows, swings, structure, htfLevels, SETUP_TEXT, BASE_RATES, MANAGEMENT, briefing, entryPacket, ENTRY_SYSTEM, ENTRY_ROLES, parseEntry, validEntry };
