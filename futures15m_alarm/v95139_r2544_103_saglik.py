"""R2544.103 (user 02.11: "modellerin çalıştığına emin ol ve office de net göster ayrıca apk güncelleme var ise yap").
Source-generation patch after V95138.
  - committee status: every committee model with its state from the PC (compact status committee.models[]:
    m, st OK|BUSY|QUOTA|SICK, t = at the table, why = short reason): "🧠 modeller: 6/25 çalışıyor", the working ones by name
    (masada marked), then the busy / quota / sick ones with their reason.
Android stays a PC control/telemetry client; nothing here sends anything (Codemagic order check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95139_R2544_103_SAGLIK'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95139 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95138_R2544_98_MUTABIK' not in main:
    raise SystemExit('V95139 requires V95138')
if MARKER in main:
    raise SystemExit('V95139 already applied')

truth = replace(truth,
    '        b.append(v95137CommitteeText(sp)).append(v95138Recent(sp)); // V95137_R2544_89_KURUL + V95138_R2544_98_MUTABIK\n',
    '        b.append(v95137CommitteeText(sp)).append(v95139Models(sp)).append(v95138Recent(sp)); // V95137_R2544_89_KURUL + V95138_R2544_98_MUTABIK + V95139_R2544_103_SAGLIK\n')

helpers = r'''    // ===== V95139_R2544_103_SAGLIK: every committee model and its state (PC R2544.103 committee.models[])
    static String v95139Models(SharedPreferences sp) {
        JSONObject c = json(sp == null ? "" : sp.getString("r2544_89_cm", "{}"));
        org.json.JSONArray ms = c.optJSONArray("models");
        if (ms == null || ms.length() == 0) return "";
        int ok = 0;
        StringBuilder good = new StringBuilder(), busy = new StringBuilder(), quota = new StringBuilder(), sick = new StringBuilder();
        for (int i = 0; i < ms.length(); i++) {
            JSONObject x = ms.optJSONObject(i); if (x == null) continue;
            String m = x.optString("m", "?"), st = x.optString("st", "SICK"), why = x.isNull("why") ? "" : x.optString("why", "");
            if ("OK".equals(st)) { ok++; if (good.length() > 0) good.append(" · "); good.append(m).append(x.optBoolean("t", false) ? " (masada)" : ""); }
            else {
                StringBuilder t = "BUSY".equals(st) ? busy : "QUOTA".equals(st) ? quota : sick;
                if (t.length() < 160) { if (t.length() > 0) t.append(" · "); t.append(m); }
            }
        }
        StringBuilder b = new StringBuilder("\n   🧠 modeller: ").append(ok).append("/").append(ms.length()).append(" çalışıyor");
        if (ok < 2) b.append(" — tek modelin yetkisi yok, kural karar verir");
        if (good.length() > 0) b.append("\n     ✅ ").append(good);
        if (busy.length() > 0) b.append("\n     ⏳ yoğun: ").append(busy);
        if (quota.length() > 0) b.append("\n     💤 kota/kredi: ").append(quota);
        if (sick.length() > 0) b.append("\n     ❌ çalışmıyor: ").append(sick);
        return b.toString();
    }
'''
truth = replace(truth, '    static String v95133RuleTr(String r) {\n', helpers + '    static String v95133RuleTr(String r) {\n')

build = replace(build, 'versionCode 26102801', 'versionCode 26110201')
build = replace(build, "versionName '9.5.130-r2544.98-mutabik'", "versionName '9.5.131-r2544.103-saglik'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
