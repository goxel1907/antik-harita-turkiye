"""R2544.147 (user 10.11: "kritik sistem anlatı hataları varsa düzelt ... uygulama üzerinden kapatmak istediğimde direk kapatabilecek miyim").
Source-generation patch after V95143.
  - OTO dialog: the "PC LIVE oto yürütücü" box showed the PHONE's old flag (checked) while the PC's normal system was off, so saving
    only max 1 -> 2 turned the normal system ON in LIVE (10.11 21:57). The box now shows the PC's real normal-system state and says
    what it does; saving without touching it changes nothing on the PC (the PC also ignores an ON from this dialog from R2544.147).
  - İşlem Merkezi: a running TEST no longer reads "LIVE • AÇIK".
  - the PC status read waits 20 s instead of 8 s (in LIVE the answer also reads the real Binance balance), so the lanes card and its
    KAPAT buttons stay fresh ("PC durumu 2406 sn önceki" while a real lot was open, 10.11 22:39).
Android stays a PC control/telemetry client: it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
CARD = JAVA / 'AutoDecisionCard.java'  # the İşlem Merkezi summary lives here (V95123), not in MainActivity
BUILD = APP / 'app/build.gradle'
MARKER = 'V95144_R2544_147_ETIKET'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95144 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
card = CARD.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95143_R2544_146_ANAHTAR' not in main:
    raise SystemExit('V95144 requires V95143')
if MARKER in main:
    raise SystemExit('V95144 already applied')

# ------------------------------------------------------------------ OTO dialog box = the PC's real normal-system state
main = replace(main,
    'en.setChecked(sp.getBoolean("v9576_auto_enabled",false));en.setEnabled(BrainHubClient.configured(this));en.setText("PC LIVE oto yürütücü (PC arm ayrıca gerekli)");',
    'en.setChecked(V95113PcTruth.v95144NormalOn(sp,sp.getBoolean("v9576_auto_enabled",false)));en.setEnabled(BrainHubClient.configured(this));'
    'en.setText("Normal sistem (JEV) açık • PC\'deki durum (yalnız işareti değiştirirsen açar/kapatır; açmak için Hatlar kartını kullan)"); // V95144_R2544_147_ETIKET')

# ------------------------------------------------------------------ İşlem Merkezi: TEST is not LIVE
card = replace(card,
    '        if(pc==V95113PcTruth.ARMED)b.append("\\nLIVE • AÇIK");\n',
    '        if(pc==V95113PcTruth.ARMED)b.append("TEST".equals(V95113PcTruth.v95143Mode(sp))?"\\nTEST • ÇALIŞIYOR (CANLI KAPALI)":"\\nLIVE • AÇIK"); // V95144\n')

# ------------------------------------------------------------------ PC status read: 20 s
client = replace(client,
    'conn.setReadTimeout(path.equals("/health") || path.startsWith("/live/status") ? 8000 : 22000);',
    'conn.setReadTimeout(path.equals("/health") ? 8000 : path.startsWith("/live/status") ? 20000 : 22000); // V95144: LIVE status also reads Binance')

helper = r'''
    // V95144_R2544_147_ETIKET: the PC's normal-system (JEV lane) state from the last lane status; the phone flag only without PC data
    static boolean v95144NormalOn(SharedPreferences sp, boolean fallback) {
        if (sp == null) return fallback;
        JSONObject lanes = json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        JSONObject n = lanes == null ? null : lanes.optJSONObject("normal");
        return n == null ? fallback : n.optBoolean("selected", false);
    }
'''
idx = truth.rfind('}')
truth = truth[:idx] + helper + truth[idx:]

build = replace(build, 'versionCode 26111002', 'versionCode 26111003')
build = replace(build, "versionName '9.5.135-r2544.146-anahtar'", "versionName '9.5.136-r2544.147-etiket'")

MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
CARD.write_text(card, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
