'use strict';
// R2544.80 İŞLEM OTOPSİSİ (kullanıcı 26.10: "zarar eden işlemlerde kesinlikle neden zarar ettiğini, kâr edenlerde nasıl kazandığını
// net çıkarım yapması ... tek bir kurala odaklanmaması ... her zaman aynı koşulda kazandım/kaybettim dememeli ... verileri iyi kayıt
// edip çıkarımları çok iyi yapması lazım ki tek düze bir beyin oluşmasın").
// Bir kapanan işlemin 5 dk fiyat yolu (girişten 3 sa önce -> çıkıştan 24 sa sonra) ve aynı aralıkta BTC'den, KANITLI nedenler:
//   yön      stoptan sonra fiyat önce +1R'ye mi gitti (yön doğru, stop avlandı) yoksa stopun 1R daha ötesine mi (yön yanlış)
//   zamanlama ilk 15 dk'da ters dönüş; girişten önceki 30 dk'da fiyat zaten >= 1,5R gitmişti (geç giriş)
//   yol      karşı hacim seviyesine (girişte kayıtlı VDPM) gelip döndü
//   piyasa   BTC işlem süresince >= %0,8 ters / yönde
//   hacim    girişten sonraki 30 dk hacmi önceki 3 saatin ortancasının < 0,8x (takip yok) / >= 1,5x (hacimli takip)
//   çıkış    kârın çoğunu geri verdi; hedeften sonra 24 sa içinde >= 2R daha gitti (hedef erken); kâr koruma sonrası başabaş
// Her neden bir ölçümdür (kanıt sayısıyla); tek bir kural değildir. Öğrenme tarafı (benzer durumlar, neden dağılımı) top3-hunter.js'te.
const AUTOPSY_VERSION = 'R2544.80-AUTOPSY';
const M5 = 300000, DAY = 86400000;
const finite = v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
const rows5 = k => (Array.isArray(k) ? k : []).map(x => Array.isArray(x) ? { t:+x[0], o:+x[1], h:+x[2], l:+x[3], c:+x[4], v:+(x[7] ?? x[5] ?? 0) } : { t:+x.t, o:+x.o, h:+x.h, l:+x.l, c:+x.c, v:+(x.v || 0) })
  .filter(x => [x.t, x.o, x.h, x.l, x.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const tr2 = v => String(Number(v).toFixed(1)).replace('.', ',');
const CAUSE_TR = {
  HIZLI_TERS:'giriş hemen ters döndü (ilk 15 dk, 0,5R bile görmedi)', STOP_AVI:'yön doğruydu, stop avlandı (stoptan sonra fiyat +1R’ye gitti)',
  YANLIS_YON:'yön yanlıştı (stoptan sonra fiyat 1R daha ters gitti)', KARSI_SEVIYE:'karşı hacim seviyesine gelip döndü', PIYASA_TERS:'piyasa (BTC) işleme ters gitti',
  TAKIP_HACMI_YOK:'girişten sonra hacim gelmedi', GEC_GIRIS:'girişten önceki 30 dk’da fiyat zaten yönde gitmişti', ZAMAN:'24 saat doldu, hareket gelmedi',
  TEMIZ_DEVAM:'temiz devam (ters yönde 0,3R’den az geri çekildi)', DIRENC_SONRASI:'önce sarsıldı (0,6R+ ters), sonra döndü', PIYASA_DESTEGI:'piyasa (BTC) yönde destekledi',
  HACIMLI_TAKIP:'girişten sonra güçlü hacim geldi', KAR_GERI_VERDI:'kârın çoğunu geri verdi (çıkış yönetimi)', HEDEF_ERKEN:'hedef erken kaldı (sonra 2R+ daha gitti)',
  KAR_KORUMA:'kâr koruma yarıyı aldı, kalan başabaşta kapandı', BELIRSIZ_YON:'stoptan sonra fiyat 24 sa içinde ne +1R’ye ne 1R daha tersine gitti'
};
// lesson: {side, entryPrice, stopPct, targetPct, openedAt, closedAt, rMultiple, exitType, mfeR?, tags?, features?.ind?.vdpm?.nearestR}
// k5 / btc5: 5 dk mumlar [t, o, h, l, c, (base), (closeTime), quoteVolume] ya da {t,o,h,l,c,v}; now: şimdi (24 sa sonrası tamamlanmış mı)
// R2544.117 (kullanıcı 03.11: "beyin öğrenmesi düzeltildi mi"): when the desk cut the trade, the ENTRY is judged on the plan's own result
// (planR: the same path with stop / target / 24 h, no desk) - a desk exit at -0.2R / +0.1R made 5 of 6 trades 'BASABAS' and the brain learned nothing
function autopsy(lesson, k5, btc5, { now = Date.now(), planR = null } = {}) {
  const base = { version:AUTOPSY_VERSION };
  const L = lesson?.side === 'LONG', e = finite(lesson?.entryPrice), sp = finite(lesson?.stopPct), t0 = finite(lesson?.openedAt), t1 = finite(lesson?.closedAt), realR = finite(lesson?.rMultiple), hasPlan = planR !== null && planR !== undefined && Number.isFinite(Number(planR)), R = hasPlan ? Number(planR) : realR;
  if (!(e > 0 && sp > 0 && t0 && t1 && R !== null)) return { ...base, ok:false, reason:'AUTOPSY_LESSON_INCOMPLETE' };
  const k = rows5(k5), risk = e * sp, fav = p => (L ? p - e : e - p) / risk, tR = finite(lesson.targetPct) > 0 ? lesson.targetPct / sp : null;
  const i0 = k.findIndex(x => x.t + M5 > t0), iX = k.findIndex(x => x.t + M5 > t1);
  if (i0 < 7 || iX < i0) return { ...base, ok:false, reason:'AUTOPSY_CANDLES_MISSING' };
  const pre = k.slice(Math.max(0, i0 - 36), i0), during = k.slice(i0, iX + 1), after = k.slice(iX + 1, iX + 1 + 288);
  const complete = now >= t1 + DAY && after.length >= 280;
  const m = {};
  m.minutes = Math.round((t1 - t0) / 60000);
  m.mfeR = Number(Math.max(finite(lesson.mfeR) ?? -Infinity, ...during.map(x => fav(L ? x.h : x.l))).toFixed(2));
  m.maeR = Number(Math.min(...during.map(x => fav(L ? x.l : x.h))).toFixed(2));
  const last6 = k.slice(i0 - 6, i0); m.preRunR = Number(((L ? e - Math.min(...last6.map(x => x.l)) : Math.max(...last6.map(x => x.h)) - e) / risk).toFixed(2));
  const vMed = median(pre.map(x => x.v)), vAfter = median(k.slice(i0, i0 + 6).map(x => x.v)); m.volRatio = vMed > 0 && vAfter !== null ? Number((vAfter / vMed).toFixed(2)) : null;
  const b = rows5(btc5), bi0 = b.findIndex(x => x.t + M5 > t0), biX = b.findIndex(x => x.t + M5 > t1);
  m.btcPct = bi0 >= 0 && biX >= bi0 ? Number(((b[biX].c / b[bi0].o - 1) * 100).toFixed(2)) : null;
  m.btc1hWith = bi0 >= 12 ? Number(((L ? 1 : -1) * (b[bi0 - 1].c / b[bi0 - 12].o - 1) * 100).toFixed(2)) : null; // girişte bilinen (entryContext ile aynı)
  // after the exit: which came first, +1R or 1R further against (losers); further move after a target (winners)
  let firstPlus = null, firstWorse = null, bestAfter = -Infinity;
  for (let j = 0; j < after.length; j++) { const hi = fav(L ? after[j].h : after[j].l), lo = fav(L ? after[j].l : after[j].h); bestAfter = Math.max(bestAfter, hi);
    if (firstPlus === null && hi >= 1) firstPlus = j; if (firstWorse === null && lo <= -2) firstWorse = j; }
  m.afterBestR = after.length ? Number(bestAfter.toFixed(2)) : null;
  m.afterBars = after.length;
  const nearestR = finite(lesson.features?.ind?.vdpm?.nearestR), tags = Array.isArray(lesson.tags) ? lesson.tags : [], xt = String(lesson.exitType || '');
  const btcAgainst = m.btcPct !== null && (L ? m.btcPct <= -0.8 : m.btcPct >= 0.8), btcWith = m.btcPct !== null && (L ? m.btcPct >= 0.8 : m.btcPct <= -0.8);
  const causes = [], add = (code, evidence) => causes.push({ code, tr:CAUSE_TR[code], evidence });
  // the same measured factors for EVERY trade, whatever the outcome: a factor is a lesson only if it separates losses from wins
  const factors = { gecGiris:m.preRunR >= 1.5, btc:btcAgainst ? 'TERS' : btcWith ? 'YONDE' : 'NOTR', hacim:m.volRatio === null ? null : m.volRatio < 0.8 ? 'YOK' : m.volRatio >= 1.5 ? 'GUCLU' : 'NORMAL', seviye2R:nearestR === null ? null : nearestR < 2 };
  let outcome, direction = null;
  if (R < -0.3) {
    outcome = 'KAYIP';
    if (/STOP/.test(xt) || R <= -0.8) {
      if (firstPlus !== null && (firstWorse === null || firstPlus < firstWorse)) { direction = 'DOGRU'; add('STOP_AVI', { minutesAfterStop:(firstPlus + 1) * 5 }); }
      else if (firstWorse !== null) { direction = 'YANLIS'; add('YANLIS_YON', { minutesAfterStop:(firstWorse + 1) * 5 }); }
      else if (complete) { direction = 'BELIRSIZ'; add('BELIRSIZ_YON', { afterBestR:m.afterBestR }); }
    }
    if (m.minutes <= 15 && m.mfeR < 0.5) add('HIZLI_TERS', { minutes:m.minutes, mfeR:m.mfeR });
    if (nearestR !== null && nearestR < 2 && m.mfeR >= 0.7 * nearestR) add('KARSI_SEVIYE', { levelR:nearestR, mfeR:m.mfeR });
    if (btcAgainst) add('PIYASA_TERS', { btcPct:m.btcPct });
    if (m.volRatio !== null && m.volRatio < 0.8) add('TAKIP_HACMI_YOK', { volRatio:m.volRatio });
    if (m.preRunR >= 1.5) add('GEC_GIRIS', { preRunR:m.preRunR });
    if (/TIME/.test(xt)) add('ZAMAN', {});
  } else if (R > 0.3) {
    outcome = 'KAZANC';
    if (m.maeR > -0.3) add('TEMIZ_DEVAM', { maeR:m.maeR }); else if (m.maeR <= -0.6) add('DIRENC_SONRASI', { maeR:m.maeR });
    if (btcWith) add('PIYASA_DESTEGI', { btcPct:m.btcPct });
    if (m.volRatio !== null && m.volRatio >= 1.5) add('HACIMLI_TAKIP', { volRatio:m.volRatio });
    if (tags.includes('PARTIAL_TAKEN') && /BE_STOP/.test(xt)) add('KAR_KORUMA', {});
    if (tags.includes('GAVE_BACK') || (m.mfeR >= 3 && R <= m.mfeR - 2)) add('KAR_GERI_VERDI', { mfeR:m.mfeR, R:Number(R.toFixed(2)) });
    if (/TAKE_PROFIT/.test(xt) && tR !== null && m.afterBestR !== null && m.afterBestR >= tR + 2) add('HEDEF_ERKEN', { targetR:Number(tR.toFixed(2)), afterBestR:m.afterBestR });
    if (m.preRunR >= 1.5) add('GEC_GIRIS', { preRunR:m.preRunR });
  } else {
    outcome = 'BASABAS';
    if (tags.includes('PARTIAL_TAKEN')) add('KAR_KORUMA', {});
    if (m.volRatio !== null && m.volRatio < 0.8) add('TAKIP_HACMI_YOK', { volRatio:m.volRatio });
    if (btcAgainst) add('PIYASA_TERS', { btcPct:m.btcPct });
    if (tags.includes('GAVE_BACK') || m.mfeR >= 2) add('KAR_GERI_VERDI', { mfeR:m.mfeR, R:Number(R.toFixed(2)) });
  }
  const head = outcome === 'KAYIP' ? (direction === 'DOGRU' ? 'Yön doğruydu ama zarar' : direction === 'YANLIS' ? 'Yön yanlıştı' : 'Kayıp') : outcome === 'KAZANC' ? 'Kazanç' : 'Başabaş';
  const text = `${head}: ` + (causes.length ? causes.map(c => c.tr + ev(c)).join('; ') : 'belirgin bir neden ölçülmedi') + (complete ? '' : ' (çıkış sonrası 24 sa henüz tamamlanmadı)');
  return { ...base, ok:true, complete, outcome, basis:hasPlan ? 'PLAN' : 'REAL', realR, judgedR:Number(R.toFixed(3)), direction, causes:causes.map(c => c.code), evidence:Object.fromEntries(causes.map(c => [c.code, c.evidence])), factors, metrics:m, text };
}
function ev(c) { const x = c.evidence || {};
  if (c.code === 'STOP_AVI' || c.code === 'YANLIS_YON') return ` (stoptan ${x.minutesAfterStop} dk sonra)`;
  if (c.code === 'HIZLI_TERS') return ` (${x.minutes} dk, en iyi ${tr2(x.mfeR)}R)`;
  if (c.code === 'KARSI_SEVIYE') return ` (seviye ${tr2(x.levelR)}R, en iyi ${tr2(x.mfeR)}R)`;
  if (c.code === 'PIYASA_TERS' || c.code === 'PIYASA_DESTEGI') return ` (BTC %${tr2(x.btcPct)})`;
  if (c.code === 'TAKIP_HACMI_YOK' || c.code === 'HACIMLI_TAKIP') return ` (${tr2(x.volRatio)}x)`;
  if (c.code === 'GEC_GIRIS') return ` (${tr2(x.preRunR)}R)`;
  if (c.code === 'KAR_GERI_VERDI') return ` (en iyi ${tr2(x.mfeR)}R, sonuç ${tr2(x.R)}R)`;
  if (c.code === 'HEDEF_ERKEN') return ` (hedef ${tr2(x.targetR)}R, sonra ${tr2(x.afterBestR)}R)`;
  if (c.code === 'TEMIZ_DEVAM' || c.code === 'DIRENC_SONRASI') return ` (en kötü ${tr2(x.maeR)}R)`;
  return ''; }
// Girişte BİLİNEN bağlam (sinyal anında hesaplanır, benzer durum aramasında kullanılır): son 30 dk'da fiyatın bu stopun R'si
// cinsinden yönde gidişi ve BTC'nin son 1 saatteki % değişimi (işlem yönüne göre işaretli: + = yönde).
function entryContext(k5, side, entry, stop, btc5) {
  const k = rows5(k5), b = rows5(btc5), L = side === 'LONG', e = finite(entry), st = finite(stop);
  if (k.length < 6 || !(e > 0 && st > 0)) return null;
  const risk = Math.abs(e - st), last6 = k.slice(-6);
  const preRunR = Number(((L ? e - Math.min(...last6.map(x => x.l)) : Math.max(...last6.map(x => x.h)) - e) / risk).toFixed(2));
  let btc1hWith = null; if (b.length >= 12) { const chg = (b.at(-1).c / b.at(-12).o - 1) * 100; btc1hWith = Number((L ? chg : -chg).toFixed(2)); }
  return { preRunR, btc1hWith, stopPct:Number((risk / e).toFixed(4)) };
}
// R2544.132 BEYİN v2 (kullanıcı 09.11: "beyin v2'ye başla; eldeki test verilerini de bilmesi lazım, test boşa gitmesin") yeniden oynatma motoru: kapanan bir işlemi kendi 5 dk mumlarında farklı yönetim kurallarıyla tekrar oynatır.
// Kötümser: aynı mumda stop ve hedef/kâr seviyesi birlikte değdiyse önce stop sayılır; başabaşa çekme bir SONRAKİ mumdan geçerlidir.
// Sonuç giriş stopunun R'si cinsindendir (ücretsiz); bütün kurallar aynı varsayımla oynandığı için birbirleriyle karşılaştırılabilir.
const RP_M5 = 5 * 60000, RP_H = 3600000;
const POLICIES = Object.freeze([
  { key:'PLAN', tr:'plan (dokunma)' },
  { key:'KK2', tr:'şimdiki kâr koruma: 2R’de yarısı + başabaş', partialAt:2, share:0.5, beAfterPartial:true },
  { key:'BE1', tr:'+1R’de stopu girişe çek', beAt:1 },
  { key:'KK1', tr:'1R’de yarısı + başabaş', partialAt:1, share:0.5, beAfterPartial:true },
  { key:'T15', tr:'hedef 1,5R', targetMax:1.5 },
  { key:'Z4', tr:'4 saatte kapat', timeH:4 },
  { key:'Z8', tr:'8 saatte kapat', timeH:8 }
]);
const rpNum = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
function rpBars(raw) { return (Array.isArray(raw) ? raw : []).map(r => Array.isArray(r) ? { t:rpNum(r[0]), o:rpNum(r[1]), h:rpNum(r[2]), l:rpNum(r[3]), c:rpNum(r[4]) } : r)
  .filter(b => b && [b.t, b.h, b.l, b.c].every(Number.isFinite)).sort((a, b) => a.t - b.t); }
function replayOne(trade, k5, p) {
  const L = trade.side === 'LONG', e = rpNum(trade.entryPrice), sp = rpNum(trade.stopPct), tp = rpNum(trade.targetPct), t0 = rpNum(trade.openedAt), maxH = rpNum(trade.maxHoldH) > 0 ? rpNum(trade.maxHoldH) : 24;
  if (!(e > 0 && sp > 0 && tp > 0 && t0 > 0)) return null;
  const risk = e * sp, fav = px => (L ? px - e : e - px) / risk, tR = Math.min(tp / sp, p.targetMax ?? Infinity);
  // R2544.134: the entry bar counts (09.11: without it a stop in the first minutes was not seen; CAP stopped in 3 min, the replay said +6,1R).
  // In that bar the adverse extreme counts in full, the favourable side only at its close (the bar's high may have come before the entry).
  const end = t0 + Math.min(maxH, p.timeH ?? Infinity) * RP_H, B = rpBars(k5).filter(b => b.t + RP_M5 > t0 && b.t < end);
  if (!B.length) return null;
  let stopR = -1, rest = 1, booked = 0, partDone = false, beNext = false, last = null;
  for (const b of B) {
    if (beNext) { stopR = Math.max(stopR, 0); beNext = false; }
    const hi = b.t < t0 ? fav(b.c) : fav(L ? b.h : b.l), lo = fav(L ? b.l : b.h); last = b;
    if (lo <= stopR) return { R:booked + rest * stopR, how:stopR >= 0 ? 'BASABAS' : 'STOP', bars:B.indexOf(b) + 1 };
    if (p.partialAt && !partDone && hi >= p.partialAt && p.partialAt < tR) { booked += p.share * p.partialAt; rest -= p.share; partDone = true; if (p.beAfterPartial) beNext = true; }
    if (hi >= tR) return { R:booked + rest * tR, how:'HEDEF', bars:B.indexOf(b) + 1 };
    if (p.beAt && hi >= p.beAt) beNext = true;
  }
  const covered = last.t + RP_M5 >= end - RP_M5;
  return { R:booked + rest * fav(last.c), how:p.timeH && covered ? 'SURE' : covered ? 'SURE_24' : 'VERI_BITTI', bars:B.length, partialData:!covered };
}
function replayAll(trade, k5) { const out = {}; for (const p of POLICIES) { const r = replayOne(trade, k5, p); if (r) out[p.key] = { R:Number(r.R.toFixed(3)), how:r.how }; } return out; }

// R2544.134 KURUL KARNESİ: for every desk decision of a closed trade, what an EXIT at that moment (the 5m close) gave against holding
// with today's rule (2R half + break-even) to the end, on the same candles. Only the EXIT-like votes are kept: v = exit - hold
// (positive = exiting was right). "Always hold" is the baseline, so a member adds value only through the exits it calls.
const RP_EXIT = /EXIT|PARTIAL|HALF/;
function replayVotes(trade, k5, decisions) {
  const L = trade.side === 'LONG', e = rpNum(trade.entryPrice), sp = rpNum(trade.stopPct), tp = rpNum(trade.targetPct), t0 = rpNum(trade.openedAt);
  if (!(e > 0 && sp > 0 && tp > 0 && t0 > 0)) return [];
  const D = (Array.isArray(decisions) ? decisions : []).filter(d => d && Number.isFinite(rpNum(d.at)) && Array.isArray(d.committee?.votes) && d.committee.votes.some(v => RP_EXIT.test(String(v?.a || '')))).sort((a, b) => a.at - b.at);
  if (!D.length) return [];
  const risk = e * sp, fav = px => (L ? px - e : e - px) / risk, tR = tp / sp, B = rpBars(k5).filter(b => b.t + RP_M5 > t0 && b.t < t0 + 24 * RP_H);
  if (!B.length) return [];
  let stopR = -1, rest = 1, booked = 0, part = false, beNext = false, final = null, di = 0; const at = [];
  for (const b of B) {
    if (beNext) { stopR = Math.max(stopR, 0); beNext = false; }
    const hi = b.t < t0 ? fav(b.c) : fav(L ? b.h : b.l), lo = fav(L ? b.l : b.h);
    if (lo <= stopR) { final = booked + rest * stopR; break; }
    if (!part && hi >= 2 && 2 < tR) { booked += 1; rest = 0.5; part = true; beNext = true; }
    if (hi >= tR) { final = booked + rest * tR; break; }
    while (di < D.length && D[di].at < b.t + RP_M5) { at.push({ d:D[di], exitR:booked + rest * fav(b.c) }); di++; }
  }
  if (final === null) { const lb = B[B.length - 1]; final = booked + rest * fav(lb.c); }
  const out = [];
  for (const x of at) for (const v of x.d.committee.votes) if (v && v.m && RP_EXIT.test(String(v.a || ''))) out.push({ m:String(v.m).slice(0, 120), v:Number((x.exitR - final).toFixed(3)) });
  return out;
}

module.exports = { AUTOPSY_VERSION, autopsy, entryContext, CAUSE_TR, REPLAY_POLICIES:POLICIES, replayOne, replayAll, replayVotes };
