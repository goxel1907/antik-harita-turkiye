from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MONITOR = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
ENGINE = JAVA / 'StructureEngine.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MONITOR, ANALYSIS, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.17 missing: {p}')

# ------------------------------------------------------------------
# v9.5.17 goals
# 1) Never fire an old 15m confirmation immediately after a new plan paste.
# 2) Only urgent-alert in the first 3 minutes after a real 15m close.
# 3) Use deeper history for structure calculations while keeping chart readable.
# 4) Add estimated stop/liquidity-hunt bands around nearby BSL/SSL pools.
# ------------------------------------------------------------------

# ---------------- MainActivity: arm time on every plan update ----------------
s = MAIN.read_text()
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.17', s)
s = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.17  •  MANUEL PRO', s)
s = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.17 MANUEL PRO çalışma şekli:', s)

arm_anchor = '    private void v953ResetSignalLocks(String symbol) {'
if 'v9517_plan_armed_' not in s:
    if arm_anchor not in s:
        raise SystemExit('v9.5.17 MainActivity arm anchor missing')
    s = s.replace(arm_anchor, arm_anchor + '''\n        // Fresh-plan guard: a newly pasted plan may not replay a candle that\n        // had already closed before the plan existed.\n        getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()\n                .putLong("v9517_plan_armed_" + symbol, System.currentTimeMillis())\n                .apply();''', 1)

# Make the candle time label explicit: it is the candle start, not alarm time.
s = s.replace(' • Mum: ', ' • Mum başlangıcı: ')
MAIN.write_text(s)

# ---------------- MonitorService: no retroactive/late urgent alarms ----------
m = MONITOR.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.17', m)
m = m.replace(' • Mum: ', ' • Mum başlangıcı: ')

helper_anchor = '    private String v953Decision(String symbol) {'
if 'private boolean v9517FreshSignalEligible(' not in m:
    if helper_anchor not in m:
        raise SystemExit('v9.5.17 MonitorService helper anchor missing')
    helper = r'''    private boolean v9517FreshSignalEligible(String symbol) {
        // Binance 15m candles close on exact 15-minute UTC boundaries.
        // A critical alarm is valid only near that close and only if the plan
        // was already armed before the close. This prevents historical replay
        // when a plan is pasted after an older candle has already confirmed.
        long now = System.currentTimeMillis();
        final long TF15 = 15L * 60L * 1000L;
        long latestCloseBoundary = (now / TF15) * TF15;
        long ageMs = now - latestCloseBoundary;
        long armedAt = prefs.getLong("v9517_plan_armed_" + symbol, 0L);
        boolean planExistedBeforeClose = armedAt <= 0L || armedAt <= latestCloseBoundary;
        boolean closeIsFresh = ageMs >= 0L && ageMs <= 3L * 60L * 1000L;
        return planExistedBeforeClose && closeIsFresh;
    }

'''
    m = m.replace(helper_anchor, helper + helper_anchor, 1)

# Inject the fresh-close gate into all four critical scenario confirmations.
def add_gate(text, pattern, label):
    if 'v9517FreshSignalEligible(p.symbol)' in text[text.find(pattern):text.find(pattern)+260] if pattern in text else False:
        return text
    if pattern not in text:
        raise SystemExit('v9.5.17 missing condition anchor: ' + label)
    return text.replace(pattern, pattern + '\n                && v9517FreshSignalEligible(p.symbol)', 1)

m = add_gate(m, 'boolean pullConfirmed = v953DirectionAllowed(p.symbol, true)', 'pullback')
m = add_gate(m, 'boolean resConfirmed = v953DirectionAllowed(p.symbol, false)', 'resistance')
m = add_gate(m, 'boolean breakout = v953DirectionAllowed(p.symbol, true)', 'breakout')
m = add_gate(m, 'boolean breakdown = v953DirectionAllowed(p.symbol, false)', 'breakdown')

MONITOR.write_text(m)

# ---------------- AnalysisPackActivity: deeper compute history ----------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.17', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.17', a)

fetch_anchor = '    private List<Candle> fetchCompletedCandles(String symbol, String interval, long now) throws Exception {'
if 'private int v9517HistoryLimit(' not in a:
    if fetch_anchor not in a:
        raise SystemExit('v9.5.17 Analysis history helper anchor missing')
    hist_helper = r'''    private int v9517HistoryLimit(String interval) {
        // Computation history is intentionally deeper than the rendered chart.
        // This improves swing/FVG/OB/liquidity context without making the image unreadable.
        if ("15m".equals(interval)) return 320; // ~3.3 days
        if ("1h".equals(interval)) return 300;  // ~12.5 days
        if ("4h".equals(interval)) return 240;  // ~40 days
        if ("1d".equals(interval)) return 240;  // ~8 months
        return 240;
    }

'''
    a = a.replace(fetch_anchor, hist_helper + fetch_anchor, 1)

# Replace the old fixed 101/100 fetch cap.
a = a.replace('&limit=101";', '&limit=" + (v9517HistoryLimit(interval) + 1);', 1)
a = a.replace('while (out.size() > 100) out.remove(0);',
              'while (out.size() > v9517HistoryLimit(interval)) out.remove(0);', 1)

# Render only the most recent 120 bars per panel even though structure uses more.
old_visual = '        List<Candle> visual = new ArrayList<>(list);'
new_visual = '''        int v9517From = Math.max(0, list.size() - 120);
        List<Candle> visual = new ArrayList<>(list.subList(v9517From, list.size()));'''
if old_visual in a:
    a = a.replace(old_visual, new_visual, 1)
elif 'int v9517From = Math.max(0, list.size() - 120);' not in a:
    raise SystemExit('v9.5.17 Analysis render-window anchor missing')

# Update visible wording and add actual history counts to the ChatGPT context.
a = a.replace('100 tamamlanmış + AÇIK/ANLIK mum', 'geniş geçmiş + AÇIK/ANLIK mum')
a = a.replace('100 tamamlanmış mum + her periyodun AÇIK/ANLIK mumu',
              'genişletilmiş kapanmış mum geçmişi + her periyodun AÇIK/ANLIK mumu')

forming_prompt_anchor = '        sb.append(formingLine("15m", forming.get("15m"), now)).append("\\n");'
if 'Hesaplama geçmişi:' not in a:
    if forming_prompt_anchor not in a:
        raise SystemExit('v9.5.17 prompt history anchor missing')
    hist_prompt = '''        sb.append("Hesaplama geçmişi: 15m=").append(data.get("15m") == null ? 0 : data.get("15m").size())
                .append(" mum; 1h=").append(data.get("1h") == null ? 0 : data.get("1h").size())
                .append("; 4h=").append(data.get("4h") == null ? 0 : data.get("4h").size())
                .append("; 1D=").append(data.get("1d") == null ? 0 : data.get("1d").size()).append(".\\n");
'''
    a = a.replace(forming_prompt_anchor, hist_prompt + forming_prompt_anchor, 1)

# Explicitly require liquidity-hunt analysis but forbid invented exact liquidation levels.
hunt_rule = ('Likidite avı/stop hunt analizinde BSL/SSL, EQH/EQL, son swing high/low, önceki gün/saat ekstremi, '
             'wick sweep + kapanış reclaim/rejection, hacim, OI, CVD ve taker/orderbook uyumunu birlikte değerlendir. '
             'Bireysel yatırımcıların gerçek kaldıraç ve giriş fiyatları bilinmediği için kesin likidasyon seviyesi veya market maker niyeti uydurma; '
             'yalnız TAHMİNİ STOP/LIKIDITE AV BÖLGESİ ve güven puanı ver. ')
plan_rule = 'Plan seviyelerini mevcut grafiklerdeki yapıya göre üret.'
if hunt_rule not in a and plan_rule in a:
    a = a.replace(plan_rule, hunt_rule + plan_rule, 1)

ANALYSIS.write_text(a)

# ---------------- StructureEngine: larger window + hunt bands -----------------
e = ENGINE.read_text()
e = e.replace('int start = Math.max(0, src.size() - 100);',
              'int start = Math.max(0, src.size() - 320);', 1)

liq_line = '            out.append("• Likidite: BSL ").append(f.bsl).append("   SSL ").append(f.ssl).append("\\n");'
if 'Stop/Likidite Av Haritası' not in e:
    if liq_line not in e:
        raise SystemExit('v9.5.17 engine output anchor missing')
    e = e.replace(liq_line, liq_line + '\n            out.append("• Stop/Likidite Av Haritası: ").append(f.hunt).append("\\n");', 1)

assign_anchor = '''        f.bsl = liquidityLevels(highs);
        f.ssl = liquidityLevels(lows);'''
if 'f.hunt = huntMap(' not in e:
    if assign_anchor not in e:
        raise SystemExit('v9.5.17 engine hunt assignment anchor missing')
    e = e.replace(assign_anchor, assign_anchor + '\n        f.hunt = huntMap(highs, lows, last.close, atr);', 1)

helper_engine_anchor = '    private static String equalLevel(List<Swing> s, double tol) {'
if 'private static String huntMap(' not in e:
    if helper_engine_anchor not in e:
        raise SystemExit('v9.5.17 engine helper anchor missing')
    hunt_helper = r'''    private static String huntMap(List<Swing> highs, List<Swing> lows, double close, double atr) {
        Swing above = null;
        for (Swing x : highs) {
            if (x.price > close && (above == null || x.price < above.price)) above = x;
        }
        Swing below = null;
        for (Swing x : lows) {
            if (x.price < close && (below == null || x.price > below.price)) below = x;
        }
        double band = Math.max(close * 0.0010, atr * 0.15);
        List<String> out = new ArrayList<>();
        if (above != null) {
            out.add("BSL_AV_ADAY " + p(Math.max(0.0, above.price - band)) + "-" + p(above.price + band));
        }
        if (below != null) {
            out.add("SSL_AV_ADAY " + p(Math.max(0.0, below.price - band)) + "-" + p(below.price + band));
        }
        if (out.isEmpty()) return "YAKIN_HAVUZ_YOK";
        return join(out, " | ") + " • TAHMINI; kesin likidasyon seviyesi degildir";
    }

'''
    e = e.replace(helper_engine_anchor, hunt_helper + helper_engine_anchor, 1)

old_frame = '        String structure, bos, choch, fvg, ob, breaker, eqh, eql, bsl, ssl, fib, pd;'
new_frame = '        String structure, bos, choch, fvg, ob, breaker, eqh, eql, bsl, ssl, hunt, fib, pd;'
if old_frame in e:
    e = e.replace(old_frame, new_frame, 1)
elif 'ssl, hunt, fib' not in e:
    raise SystemExit('v9.5.17 engine Frame anchor missing')

old_nodata = '            structure = bos = choch = fvg = ob = breaker = eqh = eql = bsl = ssl = fib = pd = "YETERSIZ_VERI";'
new_nodata = '            structure = bos = choch = fvg = ob = breaker = eqh = eql = bsl = ssl = hunt = fib = pd = "YETERSIZ_VERI";'
if old_nodata in e:
    e = e.replace(old_nodata, new_nodata, 1)
elif 'ssl = hunt = fib' not in e:
    raise SystemExit('v9.5.17 engine no-data anchor missing')

ENGINE.write_text(e)

# ---------------- Build version ----------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 31', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.17'", b, count=1)
BUILD.write_text(b)

# ---------------- Fail-fast diagnostics --------------------------------------
mf = MAIN.read_text()
mon = MONITOR.read_text()
af = ANALYSIS.read_text()
ef = ENGINE.read_text()
bf = BUILD.read_text()
checks = [
    ('v9.5.17' in mf, 'Main version'),
    ('v9517_plan_armed_' in mf, 'plan arm timestamp'),
    ('v9517FreshSignalEligible' in mon, 'fresh signal helper'),
    (mon.count('&& v9517FreshSignalEligible(p.symbol)') >= 4, 'all four scenario freshness gates'),
    ('v9517HistoryLimit' in af and 'return 320' in af and 'return 300' in af, 'deeper history limits'),
    ('list.size() - 120' in af, 'render stays readable'),
    ('Hesaplama geçmişi:' in af, 'history disclosed to ChatGPT'),
    ('TAHMİNİ STOP/LIKIDITE AV BÖLGESİ' in af, 'prompt hunt rule'),
    ('src.size() - 320' in ef, 'structure engine deeper window'),
    ('Stop/Likidite Av Haritası' in ef and 'huntMap' in ef, 'estimated hunt map'),
    ('versionCode 31' in bf and "versionName '9.5.17'" in bf, 'version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.17 check failed: ' + msg)

print('v9.5.17 OK: fresh-plan/no-retroactive alarm guard + 3m close freshness + deeper structure history + estimated stop/liquidity-hunt map.')
