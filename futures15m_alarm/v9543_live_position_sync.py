from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.43 missing required generated file: ' + str(p))


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
# v9.5.43 PRIORITY-1 FIX: live Binance account / open-position reconciliation.
#
# v9.5.42 dashboard can render Binance positions, but account refresh is mostly
# interaction/lifecycle driven. A MARKET entry created while MainActivity stays
# open can therefore remain invisible until the process/activity is restarted.
#
# Contract:
# - read-only account refresh; NEVER sends/cancels an order;
# - force one sync on resume (return from Binance / notification / background);
# - poll account every 5s only while MainActivity is resumed;
# - force an immediate sync after a confirmed app MARKET entry;
# - reuse v9527RequestAccountSync(), including its busy/throttle/API guards.
# ---------------------------------------------------------------------------
main = MAIN.read_text()

if 'private void v9527RequestAccountSync(boolean' not in main:
    raise SystemExit('v9.5.43 required method missing: v9527RequestAccountSync(boolean)')
if 'v9527UiHandler' not in main:
    raise SystemExit('v9.5.43 required UI handler missing: v9527UiHandler')
if 'v9527RefreshTopText' not in main:
    raise SystemExit('v9.5.43 required dashboard refresh missing: v9527RefreshTopText')

# Visible app version only. Do not rewrite historical protocol labels in prompts.
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
              '15m Futures Alarm PRO v9.5.43', main)
main = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
              'v9.5.43  •  MANUEL PRO', main)

# Add one lifecycle-scoped poller. It intentionally calls force=false so the
# existing v9527 busy/throttle logic remains authoritative after the first sync.
if 'V9543_LIVE_ACCOUNT_POLL' not in main:
    idx = main.rfind('}')
    if idx < 0:
        raise SystemExit('v9.5.43 MainActivity closing brace missing')
    helper = r'''

    // V9543_LIVE_ACCOUNT_POLL
    private final Runnable v9543LiveAccountPoll = new Runnable() {
        @Override public void run() {
            try {
                v9527RequestAccountSync(false);
            } catch (Throwable ignored) {}
            try {
                v9527UiHandler.postDelayed(this, 5000L);
            } catch (Throwable ignored) {}
        }
    };

    private void v9543StartLiveAccountSync() {
        try { v9527UiHandler.removeCallbacks(v9543LiveAccountPoll); } catch (Throwable ignored) {}
        // Immediate authoritative read when activity becomes visible again.
        try { v9527RequestAccountSync(true); } catch (Throwable ignored) {}
        try { v9527RefreshTopText(); } catch (Throwable ignored) {}
        try { v9527UiHandler.postDelayed(v9543LiveAccountPoll, 1200L); } catch (Throwable ignored) {}
    }

    private void v9543StopLiveAccountSync() {
        try { v9527UiHandler.removeCallbacks(v9543LiveAccountPoll); } catch (Throwable ignored) {}
    }
'''
    main = main[:idx] + helper + '\n' + main[idx:]

# onResume: start sync after all existing resume work so the rebuilt dashboard
# and radar are already attached when the account callback arrives.
b = method_bounds(main, 'protected void onResume(')
if not b:
    raise SystemExit('v9.5.43 onResume method missing')
a, _, e = b
resume = main[a:e]
if 'V9543_RESUME_LIVE_ACCOUNT_SYNC' not in resume:
    p = resume.rfind('}')
    if p < 0:
        raise SystemExit('v9.5.43 onResume closing brace missing')
    resume = resume[:p] + '''        // V9543_RESUME_LIVE_ACCOUNT_SYNC\n        v9543StartLiveAccountSync();\n''' + resume[p:]
    main = main[:a] + resume + main[e:]

# onPause: stop foreground polling. MonitorService/public market tracking remains
# untouched; this only prevents unnecessary signed account reads off-screen.
b = method_bounds(main, 'protected void onPause(')
if not b:
    raise SystemExit('v9.5.43 onPause method missing')
a, _, e = b
pause = main[a:e]
if 'V9543_PAUSE_LIVE_ACCOUNT_SYNC' not in pause:
    brace = pause.find('{')
    if brace < 0:
        raise SystemExit('v9.5.43 onPause opening brace missing')
    pause = pause[:brace + 1] + '''\n        // V9543_PAUSE_LIVE_ACCOUNT_SYNC\n        v9543StopLiveAccountSync();''' + pause[brace + 1:]
    main = main[:a] + pause + main[e:]

# App-created MARKET entry: do not wait for the next 5s poll. The account sync
# is read-only and runs independently from STOP/TP placement.
entry_anchor = 'sp.edit().putLong("v9522_order_sent_signal_" + d.symbol, signalTs).apply();'
if 'V9543_SYNC_AFTER_MARKET_ENTRY' not in main:
    if entry_anchor not in main:
        raise SystemExit('v9.5.43 MARKET entry success anchor missing')
    main = main.replace(
        entry_anchor,
        entry_anchor + '''\n                // V9543_SYNC_AFTER_MARKET_ENTRY\n                runOnUiThread(() -> {\n                    try { v9527RequestAccountSync(true); } catch (Throwable ignored) {}\n                    try { v9527RefreshTopText(); } catch (Throwable ignored) {}\n                });''',
        1,
    )

MAIN.write_text(main)

# Keep notification/service visible version consistent without changing any
# signal rules or lifecycle semantics.
mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
             '15m Futures Alarm PRO v9.5.43', mon)
MON.write_text(mon)

# Android package version.
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

resume_bounds = method_bounds(main, 'protected void onResume(')
pause_bounds = method_bounds(main, 'protected void onPause(')
resume_body = main[resume_bounds[0]:resume_bounds[2]] if resume_bounds else ''
pause_body = main[pause_bounds[0]:pause_bounds[2]] if pause_bounds else ''

checks = {
    'live poll installed': 'V9543_LIVE_ACCOUNT_POLL' in main and 'postDelayed(this, 5000L)' in main,
    'resume forces authoritative sync': 'V9543_RESUME_LIVE_ACCOUNT_SYNC' in resume_body and 'v9543StartLiveAccountSync();' in resume_body,
    'pause stops foreground polling': 'V9543_PAUSE_LIVE_ACCOUNT_SYNC' in pause_body and 'v9543StopLiveAccountSync();' in pause_body,
    'app MARKET fill forces sync': 'V9543_SYNC_AFTER_MARKET_ENTRY' in main and entry_anchor in main,
    'account engine retained': 'v9527RequestAccountSync(boolean' in main and 'v9527ReconcileAccount' in main,
    'dashboard retained': 'PORTFÖY / 24 SAAT' in main and 'v9527RefreshTopText' in main,
    'signal persistence retained': 'v9541_notif_signal_ts_' in main and 'v9541_repaired_at_' in main,
    'radar persistence retained': 'v9540EnsureRadarCard' in main,
    'attention radar retained': 'v9542EnsureAttentionCard' in main,
    'no order side effect in poll helper': '/fapi/v1/order' not in main[main.find('V9543_LIVE_ACCOUNT_POLL'):main.find('private void v9543StopLiveAccountSync') + 200],
    'version code': 'versionCode 26091306' in bf,
    'version name': "versionName '9.5.43'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.43 sanity failed: ' + ', '.join(bad))

print('v9.5.43 OK: open Binance positions/PnL reconcile immediately on resume, after app MARKET entry, and every 5s while foreground; no trading action added.')
