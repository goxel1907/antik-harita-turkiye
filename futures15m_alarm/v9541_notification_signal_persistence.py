from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.41 missing required generated file: ' + str(p))

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
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

# ---------------------------------------------------------------------------
# v9.5.41
# Notification taps must be observational/navigation-only. They must never
# invalidate an active virtual LONG/SHORT signal. Also harden SHORT lifecycle
# tracking against malformed STOP/TP geometry causing an immediate self-close.
# ---------------------------------------------------------------------------

# 1) MonitorService: unique signal-bound PendingIntent, non-destructive task
# routing, and signal timestamp snapshot.
mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
             '15m Futures Alarm PRO v9.5.41', mon)

b = method_bounds(mon, '    private PendingIntent v9536OpenTradeTicketIntent(')
if not b:
    raise SystemExit('v9.5.41 notification PendingIntent helper missing')
a, _, e = b
new_pi = r'''    // V9541_NOTIFICATION_SIGNAL_PERSISTENCE
    private PendingIntent v9536OpenTradeTicketIntent(String symbol, int requestCode) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(java.util.Locale.US);
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        long signalTs = sp.getLong("v9518_signal_time_" + sym, 0L);
        String signalSide = sp.getString("v9518_signal_side_" + sym, "");
        long notificationAt = System.currentTimeMillis();

        if (signalTs > 0L) {
            sp.edit()
                    .putLong("v9541_notif_signal_ts_" + sym, signalTs)
                    .putString("v9541_notif_signal_side_" + sym, signalSide == null ? "" : signalSide)
                    .putLong("v9541_notif_created_" + sym, notificationAt)
                    .apply();
        }

        Intent open = new Intent(this, MainActivity.class);
        // PendingIntent identity is tied to this exact signal. Old notifications
        // cannot silently mutate into a newer LONG/SHORT signal for the same coin.
        open.setAction("com.futuresalarm.app.OPEN_TRADE_TICKET." + sym + "." + signalTs);
        open.putExtra("v9536_open_trade_ticket", true);
        open.putExtra("v9536_symbol", sym);
        open.putExtra("v9541_signal_ts", signalTs);
        open.putExtra("v9541_signal_side", signalSide == null ? "" : signalSide);
        open.putExtra("v9541_notification_at", notificationAt);

        // Do not CLEAR_TOP: a notification tap is navigation, not a UI/state reset.
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, requestCode, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }'''
mon = mon[:a] + new_pi + mon[e:]

# 2) Virtual signal lifecycle guard. SHORT requires STOP above entry and targets
# below entry; LONG requires the inverse. If plan parsing produced impossible
# geometry, keep the signal visible/active and flag it instead of instantly
# marking STOP/TP3.
b = method_bounds(mon, '    private void v9518UpdateSignalResult(String symbol,double price)')
if not b:
    raise SystemExit('v9.5.41 signal result method missing')
a, _, e = b
new_track = r'''    // V9541_SIGNAL_LIFECYCLE_GUARD
    private void v9518UpdateSignalResult(String symbol,double price) {
        if(!prefs.getBoolean("v9518_signal_active_"+symbol,false)||Double.isNaN(price)||price<=0) return;

        long signalTs=prefs.getLong("v9518_signal_time_"+symbol,0L);
        // Avoid a same-cycle self-close immediately after the alarm is created.
        if(signalTs>0L && System.currentTimeMillis()-signalTs<4000L) return;

        String side=prefs.getString("v9518_signal_side_"+symbol,"LONG");
        boolean lng="LONG".equals(side);
        double entry=v9518D("v9518_signal_price_"+symbol);
        double stop=v9518D("v9518_signal_stop_"+symbol);
        double t1=v9518D("v9518_signal_tp1_"+symbol);
        double t2=v9518D("v9518_signal_tp2_"+symbol);
        double t3=v9518D("v9518_signal_tp3_"+symbol);
        if(Double.isNaN(stop)||Double.isNaN(t3)) return;

        if(!Double.isNaN(entry) && entry>0) {
            boolean stopOk = lng ? stop < entry : stop > entry;
            boolean tp1Ok = Double.isNaN(t1) || (lng ? t1 > entry : t1 < entry);
            boolean tp2Ok = Double.isNaN(t2) || (lng ? t2 > entry : t2 < entry);
            boolean tp3Ok = lng ? t3 > entry : t3 < entry;
            if(!(stopOk && tp1Ok && tp2Ok && tp3Ok)) {
                String why="side="+side+", entry="+entry+", stop="+stop+
                        ", tp1="+t1+", tp2="+t2+", tp3="+t3;
                prefs.edit()
                        .putString("v9518_signal_state_"+symbol,
                                "AÇIK - SEVİYE GEOMETRİSİ KORUMASI")
                        .putString("v9541_signal_guard_"+symbol,why)
                        .putLong("v9541_signal_guard_at_"+symbol,System.currentTimeMillis())
                        .apply();
                return;
            }
        }

        if((lng&&price<=stop)||(!lng&&price>=stop)){
            prefs.edit().putString("v9541_last_terminal_"+symbol,
                    "STOP @ "+price).putLong("v9541_last_terminal_at_"+symbol,System.currentTimeMillis()).apply();
            v9518Finish(symbol,stop,"ZARAR İLE KAPANDI - STOP");return;
        }
        if((lng&&price>=t3)||(!lng&&price<=t3)){
            prefs.edit().putString("v9541_last_terminal_"+symbol,
                    "TP3 @ "+price).putLong("v9541_last_terminal_at_"+symbol,System.currentTimeMillis()).apply();
            v9518Finish(symbol,t3,"KÂR İLE KAPANDI - TP3");return;
        }

        int best=prefs.getInt("v9518_signal_best_"+symbol,0),next=best;
        if(!Double.isNaN(t2)&&((lng&&price>=t2)||(!lng&&price<=t2))) next=Math.max(next,2);
        else if(!Double.isNaN(t1)&&((lng&&price>=t1)||(!lng&&price<=t1))) next=Math.max(next,1);
        if(next!=best) prefs.edit().putInt("v9518_signal_best_"+symbol,next)
                .putString("v9518_signal_state_"+symbol,
                        next>=2?"AÇIK - TP2 GÖRÜLDÜ, TP3/STOP TAKİBİNDE":
                                "AÇIK - TP1 GÖRÜLDÜ, TP2/TP3/STOP TAKİBİNDE").apply();
    }'''
mon = mon[:a] + new_track + mon[e:]
MON.write_text(mon)

# 3) MainActivity: notification tap may repair ONLY the accidental case where
# the same recent signal still says AÇIK but its active boolean was lost.
# Genuine STOP/TP/manual terminal state is never resurrected.
main = MAIN.read_text()
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
              '15m Futures Alarm PRO v9.5.41', main)
main = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
              'v9.5.41  •  MANUEL PRO', main)

b = method_bounds(main, '    private void v9536HandleNotificationIntent(Intent intent)')
if not b:
    raise SystemExit('v9.5.41 MainActivity notification handler missing')
a, _, e = b
new_handler = r'''    // V9541_NOTIFICATION_TAP_GUARD
    private void v9536HandleNotificationIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("v9536_open_trade_ticket", false)) return;

        final String symbol = intent.getStringExtra("v9536_symbol");
        final long signalTs = intent.getLongExtra("v9541_signal_ts", 0L);
        final long notificationAt = intent.getLongExtra("v9541_notification_at", 0L);

        // Consume navigation extras only; never touch the signal's SharedPreferences.
        intent.removeExtra("v9536_open_trade_ticket");
        intent.removeExtra("v9536_symbol");
        intent.removeExtra("v9541_signal_ts");
        intent.removeExtra("v9541_signal_side");
        intent.removeExtra("v9541_notification_at");

        if (symbol == null || symbol.trim().isEmpty()) return;

        android.view.View decor = getWindow() == null ? null : getWindow().getDecorView();
        Runnable openTicket = () -> {
            try {
                String sym = symbol.trim().toUpperCase(java.util.Locale.US);
                v9541RepairNotificationSignal(sym, signalTs, notificationAt);

                android.content.SharedPreferences sp =
                        getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
                if (!sp.getBoolean("v9518_signal_active_" + sym, false)) {
                    String state=sp.getString("v9518_signal_state_" + sym, "");
                    android.widget.Toast.makeText(this,
                            state==null||state.trim().isEmpty()
                                    ? "Sinyal aktif değil; emir taslağı açılmadı."
                                    : "Sinyal durumu: " + state,
                            android.widget.Toast.LENGTH_LONG).show();
                    try { v9527RefreshTopText(); } catch (Throwable ignored) {}
                    return;
                }

                // Opening the ticket is read-only until the user explicitly confirms.
                v9522ShowTradeTicket(sym);
                try { v9527RefreshTopText(); } catch (Throwable ignored) {}
                try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
            } catch (Throwable ex) {
                android.widget.Toast.makeText(this,
                        "Emir taslağı açılamadı: " +
                                (ex.getMessage() == null ? "bilinmeyen hata" : ex.getMessage()),
                        android.widget.Toast.LENGTH_LONG).show();
            }
        };
        if (decor != null) decor.post(openTicket); else runOnUiThread(openTicket);
    }'''
main = main[:a] + new_handler + main[e:]

if 'private void v9541RepairNotificationSignal(' not in main:
    idx = main.rfind('}')
    if idx < 0:
        raise SystemExit('v9.5.41 MainActivity closing brace missing')
    helper = r'''

    // Repairs only an accidental active-flag loss caused during notification/UI
    // handoff. A terminal signal is never resurrected.
    private void v9541RepairNotificationSignal(String symbol,long expectedSignalTs,long notificationAt) {
        if(symbol==null||symbol.trim().isEmpty())return;
        String sym=symbol.trim().toUpperCase(java.util.Locale.US);
        android.content.SharedPreferences sp =
                getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);

        long actualTs=sp.getLong("v9518_signal_time_"+sym,0L);
        if(actualTs<=0L)return;
        if(expectedSignalTs>0L && actualTs!=expectedSignalTs)return;

        long snapTs=sp.getLong("v9541_notif_signal_ts_"+sym,0L);
        if(expectedSignalTs>0L && snapTs>0L && snapTs!=actualTs)return;

        if(sp.getBoolean("v9518_signal_active_"+sym,false))return;

        long now=System.currentTimeMillis();
        long created=notificationAt>0L?notificationAt:
                sp.getLong("v9541_notif_created_"+sym,0L);
        if(created>0L && now-created>5L*60L*1000L)return;

        long end=sp.getLong("v9518_signal_end_"+sym,0L);
        String state=sp.getString("v9518_signal_state_"+sym,"");
        String u=state==null?"":state.toUpperCase(java.util.Locale.ROOT);

        boolean terminal=end>0L || u.contains("KAPANDI") || u.startsWith("KÂR") ||
                u.startsWith("KAR") || u.startsWith("ZARAR") ||
                u.contains("STOP İLE") || u.contains("TP3 İLE") ||
                u.contains("İPTAL") || u.contains("IPTAL") || u.contains("GEÇERSİZ");
        if(terminal)return;

        // Restore only when the persisted textual state still says the signal
        // is open. This prevents old notifications from reviving a manually
        // closed/invalidated signal.
        if(!u.isEmpty() && !u.startsWith("AÇIK"))return;

        android.content.SharedPreferences.Editor ed=sp.edit()
                .putBoolean("v9518_signal_active_"+sym,true)
                .putLong("v9541_repaired_at_"+sym,now);
        if(u.isEmpty())
            ed.putString("v9518_signal_state_"+sym,"AÇIK - HEDEF/STOP TAKİBİNDE");
        ed.apply();
    }
'''
    main = main[:idx] + helper + '\n' + main[idx:]

MAIN.write_text(main)

# 4) Consistent version strings.
for p in (ANALYSIS, RADAR, ENGINE):
    if not p.exists():
        continue
    s=p.read_text()
    s=re.sub(r'v9\.5(?:\.\d+)*','v9.5.41',s)
    s=re.sub(r'V9\.5(?:\.\d+)*','V9.5.41',s)
    p.write_text(s)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091304',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.41'",bf,count=1)
BUILD.write_text(bf)

# 5) Fail-fast regression checks.
main=MAIN.read_text(); mon=MON.read_text(); build=BUILD.read_text()
pi_bounds=method_bounds(mon,'    private PendingIntent v9536OpenTradeTicketIntent(')
pi_body=mon[pi_bounds[0]:pi_bounds[2]] if pi_bounds else ''
checks={
    'unique notification signal identity':
        'OPEN_TRADE_TICKET.' in mon and 'v9541_signal_ts' in mon,
    'notification no clear top':
        'FLAG_ACTIVITY_REORDER_TO_FRONT' in pi_body and
        'FLAG_ACTIVITY_CLEAR_TOP' not in pi_body,
    'notification repair helper':
        'v9541RepairNotificationSignal' in main and 'V9541_NOTIFICATION_TAP_GUARD' in main,
    'terminal states not resurrected':
        'boolean terminal=end>0L' in main and 'if(terminal)return;' in main,
    'short geometry guard':
        'boolean stopOk = lng ? stop < entry : stop > entry;' in mon and
        'AÇIK - SEVİYE GEOMETRİSİ KORUMASI' in mon,
    'same-cycle guard':
        'System.currentTimeMillis()-signalTs<4000L' in mon,
    'virtual lifecycle retained':
        'v9518Finish(symbol,stop,"ZARAR İLE KAPANDI - STOP")' in mon and
        'v9518Finish(symbol,t3,"KÂR İLE KAPANDI - TP3")' in mon,
    'radar persistence retained':
        'v9540EnsureRadarCard' in main,
    'version code':'versionCode 26091304' in build,
    'version name':"versionName '9.5.41'" in build,
}
for name,ok in checks.items():
    print(('OK   ' if ok else 'FAIL '),name)
bad=[name for name,ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.41 sanity failed: '+', '.join(bad))
print('v9.5.41 OK: notification taps preserve active LONG/SHORT signals; invalid SHORT/LONG level geometry cannot self-close the virtual signal.')
