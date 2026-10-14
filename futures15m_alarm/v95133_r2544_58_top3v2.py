"""R2544.58: Ilk 3 Avcisi v2 on the phone - 5m rules line, risk per trade, last 5m pass and waiting signals, rule names.
Source-generation patch after V95132. The phone stays a PC control/telemetry client (the PC alone places orders).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95133_R2544_58_TOP3_V2'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95133 anchor count %d: %s' % (s.count(old), old[:100]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95132_R2544_57_LANES' not in truth:
    raise SystemExit('V95133 requires V95132')
if MARKER in truth:
    raise SystemExit('V95133 already applied')

# rules v2 line right under the lane title
truth = replace(truth,
    '            b.append("\\n\\n🎯 İLK 3 AVCISI");\n',
    '            b.append("\\n\\n🎯 İLK 3 AVCISI");\n'
    '            // V95133_R2544_58_TOP3_V2: 5m rules, risk per trade\n'
    '            JSONObject rl3 = t.optJSONObject("rules");\n'
    '            boolean v2 = rl3 != null && rl3.optInt("rulesVersion", 1) == 2;\n'
    '            if (v2) b.append("\\nKurallar v2 (5 dk mum, saatlik mum beklenmez): erken LONG = gün/hafta/ay tepesi kırılımı + ilk geri test (kovalamaz), hedef üst likidasyon bölgesi • tepe SHORT = yeni 24 sa tepe + 5 dk yapı kırılımı • stopta hesabın %")\n'
    '                .append(String.format(java.util.Locale.US, "%.1f", rl3.optDouble("riskPct", 0.02) * 100)).append("’i");\n')

# margin line: in v2 margin x leverage is only the upper bound (the lot comes from the risk budget)
truth = replace(truth,
    '.append(" • kaldıraç ").append(st.optInt("leverage", 10)).append("x (LONG etkin ").append(st.optInt("effectiveLong", 10)).append("x)");',
    '.append(" • kaldıraç ").append(st.optInt("leverage", 10)).append(v2 ? "x (üst sınır; büyüklük risk bütçesinden)" : "x (LONG etkin " + st.optInt("effectiveLong", 10) + "x)");')

# rule name on each open lot
truth = replace(truth,
    '                 .append("REPEAT".equals(x.optString("signalKind", "")) ? " • TEKRAR" : "")\n',
    '                 .append("REPEAT".equals(x.optString("signalKind", "")) ? " • TEKRAR" : "")\n'
    '                 .append(" • ").append(v95133RuleTr(x.optString("rule", "")))\n')

# last 5m pass and waiting signals
truth = replace(truth,
    '            JSONObject r = t.optJSONObject("results");\n            JSONObject rt = r == null ? null : r.optJSONObject("test")',
    '            JSONObject s5 = t.optJSONObject("lastScan5");\n'
    '            if (v2 && s5 != null) {\n'
    '                JSONObject cc = s5.optJSONObject("candidates");\n'
    '                JSONArray sg = s5.optJSONArray("signals");\n'
    '                b.append("\\nSon 5 dk tarama: ").append(s5.optInt("checked", 0)).append(" coin");\n'
    '                if (cc != null) b.append(" (LONG aday ").append(cc.optInt("long", 0)).append(" / SHORT aday ").append(cc.optInt("short", 0)).append(")");\n'
    '                b.append(" • ").append(sg == null ? 0 : sg.length()).append(" sinyal");\n'
    '                JSONArray wt = s5.optJSONArray("waiting");\n'
    '                if (wt != null && wt.length() > 0) {\n'
    '                    b.append("\\nBekleyen: ");\n'
    '                    for (int i = 0; i < Math.min(4, wt.length()); i++) {\n'
    '                        JSONObject x = wt.optJSONObject(i);\n'
    '                        if (x == null) continue;\n'
    '                        if (i > 0) b.append(" • ");\n'
    '                        b.append(str(x, "symbol")).append(" ").append(str(x, "side")).append(" (").append(v95133ReasonTr(x.optString("reason", ""))).append(")");\n'
    '                    }\n'
    '                }\n'
    '            }\n'
    '            JSONObject r = t.optJSONObject("results");\n            JSONObject rt = r == null ? null : r.optJSONObject("test")')

truth = replace(truth,
    '    static String v95132StateTr(String s) {\n',
    '    // V95133_R2544_58_TOP3_V2\n'
    '    static String v95133RuleTr(String r) {\n'
    '        if ("LONG_EARLY_RETEST".equals(r)) return "erken LONG";\n'
    '        if ("SHORT_TOP_BREAK".equals(r)) return "tepe SHORT";\n'
    '        if ("LONG_6OF6".equals(r)) return "LONG 6/6";\n'
    '        if ("SHORT_TOP_FADE".equals(r)) return "SHORT tepe sonrası";\n'
    '        return r.isEmpty() ? "—" : r;\n'
    '    }\n'
    '    static String v95133ReasonTr(String s) {\n'
    '        if ("V2_WAITING_RETEST".equals(s)) return "geri test bekleniyor";\n'
    '        if ("V2_RETEST_ALREADY_PASSED".equals(s)) return "geri test kaçtı, kovalanmaz";\n'
    '        if ("V2_BREAKOUT_FAILED".equals(s)) return "kırılım geri alındı";\n'
    '        if ("V2_BREAKOUT_VOLUME_LOW".equals(s)) return "kırılım hacmi düşük";\n'
    '        if ("V2_CONTEXT".equals(s)) return "sıra koşulu yok";\n'
    '        if ("V2_NO_BREAK_YET".equals(s)) return "yapı kırılımı bekleniyor";\n'
    '        if ("V2_BREAK_ALREADY_PASSED".equals(s)) return "kırılım geçti, kovalanmaz";\n'
    '        if ("V2_NEW_HIGH_NOW".equals(s)) return "yeni tepe yapıyor";\n'
    '        return s.isEmpty() ? "—" : s;\n'
    '    }\n'
    '    static String v95132StateTr(String s) {\n')

build = replace(build, 'versionCode 26101301', 'versionCode 26101401')
build = replace(build, "versionName '9.5.124-r2544.57-lanes'", "versionName '9.5.125-r2544.58-top3v2'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
truth = truth.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
