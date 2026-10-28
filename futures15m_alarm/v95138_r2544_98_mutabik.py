"""R2544.98 (user 28.10: "istersem direk canlıya geçeceğim gibi ayarla, apk da buna dahil; apk da modellerin toplu halde mutabık
kararını da göster"). Source-generation patch after V95137.
  - "🤝 Kurulla CANLI’ya geç": both strategies go to the committee AND are selected for LIVE (PC /live/top3 | /live/zirve5
    {committeeMode, liveEnabled, confirm LIVE}); then the phone's normal "CANLI’YA GEÇ — GERÇEK PARA" dialog opens (the final
    press stays with the user, nothing goes LIVE by itself).
  - per open lot: the committee's AGREEMENT (oybirliği / tartışma sonrası çoğunluk / çoğunluk riski azaltmak istedi / tek oy /
    anlaşma yok) and every model's vote, for the entry and for the desk.
  - the committee's latest entry decisions, also the ones that blocked a signal ("işlem açılmadı").
  - warning text: only an AGREED GİRME (2+ models) blocks a trade; one model or no agreement -> the rule decides.
Android stays a PC control/telemetry client: a switch is not an order; it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95138_R2544_98_MUTABIK'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95138 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95137_R2544_89_KURUL' not in main:
    raise SystemExit('V95138 requires V95137')
if MARKER in main:
    raise SystemExit('V95138 already applied')

# ------------------------------------------------------------------ client: committee + LIVE selection in one setting call
client = replace(client,
    '    public static JSONObject setCommittee(Context c, String lane, boolean on, boolean liveConfirm) throws Exception {\n',
    '    // V95138_R2544_98_MUTABIK: "Kurulla CANLI" = decision owner KURUL and the strategy selected for LIVE. A setting, never an\n'
    '    // order; the PC still needs its own LIVE switch (the phone\'s GERÇEK PARA dialog) before anything trades live.\n'
    '    public static JSONObject setCommitteeLive(Context c, String lane) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("committeeMode", true);\n'
    '        body.put("liveEnabled", true);\n'
    '        body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "zirve5".equals(lane) ? "/live/zirve5" : "/live/top3", body, true);\n'
    '    }\n'
    '    public static JSONObject setCommittee(Context c, String lane, boolean on, boolean liveConfirm) throws Exception {\n')

# ------------------------------------------------------------------ main: warning text + Kurulla CANLI selects LIVE too
main = replace(main,
    '        + "Girişte kurul GİR demezse işlem açılmaz (yalnız veto). Açık pozisyonda kurul yarısını kapatabilir, stopu yalnız kâra doğru yaklaştırabilir, çıkabilir. "\n',
    '        + "Girişte kurul ANLAŞARAK (oybirliği / tartışma sonrası çoğunluk, en az 2 model) GİRME derse işlem açılmaz; tek model ya da anlaşmazlıkta kural karar verir. "\n'
    '        + "Açık pozisyonda kurul yarısını kapatabilir, stopu yalnız kâra doğru yaklaştırabilir, çıkabilir; çoğunluk riski azaltmak isterse en yumuşak adım uygulanır. "\n')
main = replace(main,
    '            .setMessage("1) İlk 3 ve ZİRVE-5’in karar sahibi KURUL olur.\\n2) Ardından “CANLI’YA GEÇ — GERÇEK PARA” onayı açılır; son onay sende.\\n\\n" + V95137_WARN)\n',
    '            .setMessage("1) İlk 3 ve ZİRVE-5’in karar sahibi KURUL olur ve ikisi CANLI’da seçili olur.\\n2) Ardından “CANLI’YA GEÇ — GERÇEK PARA” onayı açılır; son onay sende (onaylamazsan PC TEST’te kalır).\\n\\n" + V95137_WARN)\n')
main = replace(main,
    '                    org.json.JSONObject a = BrainHubClient.setCommittee(this, "top3", true, live);\n'
    '                    org.json.JSONObject b = BrainHubClient.setCommittee(this, "zirve5", true, live);\n',
    '                    org.json.JSONObject a = BrainHubClient.setCommitteeLive(this, "top3"); // V95138_R2544_98_MUTABIK\n'
    '                    org.json.JSONObject b = BrainHubClient.setCommitteeLive(this, "zirve5");\n')
main = replace(main,
    '                v95132Done(sp, "Kurul hazır (İlk 3 + ZİRVE-5). CANLI onayı açılıyor.");\n',
    '                v95132Done(sp, "Kurul hazır, İlk 3 + ZİRVE-5 CANLI’da seçili. CANLI onayı açılıyor.");\n')

# ------------------------------------------------------------------ status: agreement + votes per lot, latest entry decisions
truth = replace(truth,
    '        b.append(v95137CommitteeText(sp)); // V95137_R2544_89_KURUL\n',
    '        b.append(v95137CommitteeText(sp)).append(v95138Recent(sp)); // V95137_R2544_89_KURUL + V95138_R2544_98_MUTABIK\n')
start = truth.index('    static String v95137LotCm(JSONObject cm) {\n')
end = truth.index('        return b.toString();\n    }\n', start) + len('        return b.toString();\n    }\n')
truth = truth[:start] + r'''    // ===== V95138_R2544_98_MUTABIK: the committee's agreement and every model's vote (PC R2544.98 active[].cm.entry/desk .c .v, committee.recent)
    static String v95138Cons(String c) {
        if (c == null) return "";
        switch (c) {
            case "UNANIMOUS": return "oybirliği";
            case "MAJORITY_AFTER_DEBATE": return "tartışma sonrası çoğunluk";
            case "REDUCE_MAJORITY": return "çoğunluk riski azaltmak istedi (en yumuşak adım)";
            case "SINGLE_VOTER_DEFAULT": return "tek model (yetki yok, kural karar verir)";
            case "NO_MAJORITY_DEFAULT": return "anlaşma yok (kural / TUT)";
            default: return c;
        }
    }
    static String v95138Dec(String d) {
        if (d == null) return "—";
        switch (d) {
            case "TAKE": return "GİR";
            case "SKIP": return "GİRME";
            case "RULE": return "KURAL";
            case "HOLD": return "TUT";
            case "TIGHTEN_STOP": return "STOPU YAKLAŞTIR";
            case "TAKE_PARTIAL": return "YARISINI AL";
            case "EXIT": return "ÇIK";
            case "ERR": return "cevap yok";
            default: return d;
        }
    }
    static String v95138Votes(org.json.JSONArray v) {
        if (v == null || v.length() == 0) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < v.length(); i++) {
            JSONObject x = v.optJSONObject(i); if (x == null) continue;
            if (b.length() > 0) b.append(" · ");
            b.append(x.optString("m", "?")).append(" ").append(v95138Dec(x.isNull("d") ? null : x.optString("d", null)));
        }
        return b.toString();
    }
    static String v95137LotCm(JSONObject cm) {
        if (cm == null) return "";
        StringBuilder b = new StringBuilder();
        JSONObject e = cm.optJSONObject("entry"), d = cm.optJSONObject("desk");
        if (e != null) {
            String dd = e.isNull("d") ? "" : e.optString("d", "");
            String cd = e.isNull("cd") ? "" : e.optString("cd", "");
            b.append("\n     🤝 kurul giriş: ");
            if (dd.isEmpty()) b.append("karar yok").append(e.isNull("err") ? "" : " (" + e.optString("err", "") + ")").append(" → kural açtı");
            else if ("RULE".equals(dd)) b.append("kurul ").append(v95138Dec(cd)).append(" dedi ama anlaşma yok → kural açtı");
            else b.append(v95138Dec(dd));
            String cons = v95138Cons(e.isNull("c") ? null : e.optString("c", null));
            if (!cons.isEmpty()) b.append(" — ").append(cons);
            b.append(e.optBoolean("auth", false) ? " (YETKİLİ)" : " (gölge)");
            String vs = v95138Votes(e.optJSONArray("v"));
            if (!vs.isEmpty()) b.append("\n        oylar: ").append(vs);
        }
        if (d != null) {
            b.append("\n     🧑‍💼 masa: ").append(v95138Dec(d.isNull("a") ? null : d.optString("a", null)));
            String cons = v95138Cons(d.isNull("c") ? null : d.optString("c", null));
            if (!cons.isEmpty()) b.append(" — ").append(cons);
            b.append(d.optBoolean("auth", false) ? " (YETKİLİ)" : " (gölge)");
            String vs = v95138Votes(d.optJSONArray("v"));
            if (!vs.isEmpty()) b.append("\n        oylar: ").append(vs);
            String t = d.optString("t", "");
            if (!t.isEmpty()) b.append("\n        ").append(t);
        }
        return b.toString();
    }
    static String v95138Recent(SharedPreferences sp) {
        JSONObject c = json(sp == null ? "" : sp.getString("r2544_89_cm", "{}"));
        org.json.JSONArray r = c.optJSONArray("recent");
        if (r == null || r.length() == 0) return "";
        StringBuilder b = new StringBuilder("\n   🤝 kurulun son giriş kararları:");
        for (int i = 0; i < Math.min(4, r.length()); i++) {
            JSONObject x = r.optJSONObject(i); if (x == null) continue;
            b.append("\n     ").append(x.optString("s", "?")).append(" ").append(x.optString("side", "")).append(": ")
             .append(v95138Dec(x.isNull("d") ? null : x.optString("d", null))).append(" — ").append(v95138Cons(x.isNull("c") ? null : x.optString("c", null)))
             .append(x.optBoolean("b", false) ? " → İŞLEM AÇILMADI" : "");
            String vs = v95138Votes(x.optJSONArray("v"));
            if (!vs.isEmpty()) b.append("\n        ").append(vs);
        }
        return b.toString();
    }
''' + truth[end:]

# ------------------------------------------------------------------ identity
build = replace(build, 'versionCode 26102701', 'versionCode 26102801')
build = replace(build, "versionName '9.5.129-r2544.89-kurul'", "versionName '9.5.130-r2544.98-mutabik'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
