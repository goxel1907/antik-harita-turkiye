from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'
CTX = JAVA / 'V9532CandleContext.java'

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.32 missing required file: ' + str(p))


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

ctx = r'''package com.futuresalarm.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * v9.5.32 deterministic candle/wick context.
 *
 * CLOSED candles only. This class recognizes candle geometry and a compact set
 * of common candlestick formations, but intentionally does NOT generate an
 * order or add a new hard signal gate. Pattern names are context, not votes.
 *
 * Core semantics:
 * - body = acceptance/close information (open/close)
 * - wick = excursion/sweep/rejection information (high/low)
 * - LONG structural invalidation generally belongs beyond a meaningful recent
 *   swing/SSL or rejection-wick low; SHORT is the mirror above swing/BSL high.
 * - an ATR buffer is shown as an ADAY only. The trading plan still decides the
 *   final stop and must reject the trade if structural stop ruins R/R.
 */
final class V9532CandleContext {
    private static final String[] KEYS = {"3m", "5m", "15m", "1h", "4h", "1d"};
    private static final String[] LABELS = {"3M", "5M", "15M", "1H", "4H", "1D"};

    private V9532CandleContext() {}

    private static final class F {
        boolean ok;
        String trend = "N/A";
        String patterns = "YOK";
        String wick = "NÖTR";
        String closeState = "ORTA";
        double bodyPct, upperPct, lowerPct, rangeAtr;
        double longAnchor = Double.NaN, shortAnchor = Double.NaN;
        double longStop = Double.NaN, shortStop = Double.NaN, buffer = Double.NaN;
    }

    static String summary(Map<String, List<AnalysisPackActivity.Candle>> data) {
        StringBuilder out = new StringBuilder();
        out.append("MUM/FİTİL BAĞLAMI v9.5.32 — yalnız TAMAMLANMIŞ mumlar; yardımcı context, hard gate değil.\n");
        out.append("Gövde=open/close kabulü; fitil=high/low süpürme/reddetme izi. Formasyon adı tek başına yön teyidi değildir.\n");
        for (int i = 0; i < KEYS.length; i++) {
            List<AnalysisPackActivity.Candle> bars = data == null ? null : data.get(KEYS[i]);
            F f = analyze(bars);
            out.append(LABELS[i]).append(": ");
            if (!f.ok) {
                out.append("YETERSİZ VERİ • PUANSIZ\n");
                continue;
            }
            out.append("trend=").append(f.trend)
                    .append(" | gövde=").append(fmt1(f.bodyPct)).append("%")
                    .append(" üstFitil=").append(fmt1(f.upperPct)).append("%")
                    .append(" altFitil=").append(fmt1(f.lowerPct)).append("%")
                    .append(" range=").append(fmt2(f.rangeAtr)).append("ATR")
                    .append(" | kapanış=").append(f.closeState)
                    .append(" | fitil=").append(f.wick)
                    .append(" | formasyon=").append(f.patterns).append("\n");
            out.append("  STOP/INVALIDATION ADAYI: LONG ")
                    .append(px(f.longStop)).append(" (yapısal low ").append(px(f.longAnchor)).append(")")
                    .append(" | SHORT ").append(px(f.shortStop)).append(" (yapısal high ").append(px(f.shortAnchor)).append(")")
                    .append(" | tampon≈").append(px(f.buffer)).append("; kör emir seviyesi değil.\n");
        }
        out.append("ÖNCELİK: 15M kapanmış mum çekirdek teyit; 5M yalnız geçerli yapısal retest/re-entry; 3M yalnız timing. 1H/4H/1D bağlamdır.\n");
        out.append("STOP kuralı: LONG'da anlamlı SSL/swing/sweep fitil ucunun ALTINA, SHORT'ta BSL/swing/sweep fitil ucunun ÜSTÜNE yapısal tamponla; rastgele tek fitilin veya LIQ_DENS tahmininin arkasına körlemesine değil.");
        return out.toString();
    }

    private static F analyze(List<AnalysisPackActivity.Candle> a) {
        F f = new F();
        if (a == null || a.size() < 8) return f;
        int n = a.size();
        AnalysisPackActivity.Candle c = a.get(n - 1);
        double range = c.high - c.low;
        if (!finite(range) || range <= 0 || c.close <= 0) return f;
        double body = Math.abs(c.close - c.open);
        double upper = Math.max(0, c.high - Math.max(c.open, c.close));
        double lower = Math.max(0, Math.min(c.open, c.close) - c.low);
        f.bodyPct = 100.0 * body / range;
        f.upperPct = 100.0 * upper / range;
        f.lowerPct = 100.0 * lower / range;
        double atr = atr(a, 14);
        f.rangeAtr = finite(atr) && atr > 0 ? range / atr : 0;
        double pos = (c.close - c.low) / range;
        if (pos >= 0.72) f.closeState = "ÜST_KABUL";
        else if (pos <= 0.28) f.closeState = "ALT_KABUL";
        else f.closeState = "ORTA/NÖTR";
        f.trend = trend(a);

        boolean doji = f.bodyPct <= 10.0;
        boolean longLeggedDoji = doji && f.upperPct >= 28 && f.lowerPct >= 28;
        boolean dragonfly = doji && f.lowerPct >= 58 && f.upperPct <= 14;
        boolean gravestone = doji && f.upperPct >= 58 && f.lowerPct <= 14;
        boolean smallBody = f.bodyPct <= 32.0;
        boolean lowerDominant = lower >= Math.max(body * 2.0, range * 0.45) && upper <= Math.max(body * 1.15, range * 0.18);
        boolean upperDominant = upper >= Math.max(body * 2.0, range * 0.45) && lower <= Math.max(body * 1.15, range * 0.18);
        boolean marubozu = f.bodyPct >= 82.0 && f.upperPct <= 10.0 && f.lowerPct <= 10.0;
        boolean spinning = smallBody && f.upperPct >= 18 && f.lowerPct >= 18;

        if (f.lowerPct >= 48 && f.upperPct >= 30) f.wick = "İKİ_TARAFLI_SÜPÜRME/KARARSIZ";
        else if (f.lowerPct >= 48) f.wick = "ALT_FİTİL_REJECTION/SSL_SWEEP_ADAY";
        else if (f.upperPct >= 48) f.wick = "ÜST_FİTİL_REJECTION/BSL_SWEEP_ADAY";
        else f.wick = "NÖTR";

        ArrayList<String> p = new ArrayList<>();
        if (dragonfly) p.add("YUSUFCUK_DOJI");
        else if (gravestone) p.add("MEZARTAŞI_DOJI");
        else if (longLeggedDoji) p.add("UZUN_BACAKLI_DOJI");
        else if (doji) p.add("DOJI");
        if (spinning && !doji) p.add("TOPAÇ");
        if (marubozu) p.add(c.close >= c.open ? "BOĞA_MARUBOZU" : "AYI_MARUBOZU");
        if (lowerDominant) {
            if ("DOWN".equals(f.trend)) p.add("ÇEKİÇ");
            else if ("UP".equals(f.trend)) p.add("ASILI_ADAM");
            else p.add("UZUN_ALT_GÖLGE");
        }
        if (upperDominant) {
            if ("DOWN".equals(f.trend)) p.add("TERS_ÇEKİÇ");
            else if ("UP".equals(f.trend)) p.add("KAYAN_YILDIZ");
            else p.add("UZUN_ÜST_GÖLGE");
        }

        if (n >= 2) {
            AnalysisPackActivity.Candle p1 = a.get(n - 2);
            if (bullEngulf(p1, c)) p.add("YUTAN_BOĞA");
            if (bearEngulf(p1, c)) p.add("YUTAN_AYI");
            if (piercing(p1, c)) p.add("PIERCING");
            if (darkCloud(p1, c)) p.add("KARA_BULUT");
            double tol = Math.max((finite(atr) ? atr : range) * 0.10, c.close * 0.0005);
            if (Math.abs(p1.high - c.high) <= tol && p1.close > p1.open && c.close < c.open) p.add("CIMBIZ_TAVANI");
            if (Math.abs(p1.low - c.low) <= tol && p1.close < p1.open && c.close > c.open) p.add("CIMBIZ_TABANI");
        }
        if (n >= 3) {
            AnalysisPackActivity.Candle a0 = a.get(n - 3), a1 = a.get(n - 2);
            if (morningStar(a0, a1, c)) p.add("SABAH_YILDIZI");
            if (eveningStar(a0, a1, c)) p.add("AKŞAM_YILDIZI");
            if (threeSoldiers(a0, a1, c)) p.add("ÜÇ_YEŞİL_ASKER");
            if (threeCrows(a0, a1, c)) p.add("ÜÇ_KARA_KARGA");
        }
        if (n >= 5) {
            if (risingThreeMethods(a, n - 5)) p.add("BOĞA_ÜÇ_METOT");
            if (fallingThreeMethods(a, n - 5)) p.add("AYI_ÜÇ_METOT");
        }
        f.patterns = p.isEmpty() ? "YOK" : joinUnique(p);

        double swingLow = lastPivotLow(a);
        double swingHigh = lastPivotHigh(a);
        if (!finite(swingLow)) swingLow = rollingLow(a, 6);
        if (!finite(swingHigh)) swingHigh = rollingHigh(a, 6);
        if (f.lowerPct >= 45 && finite(c.low)) swingLow = Math.min(swingLow, c.low);
        if (f.upperPct >= 45 && finite(c.high)) swingHigh = Math.max(swingHigh, c.high);
        double buffer = Math.max(c.close * 0.0004, finite(atr) && atr > 0 ? atr * 0.08 : range * 0.08);
        f.longAnchor = swingLow;
        f.shortAnchor = swingHigh;
        f.buffer = buffer;
        f.longStop = finite(swingLow) ? swingLow - buffer : Double.NaN;
        f.shortStop = finite(swingHigh) ? swingHigh + buffer : Double.NaN;
        f.ok = true;
        return f;
    }

    private static boolean bullEngulf(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b) {
        return a.close < a.open && b.close > b.open && b.open <= a.close && b.close >= a.open;
    }
    private static boolean bearEngulf(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b) {
        return a.close > a.open && b.close < b.open && b.open >= a.close && b.close <= a.open;
    }
    private static boolean piercing(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b) {
        if (!(a.close < a.open && b.close > b.open)) return false;
        double mid = (a.open + a.close) * 0.5;
        return b.close > mid && b.close < a.open && b.open <= a.close * 1.002;
    }
    private static boolean darkCloud(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b) {
        if (!(a.close > a.open && b.close < b.open)) return false;
        double mid = (a.open + a.close) * 0.5;
        return b.close < mid && b.close > a.open && b.open >= a.close * 0.998;
    }
    private static boolean morningStar(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b, AnalysisPackActivity.Candle c) {
        double ar = a.high - a.low, br = b.high - b.low;
        if (ar <= 0 || br <= 0) return false;
        return a.close < a.open && Math.abs(b.close - b.open) / br <= 0.35 && c.close > c.open && c.close >= (a.open + a.close) * 0.5;
    }
    private static boolean eveningStar(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b, AnalysisPackActivity.Candle c) {
        double ar = a.high - a.low, br = b.high - b.low;
        if (ar <= 0 || br <= 0) return false;
        return a.close > a.open && Math.abs(b.close - b.open) / br <= 0.35 && c.close < c.open && c.close <= (a.open + a.close) * 0.5;
    }
    private static boolean threeSoldiers(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b, AnalysisPackActivity.Candle c) {
        return bull(a) && bull(b) && bull(c) && b.close > a.close && c.close > b.close && bodyRatio(a) >= .45 && bodyRatio(b) >= .45 && bodyRatio(c) >= .45;
    }
    private static boolean threeCrows(AnalysisPackActivity.Candle a, AnalysisPackActivity.Candle b, AnalysisPackActivity.Candle c) {
        return bear(a) && bear(b) && bear(c) && b.close < a.close && c.close < b.close && bodyRatio(a) >= .45 && bodyRatio(b) >= .45 && bodyRatio(c) >= .45;
    }
    private static boolean risingThreeMethods(List<AnalysisPackActivity.Candle> a, int i) {
        if (i < 0 || i + 4 >= a.size()) return false;
        AnalysisPackActivity.Candle c0=a.get(i),c1=a.get(i+1),c2=a.get(i+2),c3=a.get(i+3),c4=a.get(i+4);
        if (!bull(c0) || !bull(c4) || bodyRatio(c0) < .55 || bodyRatio(c4) < .55) return false;
        if (!(c1.close < c1.open && c2.close < c2.open && c3.close < c3.open)) return false;
        double hi=Math.max(c0.open,c0.close), lo=Math.min(c0.open,c0.close);
        return c1.high <= c0.high && c2.high <= c0.high && c3.high <= c0.high &&
                c1.low >= c0.low && c2.low >= c0.low && c3.low >= c0.low && c4.close > c0.high && hi > lo;
    }
    private static boolean fallingThreeMethods(List<AnalysisPackActivity.Candle> a, int i) {
        if (i < 0 || i + 4 >= a.size()) return false;
        AnalysisPackActivity.Candle c0=a.get(i),c1=a.get(i+1),c2=a.get(i+2),c3=a.get(i+3),c4=a.get(i+4);
        if (!bear(c0) || !bear(c4) || bodyRatio(c0) < .55 || bodyRatio(c4) < .55) return false;
        if (!(c1.close > c1.open && c2.close > c2.open && c3.close > c3.open)) return false;
        double hi=Math.max(c0.open,c0.close), lo=Math.min(c0.open,c0.close);
        return c1.high <= c0.high && c2.high <= c0.high && c3.high <= c0.high &&
                c1.low >= c0.low && c2.low >= c0.low && c3.low >= c0.low && c4.close < c0.low && hi > lo;
    }

    private static boolean bull(AnalysisPackActivity.Candle c) { return c != null && c.close > c.open; }
    private static boolean bear(AnalysisPackActivity.Candle c) { return c != null && c.close < c.open; }
    private static double bodyRatio(AnalysisPackActivity.Candle c) {
        if (c == null) return 0;
        double r = c.high - c.low;
        return r > 0 ? Math.abs(c.close - c.open) / r : 0;
    }

    private static String trend(List<AnalysisPackActivity.Candle> a) {
        int n=a.size(), look=Math.min(8,n-1);
        if (look < 3) return "FLAT";
        double start=0,end=0;
        int k=Math.min(3,look/2+1);
        for(int i=0;i<k;i++) {
            start += a.get(n-1-look+i).close;
            end += a.get(n-1-i).close;
        }
        start/=k; end/=k;
        double atr=atr(a,14);
        double d=end-start;
        double th=finite(atr)&&atr>0?atr*0.55:Math.max(1e-12,end*0.0025);
        if(d>th)return "UP";
        if(d<-th)return "DOWN";
        return "FLAT";
    }

    private static double lastPivotLow(List<AnalysisPackActivity.Candle> a) {
        int n=a.size();
        for(int i=n-3;i>=Math.max(2,n-24);i--) {
            double x=a.get(i).low;
            if(x<a.get(i-1).low && x<a.get(i-2).low && x<=a.get(i+1).low && x<=a.get(i+2).low) return x;
        }
        return Double.NaN;
    }
    private static double lastPivotHigh(List<AnalysisPackActivity.Candle> a) {
        int n=a.size();
        for(int i=n-3;i>=Math.max(2,n-24);i--) {
            double x=a.get(i).high;
            if(x>a.get(i-1).high && x>a.get(i-2).high && x>=a.get(i+1).high && x>=a.get(i+2).high) return x;
        }
        return Double.NaN;
    }
    private static double rollingLow(List<AnalysisPackActivity.Candle> a,int n) {
        double x=Double.POSITIVE_INFINITY;
        for(int i=Math.max(0,a.size()-n);i<a.size();i++) x=Math.min(x,a.get(i).low);
        return finite(x)?x:Double.NaN;
    }
    private static double rollingHigh(List<AnalysisPackActivity.Candle> a,int n) {
        double x=Double.NEGATIVE_INFINITY;
        for(int i=Math.max(0,a.size()-n);i<a.size();i++) x=Math.max(x,a.get(i).high);
        return finite(x)?x:Double.NaN;
    }
    private static double atr(List<AnalysisPackActivity.Candle> a,int n) {
        if(a==null||a.size()<2)return Double.NaN;
        int from=Math.max(1,a.size()-n);
        double s=0; int c=0;
        for(int i=from;i<a.size();i++) {
            AnalysisPackActivity.Candle q=a.get(i);
            double prev=a.get(i-1).close;
            double tr=Math.max(q.high-q.low,Math.max(Math.abs(q.high-prev),Math.abs(q.low-prev)));
            if(finite(tr)&&tr>=0){s+=tr;c++;}
        }
        return c>0?s/c:Double.NaN;
    }
    private static boolean finite(double x){return !Double.isNaN(x)&&!Double.isInfinite(x);}
    private static String fmt1(double x){return String.format(Locale.US,"%.1f",x);}
    private static String fmt2(double x){return String.format(Locale.US,"%.2f",x);}
    private static String px(double x){
        if(!finite(x)||x<=0)return "-";
        try{return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString();}
        catch(Throwable ignored){return String.format(Locale.US,"%.8f",x);}
    }
    private static String joinUnique(List<String> a){
        java.util.LinkedHashSet<String> s=new java.util.LinkedHashSet<>(a);
        StringBuilder b=new StringBuilder();
        for(String x:s){if(b.length()>0)b.append("+");b.append(x);}
        return b.length()==0?"YOK":b.toString();
    }
}
'''
CTX.write_text(ctx)

# Version bump.
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 26091203', b, count=1)
b = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.32'", b, count=1)
BUILD.write_text(b)

# Visible version wording.
m = MAIN.read_text()
m = re.sub(r'v9\.5\.3[01]', 'v9.5.32', m)
m = m.replace('v9.5.29', 'v9.5.32')
MAIN.write_text(m)

# Prompt optimization: deterministic candle context + explicit decision protocol.
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.32', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.32', a)

bounds = method_bounds(a, '    private String buildPrompt(')
if not bounds:
    raise SystemExit('v9.5.32 buildPrompt bounds missing')
start, brace, end = bounds
method = a[start:end]

if 'V9532CandleContext.summary(data)' not in method:
    ret = '        return sb.toString();\n'
    if ret not in method:
        raise SystemExit('v9.5.32 buildPrompt return missing')
    inject = r'''        sb.append("\n--- V9.5.32 MUM / FITIL SAYISAL BAGLAMI ---\n");
        sb.append(V9532CandleContext.summary(data)).append("\n");
'''
    method = method.replace(ret, inject + ret, 1)

if 'V9.5.32 NET KARAR PROTOKOLU' not in method:
    anchor = '        StringBuilder sb = new StringBuilder();\n'
    if anchor not in method:
        raise SystemExit('v9.5.32 StringBuilder anchor missing')
    protocol = r'''        sb.append("V9.5.32 NET KARAR PROTOKOLU — ASAGIDAKI ONCELIK VE CIFT-SAYMAMA KURALLARINI UYGULA:\n");
        sb.append("1) CEKIRDEK KARAR: plan senaryosu + TAMAMLANMIS 15m mum teyidi + yapisal invalidation + yeterli R/R. Bunlar ana omurgadir. Yardimci metrikler yeni zorunlu kapilar yaratmasin.\n");
        sb.append("2) FITIL/GOVDE SEMANTIGI: open-close GOVDE kabul/reddetme bilgisidir; high-low FITIL fiyat gezintisi/sweep/rejection bilgisidir. Tek uzun fitil tek basina sinyal DEGILDIR. Fitil anlamli swing/BSL/SSL/FVG/OB/retest konumunda ve kapanmis mum kabul/rejection ile birlikteyse guclenir.\n");
        sb.append("3) MUM FORMASYONLARI: Doji, uzun bacakli/yusufcuk/mezartasi doji, cekic, ters cekic, asili adam, kayan yildiz, topac, marubozu, yutan boga/ayi, piercing, kara bulut, sabah/aksam yildizi, uc yesil asker/uc kara karga, cimbiz ve uc-metot formasyonlarini YALNIZ BAGLAM olarak kullan. Ayni 1-3 mumdan cikan birden cok isim tek CANDLE ailesidir; ayri ayri puanlama. Doji/topac yon teyidi degil kararsizliktir.\n");
        sb.append("4) ZAMAN DILIMI ROLU: 15m tamamlanmis mum ana tetik. 5m sadece ana 15m yon korunurken gecerli yapisal re-entry/retest teyidi. 3m sadece timing. 1H/4H/1D mum formasyonu ve fitilleri HTF context; tek basina alarm acamaz/veto edemez.\n");
        sb.append("5) STOP / INVALIDATION: LONG stopu rastgele mum govdesinin altina degil, setup'i gercekten gecersiz kilan anlamli SSL/swing-low veya liquidity-sweep rejection FITIL UCUNUN biraz ALTINA koy; SHORT icin ayna mantigi BSL/swing-high veya rejection FITIL UCUNUN biraz USTU. ATR/tick tamponu kullan. LIQ_DENS tahmini clusterini stop seviyesi diye KORLEME kullanma. Yapisal stop R/R'yi bozuyorsa stopu fitilin icine daraltma; ISLEM YOK/BEKLE de.\n");
        sb.append("6) LIKIDITE AYRIMI: BSL/SSL ve LIQ_DENS gelecekte hedeflenebilecek/tahmini havuz; OBS_LIQ gerceklesmis Binance forceOrder snapshotidir. Mum fitil sweep'i bu haritalarla kesisse destekleyici olabilir ama hicbiri market-maker niyeti veya kesin liquidation price kaniti degildir.\n");
        sb.append("7) AILELER: STRUCTURE/LIQUIDITY, CANDLE/ACCEPTANCE, LEVERAGE/FLOW (OI+CVD+OBS_LIQ+LIQ_DENS), EXECUTION/MICRO (orderbook), REGIME. Her aileden en fazla bir guclu katkı say; ayni olayi turevleriyle tekrar puanlama. Eksik/bayat veri PUANSIZ.\n");
        sb.append("8) SINYALI BOGMA: Cekirdek senaryo tum zorunlu sartlari sagliyorsa yardimci context sadece guveni bir kademe ayarlasin veya TP/entry yolunu iyilestirsin. Yardimci bir veri eksik/celiskili diye otomatik veto YOK. Ama yapisal invalidation veya R/R bozuksa yardimci pozitif veri bunu kurtaramaz.\n");
        sb.append("9) CIKTI DISIPLINI: Ana karar LONG/SHORT/ISLEM YOK; guven 0-100. Gerekcede en fazla 3 BAGIMSIZ aileyi yaz. STOP icin hangi yapisal wick/swing'in disina koydugunu; TP'lerde hangi unswept likidite/yapi hedefini kullandigini isimlendir. Formasyon ismini tek basina gerekce yapma.\n\n");
'''
    method = method.replace(anchor, anchor + protocol, 1)

a = a[:start] + method + a[end:]

# Extra global safety rule in the prompt source, once.
if 'V9532_CANDLE_WICK_DECISION_PROTOCOL' not in a:
    cp = a.find('\n', a.find('public class '))
    if cp > 0:
        a = a[:cp+1] + '    // V9532_CANDLE_WICK_DECISION_PROTOCOL\n' + a[cp+1:]
ANALYSIS.write_text(a)

# Monitor wording only; no new gate is added.
mon = MON.read_text()
if 'V9532_CANDLE_CONTEXT_NO_NEW_GATE' not in mon:
    cp = mon.find('\n', mon.find('public class MonitorService'))
    if cp > 0:
        mon = mon[:cp+1] + '    // V9532_CANDLE_CONTEXT_NO_NEW_GATE: candle patterns stay auxiliary; 15m completed-candle core gate unchanged.\n' + mon[cp+1:]
MON.write_text(mon)

checks = {
    'candle java created': CTX.exists() and 'MUM/FİTİL BAĞLAMI v9.5.32' in CTX.read_text(),
    'wick semantics': 'Gövde=open/close kabulü' in CTX.read_text(),
    'pattern set': 'YUTAN_BOĞA' in CTX.read_text() and 'SABAH_YILDIZI' in CTX.read_text() and 'ÜÇ_KARA_KARGA' in CTX.read_text(),
    'structural stop candidates': 'STOP/INVALIDATION ADAYI' in CTX.read_text(),
    'prompt context injection': 'V9532CandleContext.summary(data)' in ANALYSIS.read_text(),
    'prompt optimized': 'V9.5.32 NET KARAR PROTOKOLU' in ANALYSIS.read_text(),
    'stop wick rule': 'LIQ_DENS tahmini clusterini stop seviyesi diye KORLEME kullanma' in ANALYSIS.read_text(),
    'no new hard gate': 'V9532_CANDLE_CONTEXT_NO_NEW_GATE' in MON.read_text(),
    'version code': 'versionCode 26091203' in BUILD.read_text(),
    'version name': "versionName '9.5.32'" in BUILD.read_text(),
}
failed = [k for k, v in checks.items() if not v]
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
if failed:
    raise SystemExit('v9.5.32 sanity failed: ' + ', '.join(failed))

print('v9.5.32 OK: candle/wick recognition + structural wick-stop semantics + optimized non-choking prompt.')
