"""R2544.135 (user 09.11: "tam sistem oturmadan canlıya geçmeyeceğim, APK'da değişiklik varsa yap").
Source-generation patch after V95140. Text-only sync with the PC rules of R2544.131 / R2544.133:
  - "Durdur" (R2544.133 TEST = CANLI): a stop never closes positions in either mode; open virtual lots keep their stop/TP on the paper
    exchange. Only "TEST'i sıfırla" and the switch to LIVE close them. The PC-off dialog says the same (missed stops/targets are
    caught up from 1 m candles when the PC is back, R2544.58).
  - leverage (R2544.131): at least 10x; above it (max 20x) the committee chooses by confidence, with JEV on JEV has the last word. The
    typed leverage is the floor ("AYAR"); the input accepts 10-20.
  - each open lot shows its leverage and who chose it (kurul seçti / JEV seçti / ayar), from the PC's leverageBy (R2544.135 payload).
Android stays a PC control/telemetry client: it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95141_R2544_135_KALDIRAC'


def replace(s, old, new, n=1):
    if s.count(old) != n:
        raise SystemExit('V95141 anchor count %d (want %d): %s' % (s.count(old), n, old[:110]))
    return s.replace(old, new)


main = MAIN.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95140_R2544_129_JEVKURUL' not in main:
    raise SystemExit('V95141 requires V95140')
if MARKER in main:
    raise SystemExit('V95141 already applied')

# ------------------------------------------------------------------ "Durdur" and PC-off texts (R2544.133)
main = replace(main,
    '"Her şey durur (yeni giriş yok). TEST’te sanal pozisyonlar kapatılır; CANLI’da açık gerçek pozisyonun stop/hedef emirleri yerinde kalır. CANLI’nın otomatik yenilemesi de durur."',
    '"Her şey durur (yeni giriş yok). TEST = CANLI: açık işlemler kapatılmaz; stop/hedef emirleri yerinde kalır (TEST’te sanal borsada). Hepsini kapatmak için TEST’i sıfırla. CANLI’nın otomatik yenilemesi de durur." /* ' + MARKER + ' */')
main = replace(main,
    'sonra PC’deki BrainHub kapanır. TEST’te sanal pozisyonlar kapatılır. CANLI’da yeni gerçek işlem açılmaz;',
    'sonra PC’deki BrainHub kapanır. Açık işlemler kapatılmaz (TEST = CANLI); PC açılınca TEST’te kaçan stop/hedef 1 dk mumlardan işlenir. CANLI’da yeni gerçek işlem açılmaz;')

# ------------------------------------------------------------------ leverage input: floor 10, max 20 (R2544.131)
main = replace(main, 'eL.setHint("Kaldıraç (1–20)");', 'eL.setHint("Kaldıraç tabanı (10–20; üstünü kurul / JEV seçer)");')
main = replace(main,
    'if (lev < 1 || lev > 20) { Toast.makeText(this, "Kaldıraç 1–20 arası olmalı.", Toast.LENGTH_LONG).show(); return; }',
    'if (lev < 10 || lev > 20) { Toast.makeText(this, "Kaldıraç 10–20 arası olmalı (en az 10x; üstünü kurul / JEV seçer).", Toast.LENGTH_LONG).show(); return; }')
truth = replace(truth, 'return "Kaldıraç girin (1–20).";', 'return "Kaldıraç girin (10–20).";')
truth = replace(truth, 'if (lev < 1 || lev > 20) return "Kaldıraç 1–20 arası olmalı.";',
    'if (lev < 10 || lev > 20) return "Kaldıraç 10–20 arası olmalı (en az 10x; üstünü kurul / JEV seçer).";')
truth = replace(truth,
    '.append(v2 ? "x (üst sınır; büyüklük risk bütçesinden)" : "x (LONG etkin " + st.optInt("effectiveLong", 10) + "x)");',
    '.append("x taban (en az 10x; üstünü en çok 20x kurul güvene göre seçer, JEV açıkken son söz JEV)");')

# ------------------------------------------------------------------ each open lot: leverage and who chose it
truth = replace(truth,
    '.append(v95140LiveR(x.optJSONObject("r"))).append(v95137LotCm(x.optJSONObject("cm")));',
    '.append(v95141Lev(x)).append(v95140LiveR(x.optJSONObject("r"))).append(v95137LotCm(x.optJSONObject("cm")));', n=2)
helper = '''
    // V95141_R2544_135_KALDIRAC: the lot's leverage and who chose it (PC leverageBy: KURUL / JEV / AYAR)
    static String v95141Lev(JSONObject x) {
        if (x == null) return "";
        int lev = x.optInt("leverage", 0);
        if (lev <= 0) return "";
        String by = x.optString("leverageBy", "");
        String who = "KURUL".equals(by) ? "kurul seçti" : "JEV".equals(by) ? "JEV seçti" : "AYAR".equals(by) ? "ayar" : "";
        return "\\n     kaldıraç " + lev + "x" + (who.isEmpty() ? "" : " (" + who + ")");
    }
'''
idx = truth.rfind('}')
truth = truth[:idx] + helper + truth[idx:]

build = replace(build, 'versionCode 26110401', 'versionCode 26110901')
build = replace(build, "versionName '9.5.132-r2544.129-jevkurul'", "versionName '9.5.133-r2544.135-kaldirac'")

MAIN.write_text(main, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
