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
    line_comment = False
    block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif quote:
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
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                quote = True
            elif c == "'":
                char_quote = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)

# ---------------------------------------------------------------------------
# 1) Critical trade notification must return to THIS app, not Binance/browser.
#    Patch the CURRENT composed MonitorService method structurally instead of
#    depending on an old exact one-line PendingIntent string.
# ---------------------------------------------------------------------------
m = MON.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.36', m)

bounds = method_bounds(m, '    private void sendUrgent(String symbol, String direction, String detail)')
if not bounds:
    raise SystemExit('v9.5.36 sendUrgent method missing')
a0, brace, e0 = bounds
body = m[a0:e0]

if 'v9536OpenTradeTicketIntent(symbol' not in body:
    p = body.find('{') + 1
    body = body[:p] + ('\n        // V9536_NOTIFICATION_TRADE_TICKET: notification tap stays in this app.\n'
                      '        PendingIntent tradePi = v9536OpenTradeTicketIntent(symbol, '
                      '500 + Math.abs(symbol.hashCode() % 10000));\n') + body[p:]

# Whatever older variable names are currently used (binancePi/appPi/etc.), the
# critical notification content tap and full-screen route both become tradePi.
body, n_content = re.subn(r'\.setContentIntent\s*\(\s*[^)]+\s*\)', '.setContentIntent(tradePi)', body, count=1)
body, n_full = re.subn(r'\.setFullScreenIntent\s*\(\s*[^,]+\s*,\s*true\s*\)', '.setFullScreenIntent(tradePi,true)', body, count=1)
if n_content != 1:
    raise SystemExit('v9.5.36 sendUrgent content intent not found')
if n_full != 1:
    raise SystemExit('v9.5.36 sendUrgent full-screen intent not found')

# Keep the notification copy consistent with the actual action. Do not fail the
# build if an older wording is formatted differently.
body = re.sub(r'Dokun\s*[→>-]+\s*Binance Futures[^"\\n]*',
              'Dokun → uygulamada EMİR TASLAĞI aç', body)

m = m[:a0] + body + m[e0:]

if 'private PendingIntent v9536OpenTradeTicketIntent(' not in m:
    anchors = [
        '    private PendingIntent openAppIntent(int requestCode)',
        '    private Notification buildServiceNotification(',
    ]
    idx = -1
    for anchor in anchors:
        idx = m.find(anchor)
        if idx >= 0:
            break
    if idx < 0:
        raise SystemExit('v9.5.36 PendingIntent helper insertion anchor missing')
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
    'urgent content uses trade ticket': '.setContentIntent(tradePi)' in mon,
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
