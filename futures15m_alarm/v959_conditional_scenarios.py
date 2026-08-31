from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MONITOR = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MONITOR, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.9 missing: {p}')

# ------------------------------------------------------------------
# v9.5.9 core fix
# ChatGPT ANA_KARAR=ISLEM_YOK means "no entry NOW", not "disable every
# conditional scenario forever". LP/LB/SR/SB remain monitored and can create
# a critical alarm later if their own completed-15m + entry-range + live-flow
# confirmation becomes valid. LONG/SHORT decisions still keep the opposite
# direction passive. Missing/invalid META remains locked for safety.
# ------------------------------------------------------------------

# ---------------- MainActivity: make the meaning explicit on screen. --------
s = MAIN.read_text()
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.9', s)
s = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.9 MANUEL PRO çalışma şekli:', s)

old_label = '''    private String v953ScenarioLabel(String symbol, String side, String base) {
        String d = v953Decision(symbol);
        if ("ISLEM_YOK".equals(d)) return "KOŞULLU • " + base;
        if (side.equals(d)) return "AKTİF ADAY • " + base;
        if ("LONG".equals(d) || "SHORT".equals(d)) return "PASİF • " + base;
        return "META EKSİK • " + base;
    }'''
new_label = '''    private String v953ScenarioLabel(String symbol, String side, String base) {
        String d = v953Decision(symbol);
        if ("ISLEM_YOK".equals(d)) return "KOŞULLU ADAY • " + base;
        if (side.equals(d)) return "ÖNCELİKLİ ADAY • " + base;
        if ("LONG".equals(d) || "SHORT".equals(d)) return "PASİF • " + base;
        return "META EKSİK • " + base;
    }'''
if old_label in s:
    s = s.replace(old_label, new_label, 1)
elif 'KOŞULLU ADAY • ' not in s:
    raise SystemExit('v9.5.9 MainActivity scenario-label anchor missing')

old_gate = '''        if ("ISLEM_YOK".equals(d)) {
            body = "🔒 ANA KARAR: İŞLEM YOK\\n"
                    + "Kritik işlem alarmı KAPALI. Aşağıdaki LONG/SHORT seviyeleri yalnız KOŞULLU SENARYODUR. "
                    + "Yeni ChatGPT analizi ANA KARAR'ı LONG veya SHORT yapmadan giriş alarmı üretilmez.";
            fg = Color.rgb(251, 191, 36);'''
new_gate = '''        if ("ISLEM_YOK".equals(d)) {
            body = "🟡 ANA KARAR: İŞLEM YOK — ŞU AN GİRİŞ YOK\\n"
                    + "KOŞULLU SENARYOLAR AKTİF İZLENİYOR. Bu karar alarm motorunu kilitlemez. "
                    + "LP/LB/SR/SB senaryolarından biri kendi şartlarını sağlarsa kritik alarm üretilebilir.\\n"
                    + "ALARM ŞARTI: tamamlanmış 15m teyit + fiyat geçerli giriş/retest alanında + canlı flow filtresi uygun. "
                    + "META eksikse veya motor verisi eskiyse güvenlik için alarm kilitlenir.";
            fg = Color.rgb(251, 191, 36);'''
if old_gate in s:
    s = s.replace(old_gate, new_gate, 1)
elif 'KOŞULLU SENARYOLAR AKTİF İZLENİYOR' not in s:
    raise SystemExit('v9.5.9 MainActivity ISLEM_YOK gate anchor missing')

MAIN.write_text(s)

# ---------------- MonitorService: actual alarm-engine behavior. -------------
m = MONITOR.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.9', m)

old_allowed = '''    private boolean v953DirectionAllowed(String symbol, boolean wantLong) {
        String d = v953Decision(symbol);
        return wantLong ? "LONG".equals(d) : "SHORT".equals(d);
    }'''
new_allowed = '''    private boolean v953DirectionAllowed(String symbol, boolean wantLong) {
        String d = v953Decision(symbol);
        // v9.5.9: ISLEM_YOK = "no entry at analysis time". It does NOT disable
        // future conditional LP/LB/SR/SB confirmations. Both sides may be
        // monitored, while LONG/SHORT decisions keep the opposite side passive.
        if ("ISLEM_YOK".equals(d)) return true;
        if ("LONG".equals(d)) return wantLong;
        if ("SHORT".equals(d)) return !wantLong;
        return false; // missing/invalid META stays fail-safe locked
    }'''
if old_allowed in m:
    m = m.replace(old_allowed, new_allowed, 1)
elif 'if ("ISLEM_YOK".equals(d)) return true;' not in m:
    raise SystemExit('v9.5.9 MonitorService direction-gate anchor missing')

old_live_gate = '''        if ("ISLEM_YOK".equals(v953d)) {
            b.append("• ANA KARAR: İŞLEM YOK → kritik alarm KİLİTLİ\\n");
            b.append("• Seviyeler yalnız koşullu referanstır; yeni ChatGPT planı beklenir.\\n");'''
new_live_gate = '''        if ("ISLEM_YOK".equals(v953d)) {
            b.append("• ANA KARAR: İŞLEM YOK = ŞU AN GİRİŞ YOK; alarm motoru KİLİTLİ DEĞİL\\n");
            b.append("• LP/LB/SR/SB koşullu senaryoları AKTİF izleniyor\\n");
            b.append("• LONG flow: ").append(v953LongFlow ? "UYGUN" : "BEKLE / YETERSİZ")
                    .append("  •  SHORT flow: ").append(v953ShortFlow ? "UYGUN" : "BEKLE / YETERSİZ").append("\\n");
            b.append("• Kritik alarm yalnız senaryonun TAMAMLANMIŞ 15m teyidi + geçerli giriş/retest + uygun canlı flow ile gelir\\n");'''
if old_live_gate in m:
    m = m.replace(old_live_gate, new_live_gate, 1)
elif 'alarm motoru KİLİTLİ DEĞİL' not in m:
    raise SystemExit('v9.5.9 MonitorService live gate anchor missing')

MONITOR.write_text(m)

# ---------------- Analysis pack visible version only. ------------------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.9', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.9', a)
ANALYSIS.write_text(a)

# ---------------- Version bump. ---------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 23', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.9'", b, count=1)
BUILD.write_text(b)

# ---------------- Fail-fast checks. -----------------------------------------
mf = MAIN.read_text()
mon = MONITOR.read_text()
af = ANALYSIS.read_text()
bf = BUILD.read_text()
checks = [
    ('15m Futures Alarm PRO v9.5.9' in mf, 'MainActivity version'),
    ('KOŞULLU SENARYOLAR AKTİF İZLENİYOR' in mf, 'explicit ISLEM_YOK screen wording'),
    ('KOŞULLU ADAY • ' in mf, 'conditional scenario labels'),
    ('if ("ISLEM_YOK".equals(d)) return true;' in mon, 'ISLEM_YOK monitors both directions'),
    ('alarm motoru KİLİTLİ DEĞİL' in mon, 'live gate wording'),
    ('LP/LB/SR/SB koşullu senaryoları AKTİF izleniyor' in mon, 'live conditional status'),
    ('return false; // missing/invalid META stays fail-safe locked' in mon, 'missing META safety lock'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.9' in af, 'analysis package version'),
    ('versionCode 23' in bf and "versionName '9.5.9'" in bf, 'build version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.9 check failed: ' + msg)

print('v9.5.9 OK: ISLEM_YOK now means no entry NOW; LP/LB/SR/SB remain conditionally monitored. LONG/SHORT still prioritize one direction; missing META and stale motor data stay fail-safe locked.')
