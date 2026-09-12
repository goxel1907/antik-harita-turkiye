from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'
DAYCTX = JAVA / 'V9533DayMapContext.java'

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.33 missing required file: ' + str(p))

def method_bounds(src, signature):
    a = src.find(signature)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    quote = False
    char_quote = False
    esc = False
    line_comment = False
    block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                quote = False
        elif char_quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                char_quote = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                quote = True
            elif c == "'":
                char_quote = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)

# ---------------------------------------------------------------------------
# 1) Same-symbol lifecycle lock + post-result fresh-15m re-arm.
# ---------------------------------------------------------------------------
m = MON.read_text()

# Continue updating the currently active signal outcome first, then block any
# second/opposite signal for the same symbol until the prior lifecycle is done.
eval_sig = '    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)'
b = method_bounds(m, eval_sig)
if not b:
    raise SystemExit('v9.5.33 evaluate method missing')
a0, _, e0 = b
body = m[a0:e0]
anchor = '        v9518UpdateSignalResult(p.symbol, v953LivePrice);'
if 'v9533CycleReady(p.symbol)' not in body:
    if anchor not in body:
        raise SystemExit('v9.5.33 signal-result update anchor missing')
    body = body.replace(anchor, anchor + r'''
        // V9533_SYMBOL_LIFECYCLE_LOCK:
        // A signal is treated as an open virtual trade even when the user did
        // not place a Binance order. While it is unresolved, no LONG/SHORT
        // flip or second signal is allowed for this symbol.
        if (!v9533CycleReady(p.symbol)) return;''', 1)
    m = m[:a0] + body + m[e0:]

# Hard guard at the final notification/emission point as well.
b = method_bounds(m, '    private void sendUrgent(String symbol, String direction, String detail)')
if not b:
    raise SystemExit('v9.5.33 sendUrgent method missing')
a0, brace, e0 = b
body = m[a0:e0]
if 'V9533_FINAL_SYMBOL_GUARD' not in body:
    insert = r'''
        // V9533_FINAL_SYMBOL_GUARD
        if (prefs.getBoolean("v9518_signal_active_" + symbol, false)) return;
        if (!v9533CycleReady(symbol)) return;
'''
    body = body[:body.find('{')+1] + insert + body[body.find('{')+1:]
    m = m[:a0] + body + m[e0:]

# Dynamic 5m re-entry must obey the same symbol lifecycle.
b = method_bounds(m, '    private void v9525EvaluateDynamicReentry(TradePlan p,MarketSnapshot market,double live)')
if not b:
    raise SystemExit('v9.5.33 dynamic reentry method missing')
a0, _, e0 = b
body = m[a0:e0]
if 'V9533_DYNAMIC_REENTRY_SYMBOL_GUARD' not in body:
    insert = r'''
        // V9533_DYNAMIC_REENTRY_SYMBOL_GUARD
        if (p == null) return;
        if (prefs.getBoolean("v9518_signal_active_" + p.symbol, false)) return;
        if (!v9533CycleReady(p.symbol)) return;
'''
    body = body[:body.find('{')+1] + insert + body[body.find('{')+1:]
    m = m[:a0] + body + m[e0:]

# DAY_MODE=ADAPTIF means ANA_KARAR is the current snapshot bias, not a permanent
# all-day one-way lock. Existing plans without this marker keep old semantics.
b = method_bounds(m, '    private boolean v953DirectionAllowed(String symbol, boolean wantLong)')
if not b:
    raise SystemExit('v9.5.33 v953DirectionAllowed missing')
a0, _, e0 = b
body = m[a0:e0]
if 'v9533AdaptiveDayMode(symbol)' not in body:
    brace_i = body.find('{')
    body = body[:brace_i+1] + r'''
        if (v9533AdaptiveDayMode(symbol)) return true;
''' + body[brace_i+1:]
    m = m[:a0] + body + m[e0:]

# Add lifecycle/adaptive helpers before v953Decision so all call sites can use them.
if 'private boolean v9533CycleReady(' not in m:
    idx = m.find('    private String v953Decision(String symbol)')
    if idx < 0:
        raise SystemExit('v9.5.33 helper anchor missing')
    helper = r'''
    private boolean v9533AdaptiveDayMode(String symbol) {
        String raw = prefs.getString("v95_meta_" + symbol, "");
        if (raw == null) return false;
        String u = raw.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C');
        return u.contains("DAY_MODE:ADAPTIF") || u.contains("DAY_MODE=ADAPTIF");
    }

    private boolean v9533CycleReady(String symbol) {
        if (symbol == null || symbol.trim().isEmpty()) return false;

        // Virtual signal tracking is authoritative even when no real order was
        // placed. Therefore a current signal locks the whole SYMBOL, not a side.
        if (prefs.getBoolean("v9518_signal_active_" + symbol, false)) return false;

        long end = prefs.getLong("v9518_signal_end_" + symbol, 0L);
        long handled = prefs.getLong("v9533_cycle_handled_end_" + symbol, 0L);
        long rearmAfter = prefs.getLong("v9533_cycle_rearm_after_" + symbol, 0L);
        long now = System.currentTimeMillis();

        // When a signal finishes (TP3 / STOP / reconciled Binance close), force
        // one completely NEW 15m candle to form after the finish time. This
        // prevents an instant LONG->SHORT flip from the same old candle.
        if (end > 0L && end > handled) {
            final long tf = 15L * 60L * 1000L;
            long nextOpen = ((end + tf - 1L) / tf) * tf;
            long freshClose = nextOpen + tf + 2000L;
            prefs.edit()
                    .putLong("v9533_cycle_handled_end_" + symbol, end)
                    .putLong("v9533_cycle_rearm_after_" + symbol, freshClose)
                    .apply();
            return false;
        }

        if (rearmAfter > 0L && now < rearmAfter) return false;

        if (rearmAfter > 0L) {
            // New cycle: both old side-locks belong to the completed setup and
            // are cleared together. Different symbols remain independent.
            prefs.edit()
                    .remove("v953_trade_lock_" + symbol + "_LONG")
                    .remove("v953_trade_lock_" + symbol + "_SHORT")
                    .remove("v9533_cycle_rearm_after_" + symbol)
                    .apply();
        }
        return true;
    }

'''
    m = m[:idx] + helper + m[idx:]

if 'V9533_SYMBOL_LIFECYCLE_LOCK' not in m or 'V9533_FINAL_SYMBOL_GUARD' not in m:
    raise SystemExit('v9.5.33 lifecycle injection failed')
MON.write_text(m)

# ---------------------------------------------------------------------------
# 2) Daily adaptive multi-timeframe map (3m/5m/15m/30m/45m/1h/4h/1d).
#    30m/45m are derived only from completed 15m candles.
# ---------------------------------------------------------------------------
dayctx = r'''package com.futuresalarm.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * v9.5.33 DAILY ADAPTIVE MAP.
 *
 * 30M and 45M bars are deterministically synthesized from COMPLETED 15M bars.
 * They are bridge/context timeframes, not extra independent votes.
 *
 * The output is descriptive decision context for ChatGPT's one-day contingency
 * map. Runtime trade confirmation still requires completed 15m structure and
 * the app's execution/RR/flow guards.
 */
final class V9533DayMapContext {
    private V9533DayMapContext() {}

    private static final class B {
        long openTime, closeTime;
        double o, h, l, c;
        B(long ot, long ct, double o, double h, double l, double c) {
            this.openTime=ot; this.closeTime=ct; this.o=o; this.h=h; this.l=l; this.c=c;
        }
    }

    static String summary(Map<String, List<AnalysisPackActivity.Candle>> data) {
        StringBuilder s = new StringBuilder();
        s.append("GÜNLÜK ADAPTİF ÇOKLU-TF HARİTA v9.5.33 — yalnız TAMAMLANMIŞ mumlar.\n");
        s.append("ROL: 3M=timing; 5M=execution/re-entry; 15M=ana tetik; 30M/45M=intraday köprü; 1H/4H/1D=rejim/yön bağlamı. Aynı hareketi TF sayısıyla çoğaltma.\n");
        if (data == null) return s.append("VERİ YOK\n").toString();

        List<B> m15 = nativeBars(data.get("15m"));
        append(s, "3M", nativeBars(data.get("3m")), "MICRO");
        append(s, "5M", nativeBars(data.get("5m")), "MICRO");
        append(s, "15M", m15, "INTRADAY");
        append(s, "30M_SYN", synth(m15, 30L*60L*1000L, 2), "INTRADAY");
        append(s, "45M_SYN", synth(m15, 45L*60L*1000L, 3), "INTRADAY");
        append(s, "1H", nativeBars(data.get("1h")), "MID");
        append(s, "4H", nativeBars(data.get("4h")), "MAJOR");
        append(s, "1D", nativeBars(data.get("1d")), "MACRO");
        s.append("YORUM KURALI: Bu sekiz satır gün içi olası yön değişimlerini/continuation varyasyonlarını haritalamak içindir. 30M/45M sentetik satırlarını yeni bağımsız teyit gibi sayma; 15M kapanışı gerçek işlem tetik omurgası olarak kalır.\n");
        return s.toString();
    }

    private static List<B> nativeBars(List<AnalysisPackActivity.Candle> a) {
        List<B> out = new ArrayList<>();
        if (a == null) return out;
        for (AnalysisPackActivity.Candle x : a) {
            if (x == null) continue;
            out.add(new B(x.openTime, x.closeTime, x.open, x.high, x.low, x.close));
        }
        return out;
    }

    private static List<B> synth(List<B> src, long window, int need) {
        List<B> out = new ArrayList<>();
        if (src == null || src.isEmpty()) return out;
        long bucket = Long.MIN_VALUE;
        int count = 0;
        B acc = null;
        for (B x : src) {
            long b = (x.openTime / window) * window;
            if (b != bucket) {
                if (acc != null && count == need) out.add(acc);
                bucket = b;
                count = 0;
                acc = null;
            }
            if (acc == null) {
                acc = new B(x.openTime, x.closeTime, x.o, x.h, x.l, x.c);
            } else {
                acc.h = Math.max(acc.h, x.h);
                acc.l = Math.min(acc.l, x.l);
                acc.c = x.c;
                acc.closeTime = x.closeTime;
            }
            count++;
        }
        if (acc != null && count == need) out.add(acc);
        return out;
    }

    private static void append(StringBuilder s, String label, List<B> a, String family) {
        s.append(label).append(" [").append(family).append("]: ");
        if (a == null || a.size() < 8) {
            s.append("YETERSİZ VERİ • PUANSIZ\n");
            return;
        }
        int n = a.size();
        B last = a.get(n-1);
        double atr = atr(a, 14);
        double ph1 = Double.NaN, ph2 = Double.NaN, pl1 = Double.NaN, pl2 = Double.NaN;
        for (int i=n-3; i>=Math.max(2,n-30) && (!finite(ph2)||!finite(pl2)); i--) {
            B x=a.get(i);
            boolean hi=x.h>a.get(i-1).h&&x.h>=a.get(i-2).h&&x.h>=a.get(i+1).h&&x.h>=a.get(i+2).h;
            boolean lo=x.l<a.get(i-1).l&&x.l<=a.get(i-2).l&&x.l<=a.get(i+1).l&&x.l<=a.get(i+2).l;
            if (hi) { if(!finite(ph1)) ph1=x.h; else if(!finite(ph2)) ph2=x.h; }
            if (lo) { if(!finite(pl1)) pl1=x.l; else if(!finite(pl2)) pl2=x.l; }
        }
        String structure="GEÇİŞ/KARIŞIK";
        if(finite(ph1)&&finite(ph2)&&finite(pl1)&&finite(pl2)) {
            if(ph1>ph2 && pl1>pl2) structure="HH-HL";
            else if(ph1<ph2 && pl1<pl2) structure="LH-LL";
        }

        int look=Math.min(10,n-1);
        double old=a.get(n-1-look).c;
        double move=last.c-old;
        double th=finite(atr)&&atr>0?atr*0.60:Math.max(last.c*0.0025,1e-12);
        String trend=move>th?"UP":(move<-th?"DOWN":"FLAT");

        String bos="TEYİT YOK";
        if(finite(ph1)&&last.c>ph1) bos="YUKARI > "+px(ph1);
        else if(finite(pl1)&&last.c<pl1) bos="AŞAĞI < "+px(pl1);

        double range=Math.max(1e-12,last.h-last.l);
        double upper=Math.max(0,last.h-Math.max(last.o,last.c));
        double lower=Math.max(0,Math.min(last.o,last.c)-last.l);
        String wick="NÖTR";
        if(upper/range>=0.48 && lower/range>=0.30) wick="İKİ_TARAFLI";
        else if(upper/range>=0.48) wick="ÜST_REJECTION";
        else if(lower/range>=0.48) wick="ALT_REJECTION";
        double pos=(last.c-last.l)/range;
        String accept=pos>=.72?"ÜST_KABUL":(pos<=.28?"ALT_KABUL":"ORTA/NÖTR");

        s.append("trend=").append(trend)
                .append(" yapı=").append(structure)
                .append(" BOS=").append(bos)
                .append(" kapanış=").append(accept)
                .append(" fitil=").append(wick)
                .append(" sonC=").append(px(last.c));
        if(finite(ph1)) s.append(" swingH=").append(px(ph1));
        if(finite(pl1)) s.append(" swingL=").append(px(pl1));
        if(finite(atr)&&atr>0) s.append(" ATR=").append(px(atr));
        s.append("\n");
    }

    private static double atr(List<B> a, int p) {
        if(a==null||a.size()<2)return Double.NaN;
        int from=Math.max(1,a.size()-p); double sum=0; int c=0;
        for(int i=from;i<a.size();i++){
            B q=a.get(i); double prev=a.get(i-1).c;
            double tr=Math.max(q.h-q.l,Math.max(Math.abs(q.h-prev),Math.abs(q.l-prev)));
            if(finite(tr)&&tr>=0){sum+=tr;c++;}
        }
        return c>0?sum/c:Double.NaN;
    }
    private static boolean finite(double x){return !Double.isNaN(x)&&!Double.isInfinite(x);}
    private static String px(double x){
        if(!finite(x))return "-";
        try{return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString();}
        catch(Throwable ignored){return String.format(Locale.US,"%.8f",x);}
    }
}
'''
DAYCTX.write_text(dayctx)

# Inject the daily map and the explicit adaptive-day contract into buildPrompt.
a = ANALYSIS.read_text()
b = method_bounds(a, '    private String buildPrompt(')
if not b:
    raise SystemExit('v9.5.33 buildPrompt missing')
a0, _, e0 = b
body = a[a0:e0]

if 'V9.5.33 GUNLUK ADAPTIF HARITA PROTOKOLU' not in body:
    sb_anchor = '        StringBuilder sb = new StringBuilder();\n'
    if sb_anchor not in body:
        raise SystemExit('v9.5.33 StringBuilder anchor missing')
    protocol = r'''        sb.append("V9.5.33 GUNLUK ADAPTIF HARITA PROTOKOLU — BU ANALIZ TEK ANLIK YON TAHMINI DEGIL, GUN ICIN KOSULLU BIR KARAR HARITASIDIR:\n");
        sb.append("1) TUM VARYASYONLAR: 3m, 5m, 15m, 30m, 45m, 1h, 4h ve 1D kapanmis mum yapilarini birlikte incele. 30m/45m uygulamanin kapanmis 15m mumlardan sentetik urettigi intraday kopru zaman dilimleridir. Her TF icin HH-HL/LH-LL/gecis, BOS/CHoCH, swing, BSL/SSL, FVG/OB/breaker, kabul/rejection-fitil, premium/discount ve one cikan invalidation/likidite hedeflerini degerlendir. Ayni fiyat hareketini farkli TF etiketleriyle tekrar puanlama.\n");
        sb.append("2) ROLLER: 3m yalniz timing; 5m execution/re-entry; 15m ana sinyal tetigi; 30m/45m intraday kopru/context; 1h/4h/1D rejim ve buyuk yapi. Gercek alarm yine tamamlanmis 15m ana kosul + guncel giris/retest + R/R + gerekli execution kalitesi ile olusur.\n");
        sb.append("3) DAY_MODE=ADAPTIF: ANA_KARAR yalniz paket anindaki MEVCUT BIAS'tir; butun gun icin ters yonu yasaklayan kalici kilit DEGILDIR. LP/LB/SR/SB alanlarini gun icinde gerceklesebilecek bagimsiz kosullu dallar olarak kur. Mevcut bias LONG olsa bile, daha sonra onceki sinyal TAMAMEN SONUCLANIR ve YENI tamamlanmis 15m yapi gercekten SHORT dalini teyit ederse uygulama yeni cycle'da SHORT'a gecebilir; ayni anda iki yon ASLA acik sayilmaz.\n");
        sb.append("4) POZISYON/SINYAL YASAM DONGUSU: Bir sembolde LONG veya SHORT sinyali olustugu anda, kullanici Binance emrine girmese bile uygulama o sinyali sanal pozisyon gibi sonucuna kadar takip eder. TP3/STOP veya Binance manuel/harici kapanis ile sonuc kesinlesmeden ayni sembolde YENI veya TERS sinyal URETME. Sonuc arşivlendikten sonra en az bir tamamen yeni 15m mum olussun; sonra eski cycle kilitlerini temizleyip mevcut 3m/5m/15m/30m/45m/1h/4h/1D durumunu yeniden degerlendir.\n");
        sb.append("5) GUNLUK HARITA AMACI: Plan, kullanicinin her sinyalden sonra tekrar ChatGPT analizi istemesine mecbur birakmamalidir. Gun icinde trend devam, geri cekilme, yukari kirilim, direnc reddi ve asagi kirilim varyasyonlarini onceden haritala. Ancak piyasa planin genis yapisal sinirlarinin disina cikarsa, ana rejim tamamen degisirse veya seviyeler tuketilip anlamsizlasirsa YENI ANALIZ GEREKIR; eski seviyeyi zorla kullanma.\n");
        sb.append("6) META'ya DAY_MODE:ADAPTIF;TF30M:<ozet>;TF45M:<ozet>;REARM:FRESH_15M ekle. 14 alanli plan formatini bozma; bu ek anahtarlar META icinde ; ile ayrilsin.\n\n");
'''
    body = body.replace(sb_anchor, sb_anchor + protocol, 1)

if 'V9533DayMapContext.summary(data)' not in body:
    ret = '        return sb.toString();\n'
    if ret not in body:
        raise SystemExit('v9.5.33 buildPrompt return anchor missing')
    inject = r'''        sb.append("\n--- V9.5.33 GUNLUK ADAPTIF 8-TF SAYISAL HARITA ---\n");
        sb.append(V9533DayMapContext.summary(data)).append("\n");
'''
    body = body.replace(ret, inject + ret, 1)

a = a[:a0] + body + a[e0:]
ANALYSIS.write_text(a)

# Main UI should clearly advertise eight decision timeframes, including the two
# synthetic intraday bridge frames.
main = MAIN.read_text()
main = re.sub(
    r'6 zaman dilimi\s*•\s*15m\s*/\s*5m\s*/\s*3m\s*/\s*1h\s*/\s*4h\s*/\s*1D',
    '8 zaman dilimi • 3m / 5m / 15m / 30m / 45m / 1h / 4h / 1D',
    main
)
main = main.replace('v9.5.32', 'v9.5.33')
if 'V9533_DAILY_ADAPTIVE_MAP' not in main:
    pos = main.find('\n', main.find('public class MainActivity'))
    if pos > 0:
        main = main[:pos+1] + '    // V9533_DAILY_ADAPTIVE_MAP: per-symbol lifecycle + 8-TF adaptive day map.\n' + main[pos+1:]
MAIN.write_text(main)

# Version bump.
build = BUILD.read_text()
build = re.sub(r'versionCode\s+\d+', 'versionCode 26091204', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.33'", build, count=1)
BUILD.write_text(build)

# Sanity.
mon = MON.read_text()
ana = ANALYSIS.read_text()
main = MAIN.read_text()
build = BUILD.read_text()
checks = {
    'symbol active guard': 'v9518_signal_active_" + p.symbol' in mon,
    'final emission guard': 'V9533_FINAL_SYMBOL_GUARD' in mon,
    'dynamic reentry guard': 'V9533_DYNAMIC_REENTRY_SYMBOL_GUARD' in mon,
    'post-result fresh 15m rearm': 'v9533_cycle_rearm_after_' in mon and 'nextOpen + tf + 2000L' in mon,
    'both old side locks cleared together': '.remove("v953_trade_lock_" + symbol + "_LONG")' in mon and '.remove("v953_trade_lock_" + symbol + "_SHORT")' in mon,
    'adaptive direction mode': 'v9533AdaptiveDayMode(symbol)' in mon and 'DAY_MODE:ADAPTIF' in mon,
    '8tf context java': DAYCTX.exists() and '30M_SYN' in DAYCTX.read_text() and '45M_SYN' in DAYCTX.read_text(),
    'prompt day map protocol': 'V9.5.33 GUNLUK ADAPTIF HARITA PROTOKOLU' in ana,
    'prompt context injection': 'V9533DayMapContext.summary(data)' in ana,
    'ui 8 timeframe label': '8 zaman dilimi • 3m / 5m / 15m / 30m / 45m / 1h / 4h / 1D' in main,
    'version code': 'versionCode 26091204' in build,
    'version name': "versionName '9.5.33'" in build,
}
for k,v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.33 sanity failed: '+', '.join(bad))
print('v9.5.33 OK: same-symbol lifecycle lock, fresh-15m rearm, adaptive bidirectional day map, and 8-TF daily context.')
