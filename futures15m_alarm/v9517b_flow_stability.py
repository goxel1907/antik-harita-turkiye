from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MONITOR = APP / 'app/src/main/java/com/futuresalarm/app/MonitorService.java'
if not MONITOR.exists():
    raise SystemExit('v9.5.17b MonitorService missing')

m = MONITOR.read_text()

anchor = '    private String v953Decision(String symbol) {'
if 'private boolean v9517StableFlow(' not in m:
    if anchor not in m:
        raise SystemExit('v9.5.17b helper anchor missing')
    helper = r'''    private boolean v9517StableFlow(String symbol, boolean wantLong, MarketSnapshot market, boolean breakoutStyle) {
        // A single 15-second snapshot can flip quickly in high volatility.
        // Require two consecutive fresh monitor samples (~15-30s) before a
        // critical alarm may use the live-flow confirmation.
        boolean pass = v953FlowAcceptable(wantLong, market, breakoutStyle);
        long now = System.currentTimeMillis();
        String side = wantLong ? "LONG" : "SHORT";
        String style = breakoutStyle ? "BRK" : "REV";
        String base = "v9517_flow_" + symbol + "_" + side + "_" + style;
        long last = prefs.getLong(base + "_ts", 0L);
        int count = prefs.getInt(base + "_count", 0);
        long armed = prefs.getLong("v9517_plan_armed_" + symbol, 0L);
        if (last < armed) count = 0;
        if (now - last >= 10000L) {
            count = pass ? Math.min(3, count + 1) : 0;
            prefs.edit().putLong(base + "_ts", now).putInt(base + "_count", count).apply();
        }
        return pass && count >= 2;
    }

'''
    m = m.replace(anchor, helper + anchor, 1)

repls = [
    ('&& v953FlowAcceptable(true, market, false)', '&& v9517StableFlow(p.symbol, true, market, false)'),
    ('&& v953FlowAcceptable(false, market, false)', '&& v9517StableFlow(p.symbol, false, market, false)'),
    ('&& v953FlowAcceptable(true, market, true)', '&& v9517StableFlow(p.symbol, true, market, true)'),
    ('&& v953FlowAcceptable(false, market, true)', '&& v9517StableFlow(p.symbol, false, market, true)'),
]
for old, new in repls:
    if old in m:
        m = m.replace(old, new, 1)
    elif new not in m:
        raise SystemExit('v9.5.17b condition anchor missing: ' + old)

MONITOR.write_text(m)

check = MONITOR.read_text()
if 'private boolean v9517StableFlow(' not in check:
    raise SystemExit('v9.5.17b stable-flow helper missing')
if check.count('v9517StableFlow(p.symbol') < 4:
    raise SystemExit('v9.5.17b not all four critical scenarios use stable flow')
print('v9.5.17b OK: critical alarm requires 2 consecutive fresh live-flow samples; single-snapshot spikes cannot trigger it.')
