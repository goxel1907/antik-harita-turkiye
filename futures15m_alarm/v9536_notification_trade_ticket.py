from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.36 missing required file: ' + str(p))

# ---------------------------------------------------------------------------
# 1) Critical trade notification must return to THIS app, not Binance/browser.
#    Both normal notification tap and Android full-screen alarm intent carry the
#    signal symbol and request the in-app manual order ticket.
# ---------------------------------------------------------------------------
m = MON.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.36', m)

old_pi = 'PendingIntent binancePi=openBinanceIntent(symbol,400+Math.abs(symbol.hashCode()%10000)); PendingIntent appPi=openAppIntent(40);'
new_pi = 'PendingIntent tradePi=v9536OpenTradeTicketIntent(symbol,500+Math.abs(symbol.hashCode()%10000));'
if old_pi in m:
    m = m.replace(old_pi, new_pi, 1)
elif 'v9536OpenTradeTicketIntent(symbol' not in m:
    raise SystemExit('v9.5.36 urgent PendingIntent anchor missing')

old_content = '.setContentIntent(binancePi).setFullScreenIntent(appPi,true).setAutoCancel(true).setPriority(Notification.PRIORITY_MAX)'
new_content = '.setContentIntent(tradePi).setFullScreenIntent(tradePi,true).setAutoCancel(true).setPriority(Notification.PRIORITY_MAX)'
if old_content in m:
    m = m.replace(old_content, new_content, 1)
elif '.setContentIntent(tradePi).setFullScreenIntent(tradePi,true)' not in m:
    raise SystemExit('v9.5.36 urgent content intent anchor missing')

m = m.replace('Dokun → Binance Futures\'ta "+symbol+" aç',
              'Dokun → uygulamada EMİR TASLAĞI aç')
m = m.replace('Dokun → Binance Futures\'ta '+ '"+symbol+"' +' aç',
              'Dokun → uygulamada EMİR TASLAĞI aç')
# Exact source form in older MonitorService builds.
m = m.replace('Dokun → Binance Futures\'ta "+symbol+" aç', 'Dokun → uygulamada EMİR TASLAĞI aç')

if 'private PendingIntent v9536OpenTradeTicketIntent(' not in m:
    anchor = '    private PendingIntent openAppIntent(int requestCode)'
    idx = m.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.36 openAppIntent anchor missing')
    helper = r'''    // V9536_NOTIFICATION_TRADE_TICKET
    private PendingIntent v9536OpenTradeTicketIntent(String symbol, int requestCode) {
        Intent open = new Intent(this, MainActivity.class);
        open.putExtra("v9536_open_trade_ticket", true);
        open.putExtra("v9536_symbol", symbol == null ? "" : symbol.trim().toUpperCase(java.util.Locale.US));
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, requestCode, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

'''
    m = m[:idx] + helper + m[idx:]

MON.write_text(m)

# ---------------------------------------------------------------------------
# 2) MainActivity consumes the notification intent after UI creation and opens
#    the existing EMİR TASLAĞI / EMRİ HAZIRLA dialog for the active signal.
#    onNewIntent handles taps while the app is already open.
# ---------------------------------------------------------------------------
s = MAIN.read_text()
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.36', s)
s = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.36  •  MANUEL PRO', s)

create_anchor = '        setContentView(buildUi());'
if 'v9536HandleNotificationIntent(getIntent());' not in s:
    if create_anchor not in s:
        raise SystemExit('v9.5.36 MainActivity setContentView anchor missing')
    s = s.replace(create_anchor,
                  create_anchor + '\n        v9536HandleNotificationIntent(getIntent());', 1)

if 'V9536_NOTIFICATION_TRADE_TICKET_MAIN' not in s:
    resume_anchor = '    @Override\n    protected void onResume() {'
    idx = s.find(resume_anchor)
    if idx < 0:
        raise SystemExit('v9.5.36 onResume anchor missing')
    on_new = r'''    // V9536_NOTIFICATION_TRADE_TICKET_MAIN
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        v9536HandleNotificationIntent(intent);
    }

'''
    s = s[:idx] + on_new + s[idx:]

if 'private void v9536HandleNotificationIntent(' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.36 MainActivity closing brace missing')
    helper = r'''

    private void v9536HandleNotificationIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("v9536_open_trade_ticket", false)) return;
        final String symbol = intent.getStringExtra("v9536_symbol");
        // Consume once so rotation/resume does not reopen the order dialog.
        intent.removeExtra("v9536_open_trade_ticket");
        intent.removeExtra("v9536_symbol");
        if (symbol == null || symbol.trim().isEmpty()) return;

        // Post after setContentView/onNewIntent so AlertDialog gets a fully
        // attached Activity window. The existing ticket still enforces active
        // signal, live-price deviation and final user confirmation safeguards.
        android.view.View decor = getWindow() == null ? null : getWindow().getDecorView();
        Runnable openTicket = () -> {
            try {
                String sym = symbol.trim().toUpperCase(java.util.Locale.US);
                android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
                if (!sp.getBoolean("v9518_signal_active_" + sym, false)) {
                    android.widget.Toast.makeText(this,
                            "Sinyal artık aktif değil; emir taslağı açılmadı.",
                            android.widget.Toast.LENGTH_LONG).show();
                    return;
                }
                v9522ShowTradeTicket(sym);
            } catch (Throwable e) {
                android.widget.Toast.makeText(this,
                        "Emir taslağı açılamadı: " + (e.getMessage() == null ? "bilinmeyen hata" : e.getMessage()),
                        android.widget.Toast.LENGTH_LONG).show();
            }
        };
        if (decor != null) decor.post(openTicket); else runOnUiThread(openTicket);
    }
'''
    s = s[:pos] + helper + '\n' + s[pos:]

MAIN.write_text(s)

# ---------------------------------------------------------------------------
# 3) Version bump.
# ---------------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 26091207', b, count=1)
b = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.36'", b, count=1)
BUILD.write_text(b)

# Fail-fast sanity.
main = MAIN.read_text(); mon = MON.read_text(); build = BUILD.read_text()
checks = {
    'urgent tap opens app ticket': 'v9536OpenTradeTicketIntent(symbol' in mon,
    'no urgent Binance content intent': '.setContentIntent(binancePi)' not in mon,
    'full screen also opens ticket': '.setFullScreenIntent(tradePi,true)' in mon,
    'notification extras': 'v9536_open_trade_ticket' in mon and 'v9536_symbol' in mon,
    'main onCreate handler': 'v9536HandleNotificationIntent(getIntent());' in main,
    'main onNewIntent handler': 'protected void onNewIntent(Intent intent)' in main,
    'order dialog handoff': 'v9522ShowTradeTicket(sym);' in main,
    'active signal guard retained': 'v9518_signal_active_' in main,
    'version code': 'versionCode 26091207' in build,
    'version name': "versionName '9.5.36'" in build,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
if not all(checks.values()):
    raise SystemExit('v9.5.36 sanity failed: ' + ', '.join(k for k,v in checks.items() if not v))
print('v9.5.36 OK: critical notification tap/full-screen returns to app and opens the active-signal EMİR TASLAĞI directly.')
