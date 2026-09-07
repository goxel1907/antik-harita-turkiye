from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
ENGINE = JAVA / 'StructureEngine.java'
MON = JAVA / 'MonitorService.java'
for p in (ANALYSIS, ENGINE, MON):
    if not p.exists():
        raise SystemExit('v9.5.22a missing: ' + str(p))


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
    while i < len(src) and depth:
        c = src[i]
        if quote:
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
            if c == '"':
                quote = True
            elif c == "'":
                char_quote = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)

# ================================================================
# Analysis package: add 5m + 3m charts and an explicit importance hierarchy.
# 15m remains the primary scenario timeframe. 5m is the main re-entry frame;
# 3m only refines timing. More data must not mean more mandatory confirmations.
# ================================================================
a = ANALYSIS.read_text()
a = a.replace('v9.5.21', 'v9.5.22')
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.22', a)

a = re.sub(r'private static final String\[\] INTERVALS\s*=\s*\{[^;]+\};',
           'private static final String[] INTERVALS = {"15m", "5m", "3m", "1h", "4h", "1d"};', a, count=1)
a = a.replace('final int H = HEADER + PANEL * 4 + 100;',
              'final int H = HEADER + PANEL * INTERVALS.length + 100;')
a = a.replace('15m / 1h / 4h / 1D', '15m / 5m / 3m / 1h / 4h / 1D')
a = a.replace('4 zaman dilimi', '6 zaman dilimi')

# Add forming-candle lines for the lower timeframes to the textual packet.
line15 = '        sb.append(formingLine("15m", forming.get("15m"), now)).append("\\n");'
if line15 in a and 'formingLine("5m"' not in a:
    a = a.replace(line15, line15 + '\n'
                  '        sb.append(formingLine("5m", forming.get("5m"), now)).append("\\n");\n'
                  '        sb.append(formingLine("3m", forming.get("3m"), now)).append("\\n");', 1)

# Disclose actual lower-timeframe history counts if the v9.5.17 history block exists.
old_hist = '''        sb.append("Hesaplama geçmişi: 15m=").append(data.get("15m") == null ? 0 : data.get("15m").size())
                .append(" mum; 1h=").append(data.get("1h") == null ? 0 : data.get("1h").size())'''
new_hist = '''        sb.append("Hesaplama geçmişi: 15m=").append(data.get("15m") == null ? 0 : data.get("15m").size())
                .append(" mum; 5m=").append(data.get("5m") == null ? 0 : data.get("5m").size())
                .append("; 3m=").append(data.get("3m") == null ? 0 : data.get("3m").size())
                .append("; 1h=").append(data.get("1h") == null ? 0 : data.get("1h").size())'''
if old_hist in a:
    a = a.replace(old_hist, new_hist, 1)

# Insert a single authoritative weighted-decision contract. This prevents the
# model from treating every auxiliary metric as a mandatory checkbox.
priority_anchor = '        sb.append("1) KARAR ÖNCELİĞİ\\n");'
weighted = r'''        sb.append("KARAR AĞIRLIK KURALI: Verileri eşit oy gibi sayma. Yaklaşık önem dağılımı: %70 ÇEKİRDEK = tamamlanmış mumlardan yapı + güncel fiyatın yapısal/likidite konumu + gerekli kapanmış mum tetik; %20 ORTA = OI + güvenilir kapsamalı CVD + hacim; %10 YARDIMCI = agresif alım/satım oranı + emir defteri + fonlama + RSI. Yüzdeler mekanik toplama formülü değil, karar önceliğidir. Çekirdek yapı temizse tek bir yardımcı verinin tersliği işlemi otomatik iptal etmez; güveni azaltır.\\n");
        sb.append("YALNIZ DÖRT SERT VETO vardır: (1) kritik veri eski/eksik, (2) fiyat yapısal geçersizlik veya STOP tarafını geçmiş, (3) senaryonun zorunlu TAMAMLANMIŞ mum teyidi yok, (4) güncel yeni girişten R/R yetersiz. Bunların dışındaki OI/CVD/hacim/taker/emir defteri/fonlama/RSI koşulları puanlayıcı kanıttır; hepsinin aynı anda yeşil olmasını bekleme. Kısa veya kısmi CVD karşı sinyal sayılmaz; yalnız düşük ağırlıklı ya da PUANSIZ veri sayılır.\\n");
'''
if priority_anchor in a and 'KARAR AĞIRLIK KURALI:' not in a:
    a = a.replace(priority_anchor, priority_anchor + weighted, 1)

# Lower-timeframe recovery rule: 5m can recover a missed 15m entry, 3m only
# sharpens timing. Never force all frames to confirm the same thing.
ltf_anchor = '        sb.append("5) GEÇ GİRİŞ / KOVALAMA / GEÇERSİZLİK FİLTRESİ\\n");'
ltf_rule = r'''        sb.append("ALT ZAMAN DİLİMİ YENİDEN GİRİŞ KURALI: 15m senaryosu teyit edilmiş fakat eski giriş bölgesi kaçmışsa eski girişi kovalamak yerine en fazla 45 dakika boyunca 5m YENİDEN GİRİŞ modu açılabilir. 5m ana alt zaman dilimidir: yeni salınım + anlamlı yeniden test/reddetme + TAMAMLANMIŞ 5m yapı teyidi + güncel R/R yeterli ise yeni ve bağımsız giriş kurulabilir. 3m yalnız 5m setup zaten geçerliyken giriş hassasiyetini artırır; 3m teyidinin ayrıca gelmesi zorunlu değildir. 1m tek başına kritik LONG/SHORT üretemez. 5m ve 3m eski 15m STOP/TP seviyelerini körlemesine taşımaz; yeni giriş, STOP ve hedefler güncel mikro yapıdan hesaplanır. 45 dakika içinde temiz 5m yapı oluşmazsa eski 15m fırsatı kapanır ve yeni 15m bağlam beklenir.\\n");
'''
if ltf_anchor in a and 'ALT ZAMAN DİLİMİ YENİDEN GİRİŞ KURALI:' not in a:
    a = a.replace(ltf_anchor, ltf_anchor + ltf_rule, 1)

# The inventory and output should explicitly use the new frames.
a = a.replace('Ardından 15M, 1H, 4H ve 1D için ayrı yapı envanteri ver.',
              'Ardından 15M, 5M, 3M, 1H, 4H ve 1D için ayrı yapı envanteri ver. 5M/3M yalnız yeniden giriş ve hassas zamanlama bağlamıdır; ana yönü tek başına tersine çeviremez.')
a = a.replace('Ardından 15M, 1H, 4H ve 1D için ayrı yapı envanteri ver',
              'Ardından 15M, 5M, 3M, 1H, 4H ve 1D için ayrı yapı envanteri ver')

# Make live-flow wording consistent with weighted evidence instead of an all-green gate.
a = a.replace('uygun canlı akış filtresi birlikte sağlandığında',
              'ağırlıklı canlı akış kalite puanı yeterliyken')
a = a.replace('uygun canlı akış filtresi sağlanmalıdır',
              'ağırlıklı canlı akış kalite puanı yeterli olmalıdır')
a = a.replace('canlı akış filtresi sağlanmalıdır',
              'ağırlıklı canlı akış kalite puanı yeterli olmalıdır')

# Extend META without adding another pipe-delimited field.
meta_old = 'TF15:;TF1H:;TF4H:;TF1D:;CONFLUENCE:;WAIT:'
meta_new = 'TF15:;TF5M:;TF3M:;TF1H:;TF4H:;TF1D:;CONFLUENCE:;LTF:<KAPALI/5M_BEKLE/5M_UYGUN>;WAIT:'
a = a.replace(meta_old, meta_new)

if 'V9522_WEIGHTED_DECISION_LTF' not in a:
    p = a.find('\n', a.find('public class '))
    if p < 0: p = 0
    a = a[:p+1] + '    // V9522_WEIGHTED_DECISION_LTF\n' + a[p+1:]
ANALYSIS.write_text(a)

# ================================================================
# Structure engine: objective candidate map now also includes 5m and 3m.
# ================================================================
e = ENGINE.read_text()
e = e.replace('private static final String[] KEYS = {"15m", "1h", "4h", "1d"};',
              'private static final String[] KEYS = {"15m", "5m", "3m", "1h", "4h", "1d"};')
e = e.replace('private static final String[] LABELS = {"15M", "1H", "4H", "1D"};',
              'private static final String[] LABELS = {"15M", "5M", "3M", "1H", "4H", "1D"};')
ENGINE.write_text(e)

# ================================================================
# Monitor live-flow gate: important evidence dominates; low-value evidence
# cannot veto a structurally valid trigger by itself.
# ================================================================
m = MON.read_text().replace('v9.5.21', 'v9.5.22')

b = method_bounds(m, '    private int[] v953FlowScores(MarketSnapshot m) ')
if not b:
    raise SystemExit('v9.5.22a v953FlowScores missing')
a0, _, e0 = b
new_scores = r'''    private int[] v953FlowScores(MarketSnapshot m) {
        int longScore = 0, shortScore = 0, available = 0;
        if (m == null) return new int[]{0,0,0};

        // Orta ağırlık: OI + CVD + hacim. Bunlar yön/katılım kalitesini ölçer.
        if (!Double.isNaN(m.oiChangePct) && !Double.isNaN(m.priceChange15Pct)) {
            available++;
            if (m.oiChangePct > 0.05) {
                if (m.priceChange15Pct > 0) longScore += 20;
                else if (m.priceChange15Pct < 0) shortScore += 20;
            } else if (m.oiChangePct < -0.05) {
                // OI düşüşü yeni yön teyidi değil; pozisyon kapanışı olabilir.
                longScore += 2; shortScore += 2;
            }
        }
        if (!Double.isNaN(m.cvd15)) {
            available++;
            if (m.cvd15 > 0) longScore += 16;
            else if (m.cvd15 < 0) shortScore += 16;
        }
        if (!Double.isNaN(m.volumeRatio)) {
            available++;
            int v = m.volumeRatio >= 1.20 ? 14 : (m.volumeRatio >= 0.75 ? 9 : (m.volumeRatio >= 0.40 ? 4 : 0));
            longScore += v; shortScore += v;
        }

        // Düşük ağırlık: taker/book/funding. Tek başlarına veto edemezler.
        if (!Double.isNaN(m.takerBuyPct)) {
            available++;
            if (m.takerBuyPct >= 52.0) longScore += 9;
            if (m.takerSellPct >= 52.0) shortScore += 9;
        }
        if (!Double.isNaN(m.bidPct)) {
            available++;
            if (m.bidPct >= 54.0) longScore += 5;
            if (m.askPct >= 54.0) shortScore += 5;
        }
        if (!Double.isNaN(m.fundingRate)) {
            available++;
            if (m.fundingRate < 0) longScore += 2;
            else if (m.fundingRate > 0) shortScore += 2;
        }
        return new int[]{Math.min(80,longScore), Math.min(80,shortScore), available};
    }'''
m = m[:a0] + new_scores + m[e0:]

b = method_bounds(m, '    private boolean v953FlowAcceptable(boolean wantLong, MarketSnapshot m, boolean breakoutStyle) ')
if not b:
    raise SystemExit('v9.5.22a v953FlowAcceptable missing')
a0, _, e0 = b
new_accept = r'''    private boolean v953FlowAcceptable(boolean wantLong, MarketSnapshot m, boolean breakoutStyle) {
        // Yapı/konum/kapalı mum ana karardır. Akış kalite puanıdır; her verinin
        // aynı anda yeşil olması gerekmez. Yalnız bariz karşı akış veya aşırı
        // cansız hacim reddeder.
        int[] sc = v953FlowScores(m);
        int support = wantLong ? sc[0] : sc[1];
        int opposite = wantLong ? sc[1] : sc[0];
        if (m == null || sc[2] < 2) return false; // canlı veri gerçekten yetersiz
        if (support < 22) return false;
        if (opposite > support + 18) return false;
        if (!Double.isNaN(m.volumeRatio)) {
            double hardMin = breakoutStyle ? 0.25 : 0.20;
            if (m.volumeRatio < hardMin) return false;
        }
        return true;
    }'''
m = m[:a0] + new_accept + m[e0:]

b = method_bounds(m, '    private boolean v9517StableFlow(String symbol, boolean wantLong, MarketSnapshot market, boolean breakoutStyle) ')
if not b:
    raise SystemExit('v9.5.22a v9517StableFlow missing')
a0, _, e0 = b
new_stable = r'''    private boolean v9517StableFlow(String symbol, boolean wantLong, MarketSnapshot market, boolean breakoutStyle) {
        boolean pass = v953FlowAcceptable(wantLong, market, breakoutStyle);
        int[] sc = v953FlowScores(market);
        int support = wantLong ? sc[0] : sc[1];
        int opposite = wantLong ? sc[1] : sc[0];
        boolean strong = pass && sc[2] >= 3 && support >= 38 && opposite <= support + 5;

        long now = System.currentTimeMillis();
        String side = wantLong ? "LONG" : "SHORT";
        String style = breakoutStyle ? "BRK" : "REV";
        String base = "v9517_flow_" + symbol + "_" + side + "_" + style;
        long last = prefs.getLong(base + "_ts", 0L);
        int count = prefs.getInt(base + "_count", 0);
        long armed = prefs.getLong("v9517_plan_armed_" + symbol, 0L);
        if (last < armed) count = 0;
        if (now - last >= 10000L) {
            count = pass ? Math.min(3, count + 1) : 0;
            prefs.edit().putLong(base + "_ts", now).putInt(base + "_count", count).apply();
        }
        // Güçlü ve çoklu kanıtlı akış tek taze örnekte yeterlidir. Sınırdaki
        // akışta iki örnek gerekir. Böylece hız kazanılır, zayıf sinyal korunur.
        return pass && (strong ? count >= 1 : count >= 2);
    }'''
m = m[:a0] + new_stable + m[e0:]

# User-facing reason must not falsely claim that two samples are always mandatory.
m = m.replace('canlı akış iki ardışık kontrolde uygun bulundu', 'ağırlıklı canlı akış kalite puanı yeterli bulundu')
m = m.replace('iki ardışık uygun canlı akış kontrolü birlikte sağlandı', 'ağırlıklı canlı akış kalite puanı yeterli bulundu')
m = m.replace('iki ardışık uygun canlı-flow örneği', 'yeterli ağırlıklı canlı akış kalite puanı')
m = m.replace('iki ardışık uygun canlı flow', 'yeterli ağırlıklı canlı akış kalite puanı')

if 'V9522_WEIGHTED_FLOW' not in m:
    p = m.find('\n', m.find('public class '))
    if p < 0: p = 0
    m = m[:p+1] + '    // V9522_WEIGHTED_FLOW\n' + m[p+1:]
MON.write_text(m)

# Fail fast.
af = ANALYSIS.read_text(); ef = ENGINE.read_text(); mf = MON.read_text()
checks = [
    ('V9522_WEIGHTED_DECISION_LTF' in af, 'weighted prompt marker'),
    ('{"15m", "5m", "3m", "1h", "4h", "1d"}' in af, 'six chart intervals'),
    ('PANEL * INTERVALS.length' in af, 'dynamic image height'),
    ('KARAR AĞIRLIK KURALI:' in af and 'YALNIZ DÖRT SERT VETO' in af, 'importance hierarchy'),
    ('ALT ZAMAN DİLİMİ YENİDEN GİRİŞ KURALI:' in af, '5m/3m re-entry contract'),
    ('TF5M:' in af and 'TF3M:' in af and 'LTF:<KAPALI/5M_BEKLE/5M_UYGUN>' in af, 'LTF META'),
    ('{"15m", "5m", "3m", "1h", "4h", "1d"}' in ef, 'structure engine LTF'),
    ('V9522_WEIGHTED_FLOW' in mf, 'weighted flow marker'),
    ('support < 22' in mf and 'strong ? count >= 1 : count >= 2' in mf, 'two-tier live flow'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok: raise SystemExit('v9.5.22a sanity failed: ' + name)
print('v9.5.22a OK: 15m core + 5m re-entry + 3m precision; weighted evidence without confirmation overload.')
