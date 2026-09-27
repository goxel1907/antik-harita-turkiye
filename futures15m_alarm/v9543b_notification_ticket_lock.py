from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.43b missing required generated file: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
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
        elif in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
        elif in_chr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                in_str = True
            elif c == "'":
                in_chr = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)


# ---------------------------------------------------------------------------
# v9.5.43b PRIORITY FIX
# Notification tap must be a strictly in-app, signal-bound handoff.
#
# Bug seen on v9.5.42:
#   signal notification -> tap -> signal disappears / Binance order screen
#   flashes and vanishes.
#
# Root protections in this patch:
# - notification route NEVER falls back to external Binance when active state
#   changes during the tap/UI race;
# - exact signal timestamp snapshot must still match the current signal;
# - v9.5.41 repair/persistence runs before the ticket is opened;
# - notification handoff stores an immutable diagnostic snapshot of the signal;
# - external Binance fallback remains available for normal coin-card taps only;
# - no order is sent automatically and no STOP/TP lifecycle rule is weakened.
# ---------------------------------------------------------------------------
main = MAIN.read_text()
mon = MON.read_text()

required_main = [
    'private void v9536HandleNotificationIntent(Intent intent)',
    'private void v9541RepairNotificationSignal(',
    'private void v9522ShowTradeTicket(String symbol)',
]
for marker in required_main:
    if marker not in main:
        raise SystemExit('v9.5.43b required MainActivity marker missing: ' + marker)

if 'private PendingIntent v9536OpenTradeTicketIntent(' not in mon:
    raise SystemExit('v9.5.43b notification PendingIntent helper missing')
if 'v9541_notif_signal_ts_' not in mon:
    raise SystemExit('v9.5.43b v9.5.41 signal-bound notification snapshot missing')

# 1) Replace the notification handler with a strict, exact-signal handoff.
b = method_bounds(main, '    private void v9536HandleNotificationIntent(Intent intent)')
if not b:
    raise SystemExit('v9.5.43b MainActivity notification handler bounds missing')
a, _, e = b
new_handler = r'''    // V9543B_NOTIFICATION_TICKET_LOCK
    private void v9536HandleNotificationIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("v9536_open_trade_ticket", false)) return;

        final String symbol = intent.getStringExtra("v9536_symbol");
        final long expectedSignalTs = intent.getLongExtra("v9541_signal_ts", 0L);
        final String expectedSide = intent.getStringExtra("v9541_signal_side");
        final long notificationAt = intent.getLongExtra("v9541_notification_at", 0L);

        // Consume navigation extras exactly once. This prevents resume/rotation
        // from relaunching the same handoff while keeping the signal itself intact.
        intent.removeExtra("v9536_open_trade_ticket");
        intent.removeExtra("v9536_symbol");
        intent.removeExtra("v9541_signal_ts");
        intent.removeExtra("v9541_signal_side");
        intent.removeExtra("v9541_notification_at");

        if (symbol == null || symbol.trim().isEmpty()) return;

        android.view.View decor = getWindow() == null ? null : getWindow().getDecorView();
        Runnable openTicket = () -> {
            String sym = symbol.trim().toUpperCase(java.util.Locale.US);
            try {
                // v9.5.41 can repair only a non-terminal accidental active-flag loss.
                v9541RepairNotificationSignal(sym, expectedSignalTs, notificationAt);

                android.content.SharedPreferences sp =
                        getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
                long actualTs = sp.getLong("v9518_signal_time_" + sym, 0L);
                String actualSide = sp.getString("v9518_signal_side_" + sym, "");
                boolean active = sp.getBoolean("v9518_signal_active_" + sym, false);
                String state = sp.getString("v9518_signal_state_" + sym, "");

                // Old/stale notification must never open another signal or Binance.
                if (expectedSignalTs > 0L && actualTs > 0L && expectedSignalTs != actualTs) {
                    android.widget.Toast.makeText(this,
                            "Bu bildirim eski bir sinyale ait; güncel sinyal değiştirilmedi.",
                            android.widget.Toast.LENGTH_LONG).show();
                    try { v9527RefreshTopText(); } catch (Throwable ignored) {}
                    return;
                }
                if (expectedSide != null && !expectedSide.trim().isEmpty() &&
                        actualSide != null && !actualSide.trim().isEmpty() &&
                        !expectedSide.trim().equalsIgnoreCase(actualSide.trim())) {
                    android.widget.Toast.makeText(this,
                            "Bildirim yönü güncel sinyalle eşleşmiyor; emir taslağı açılmadı.",
                            android.widget.Toast.LENGTH_LONG).show();
                    return;
                }

                // Keep an immutable handoff snapshot for diagnostics/UI recovery.
                android.content.SharedPreferences.Editor snap = sp.edit()
                        .putString("v9543b_ticket_symbol", sym)
                        .putLong("v9543b_ticket_signal_ts", actualTs > 0L ? actualTs : expectedSignalTs)
                        .putString("v9543b_ticket_side", actualSide == null ? "" : actualSide)
                        .putString("v9543b_ticket_state", state == null ? "" : state)
                        .putLong("v9543b_ticket_opened_at", System.currentTimeMillis())
                        .putString("v9543b_ticket_entry", sp.getString("v9518_signal_price_" + sym, ""))
                        .putString("v9543b_ticket_stop", sp.getString("v9518_signal_stop_" + sym, ""))
                        .putString("v9543b_ticket_tp1", sp.getString("v9518_signal_tp1_" + sym, ""))
                        .putString("v9543b_ticket_tp2", sp.getString("v9518_signal_tp2_" + sym, ""))
                        .putString("v9543b_ticket_tp3", sp.getString("v9518_signal_tp3_" + sym, ""));
                snap.apply();

                if (!active) {
                    // CRITICAL: notification taps are NEVER allowed to take the
                    // old v9522ShowTradeTicket -> external Binance fallback path.
                    android.widget.Toast.makeText(this,
                            state == null || state.trim().isEmpty()
                                    ? "Sinyal aktif değil; uygulama dışına çıkılmadı."
                                    : "Sinyal durumu: " + state + " • uygulama dışına çıkılmadı.",
                            android.widget.Toast.LENGTH_LONG).show();
                    try { v9527RefreshTopText(); } catch (Throwable ignored) {}
                    return;
                }

                // Short-lived strict flag closes the tiny race between this check
                // and v9522ShowTradeTicket()'s own active-state check.
                sp.edit()
                        .putBoolean("v9543b_strict_ticket_" + sym, true)
                        .putLong("v9543b_strict_ticket_at_" + sym, System.currentTimeMillis())
                        .putLong("v9543b_strict_ticket_ts_" + sym,
                                actualTs > 0L ? actualTs : expectedSignalTs)
                        .apply();
                try {
                    v9522ShowTradeTicket(sym);
                } finally {
                    sp.edit()
                            .remove("v9543b_strict_ticket_" + sym)
                            .remove("v9543b_strict_ticket_at_" + sym)
                            .remove("v9543b_strict_ticket_ts_" + sym)
                            .apply();
                }

                try { v9527RefreshTopText(); } catch (Throwable ignored) {}
                try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
                try { v9542EnsureAttentionCard(); } catch (Throwable ignored) {}
            } catch (Throwable ex) {
                android.widget.Toast.makeText(this,
                        "Emir taslağı açılamadı; sinyal korunuyor: " +
                                (ex.getMessage() == null ? "bilinmeyen hata" : ex.getMessage()),
                        android.widget.Toast.LENGTH_LONG).show();
            }
        };
        if (decor != null) decor.post(openTicket); else runOnUiThread(openTicket);
    }'''
main = main[:a] + new_handler + main[e:]

# 2) Harden v9522ShowTradeTicket itself. Normal coin-card taps retain the old
# external Binance fallback, but notification handoff is strict in-app only.
b = method_bounds(main, '    private void v9522ShowTradeTicket(String symbol)')
if not b:
    raise SystemExit('v9.5.43b v9522ShowTradeTicket bounds missing')
a, _, e = b
ticket = main[a:e]
old_patterns = [
    r'''if \(!sp\.getBoolean\("v9518_signal_active_" \+ symbol, false\)\) \{\s*v9522OpenExactFutures\(symbol\);\s*return;\s*\}''',
    r'''if\(!sp\.getBoolean\("v9518_signal_active_"\+symbol,false\)\)\{\s*v9522OpenExactFutures\(symbol\);\s*return;\s*\}''',
]
replacement = r'''if (!sp.getBoolean("v9518_signal_active_" + symbol, false)) {
            boolean strict = sp.getBoolean("v9543b_strict_ticket_" + symbol, false);
            long strictAt = sp.getLong("v9543b_strict_ticket_at_" + symbol, 0L);
            if (strict && strictAt > 0L && System.currentTimeMillis() - strictAt <= 15000L) {
                // Notification handoff must stay inside this app even if the
                // active flag changes between the tap and dialog creation.
                String state = sp.getString("v9518_signal_state_" + symbol, "");
                Toast.makeText(this,
                        state == null || state.trim().isEmpty()
                                ? "Sinyal aktif değil; Binance otomatik açılmadı."
                                : "Sinyal durumu: " + state + " • Binance otomatik açılmadı.",
                        Toast.LENGTH_LONG).show();
                return;
            }
            // Existing behavior for an explicit normal coin-card tap.
            v9522OpenExactFutures(symbol);
            return;
        }'''
changed = False
for pat in old_patterns:
    ticket2, n = re.subn(pat, replacement, ticket, count=1, flags=re.S)
    if n == 1:
        ticket = ticket2
        changed = True
        break
if not changed:
    raise SystemExit('v9.5.43b v9522ShowTradeTicket inactive fallback anchor missing')
main = main[:a] + ticket + main[e:]

# Keep visible version at v9.5.43. This is a bugfix inside the same release.
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
              '15m Futures Alarm PRO v9.5.43', main)
main = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
              'v9.5.43  •  MANUEL PRO', main)
MAIN.write_text(main)

mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
             '15m Futures Alarm PRO v9.5.43', mon)
MON.write_text(mon)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091306', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.43'", bf, count=1)
BUILD.write_text(bf)

# ---------------------------------------------------------------------------
# Fail-fast regression contract.
# ---------------------------------------------------------------------------
main = MAIN.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

hb = method_bounds(main, '    private void v9536HandleNotificationIntent(Intent intent)')
handler = main[hb[0]:hb[2]] if hb else ''
tb = method_bounds(main, '    private void v9522ShowTradeTicket(String symbol)')
ticket = main[tb[0]:tb[2]] if tb else ''
pb = method_bounds(mon, '    private PendingIntent v9536OpenTradeTicketIntent(')
pi = mon[pb[0]:pb[2]] if pb else ''

checks = {
    'v9541 signal persistence retained': 'v9541RepairNotificationSignal' in main and 'v9541_notif_signal_ts_' in mon,
    'notification exact signal timestamp enforced': 'expectedSignalTs' in handler and 'expectedSignalTs != actualTs' in handler,
    'notification side snapshot enforced': 'expectedSide' in handler and 'equalsIgnoreCase(actualSide.trim())' in handler,
    'notification strict in-app lock': 'v9543b_strict_ticket_' in handler and 'v9543b_strict_ticket_' in ticket,
    'notification inactive state never opens external Binance': 'uygulama dışına çıkılmadı' in handler,
    'trade ticket race fallback blocked': 'Binance otomatik açılmadı' in ticket,
    'normal explicit Binance fallback retained': 'v9522OpenExactFutures(symbol);' in ticket,
    'pending intent remains non destructive': 'FLAG_ACTIVITY_REORDER_TO_FRONT' in pi and 'FLAG_ACTIVITY_CLEAR_TOP' not in pi,
    'pending intent remains exact-signal bound': 'OPEN_TRADE_TICKET.' in pi and 'v9541_signal_ts' in pi,
    'signal lifecycle guard retained': 'V9541_SIGNAL_LIFECYCLE_GUARD' in mon,
    'no automatic order in notification handler': '/fapi/v1/order' not in handler,
    'version code': 'versionCode 26091306' in bf,
    'version name': "versionName '9.5.43'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.43b sanity failed: ' + ', '.join(bad))

print('v9.5.43b OK: signal notification tap is exact-signal, persistence-safe and strictly in-app; external Binance cannot flash/open from the notification race.')
