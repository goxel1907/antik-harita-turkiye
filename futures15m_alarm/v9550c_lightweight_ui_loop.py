from pathlib import Path

MAIN = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/MainActivity.java')
if not MAIN.exists():
    raise SystemExit('v9.5.50c MainActivity missing')
m = MAIN.read_text()

old = '''        try { v9527RefreshTopText(); } catch (Throwable ignored) {}
        try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
        try { v9542EnsureAttentionCard(); } catch (Throwable ignored) {}
        try { v9548RefreshDynamicCards(); } catch (Throwable ignored) {}
        try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
        try { v9550NormalizeRecentTradeCardPosition(); } catch (Throwable ignored) {}'''
new = '''        try { v9527RefreshTopText(); } catch (Throwable ignored) {}
        try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
        try { v9542EnsureAttentionCard(); } catch (Throwable ignored) {}
        // V9550C_LIGHTWEIGHT_DIRECT_NAV
        // Avoid spawning v9548's multi-delay retry cascade every 1.5 seconds.
        try { v9544InstallCoinNavigator(); } catch (Throwable ignored) {}
        try { v9545InstallTopOverlay(); } catch (Throwable ignored) {}
        try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
        try { v9550NormalizeRecentTradeCardPosition(); } catch (Throwable ignored) {}'''
if old not in m:
    raise SystemExit('v9.5.50c stable refresh block missing')
m = m.replace(old, new, 1)
MAIN.write_text(m)

out = MAIN.read_text()
checks = {
    'lightweight direct nav': 'V9550C_LIGHTWEIGHT_DIRECT_NAV' in out,
    'stable helper retained': 'V9550_STABLE_DASHBOARD_HELPERS' in out,
    'dynamic retry still available after rebuild/import': 'V9548_DYNAMIC_CARD_REFRESH' in out,
    'targeted refresh retained': 'V9550_TARGETED_UI_REFRESH' in out,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.50c sanity failed: '+', '.join(bad))
print('v9.5.50c OK: 1.5s UI loop uses direct idempotent card checks instead of repeatedly scheduling v9548 retry cascades.')
