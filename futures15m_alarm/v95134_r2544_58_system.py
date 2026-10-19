"""R2544.58: 'PC sistemini kapat' on the phone (user 19.10: Office ve APK'ya aç/kapat). The phone reaches the PC core over
the tailnet; it can stop the run and the core (POST /system/shutdown). While the core is down nothing on the PC listens
to the phone, so opening stays on the PC (desktop 'Office' shortcut or Office 'Sistem: KAPALI -> aç'). Never an order.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95134_R2544_58_SYSTEM'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95134 anchor count %d: %s' % (s.count(old), old[:100]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95132_R2544_57_LANES' not in main:
    raise SystemExit('V95134 requires V95132')
if MARKER in main:
    raise SystemExit('V95134 already applied')

client = replace(client,
    '    public static JSONObject runControl(Context c, String action, boolean liveConfirm) throws Exception {\n',
    '    // V95134_R2544_58_SYSTEM: stop the run and the PC core. In LIVE the PC needs confirm LIVE (the user confirmed the dialog).\n'
    '    public static JSONObject systemShutdown(Context c, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("source", "APK");\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        return post(c, "/system/shutdown", body, true);\n'
    '    }\n'
    '    public static JSONObject runControl(Context c, String action, boolean liveConfirm) throws Exception {\n')

main = replace(main,
    '        card.addView(row2, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n        int insert = -1;\n',
    '        card.addView(row2, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        // V95134_R2544_58_SYSTEM: PC system off (opening stays on the PC)\n'
    '        Button bSys = button("PC sistemini kapat", android.graphics.Color.rgb(87, 13, 13));\n'
    '        bSys.setOnClickListener(v -> v95134SystemOff());\n'
    '        card.addView(bSys, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        TextView sysNote = new TextView(this);\n'
    '        sysNote.setText("PC sistemi kapalıyken telefondan açılamaz: bilgisayarda masaüstündeki “Office” kısayoluna ya da Office’teki “Sistem: KAPALI → aç” düğmesine basın.");\n'
    '        sysNote.setTextColor(android.graphics.Color.rgb(160, 160, 170));\n'
    '        sysNote.setTextSize(12);\n'
    '        card.addView(sysNote);\n'
    '        int insert = -1;\n')

main = replace(main,
    '    private void v95132Done(final android.content.SharedPreferences sp, final String res) {\n',
    '    private void v95134SystemOff() {\n'
    '        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);\n'
    '        new AlertDialog.Builder(this).setTitle("PC sistemini kapat")\n'
    '            .setMessage("Önce her şey durur, sonra PC’deki BrainHub kapanır. TEST’te sanal pozisyonlar kapatılır. CANLI’da yeni gerçek işlem açılmaz; açık gerçek pozisyonlar Binance’teki stop/hedef emirleriyle korunur, 24 saat çıkışı ve başabaş taşıma sistem kapalıyken yapılmaz. Yeniden açmak için PC’de masaüstündeki Office kısayolu.")\n'
    '            .setPositiveButton("KAPAT", (d, w) -> v95132Io.execute(() -> {\n'
    '                String res;\n'
    '                try {\n'
    '                    org.json.JSONObject out = BrainHubClient.systemShutdown(this, true);\n'
    '                    res = out.optBoolean("ok", false) ? "PC sistemi kapatılıyor" : ("Yapılmadı: " + V95113PcTruth.reasons(out));\n'
    '                } catch (Throwable e) { res = "PC\'ye ulaşılamadı: " + V95113PcTruth.err(e); }\n'
    '                v95132Done(sp, res);\n'
    '            }))\n'
    '            .setNegativeButton("Vazgeç", null).show();\n'
    '    }\n\n'
    '    private void v95132Done(final android.content.SharedPreferences sp, final String res) {\n')

build = replace(build, 'versionCode 26101401', 'versionCode 26101901')
build = replace(build, "versionName '9.5.125-r2544.58-top3v2'", "versionName '9.5.126-r2544.58-system'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
