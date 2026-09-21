from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.37 missing required file: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    in_str = False
    in_chr = False
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
# v9.5.37 regression fix
# The v9.5.27 dashboard code is still part of the generated application, but
# v9.5.36 can reach the final MainActivity without installing that top card.
# Restore ONE deterministic install point after setContentView so the old
# PORTFÖY / 24 SAAT dashboard is visible again.
#
# Important: this is not Binance-only. The historical dashboard already reads
# the v9518 virtual-signal store, so a signal remains tracked through TP1/TP2,
# TP3 or STOP even when the user never sent a Binance order.
# ---------------------------------------------------------------------------
s = MAIN.read_text()

# Version strings.
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.37', s)
s = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.37  •  MANUEL PRO', s)

# Fail early if an earlier patch accidentally removed the dashboard implementation.
if not re.search(r'\bvoid\s+v9527InstallTopDashboard\s*\(\s*\)', s):
    raise SystemExit('v9.5.37 dashboard implementation missing: v9527InstallTopDashboard()')
if not re.search(r'\bvoid\s+v9527RefreshTopText\s*\(\s*\)', s):
    raise SystemExit('v9.5.37 dashboard refresh implementation missing: v9527RefreshTopText()')
if 'PORTFÖY / 24 SAAT' not in s:
    raise SystemExit('v9.5.37 PORTFÖY / 24 SAAT dashboard text missing')

# Remove stale standalone install calls and install exactly once from onCreate.
# Keeping this deterministic avoids duplicate cards after future patch chaining.
s = re.sub(r'(?m)^[ \t]*v9527InstallTopDashboard\(\);[ \t]*\n', '', s)

b = method_bounds(s, 'protected void onCreate(')
if not b:
    raise SystemExit('v9.5.37 onCreate method missing')
a, _, e = b
on_create = s[a:e]
anchor = 'setContentView(buildUi());'
if anchor not in on_create:
    raise SystemExit('v9.5.37 setContentView(buildUi()) anchor missing')
on_create = on_create.replace(
    anchor,
    anchor + '\n        // V9537_RESTORE_TOP_DASHBOARD\n        v9527InstallTopDashboard();\n        v9527RefreshTopText();',
    1,
)
s = s[:a] + on_create + s[e:]

# When the user returns from Binance/Chrome, force an immediate visible refresh.
# The existing v9527 handler continues its normal live refresh afterwards.
b = method_bounds(s, 'protected void onResume(')
if not b:
    raise SystemExit('v9.5.37 onResume method missing')
a, _, e = b
resume = s[a:e]
if 'V9537_REFRESH_TOP_DASHBOARD' not in resume:
    p = resume.rfind('}')
    if p < 0:
        raise SystemExit('v9.5.37 onResume closing brace missing')
    resume = resume[:p] + '''        // V9537_REFRESH_TOP_DASHBOARD\n        try { v9527RefreshTopText(); } catch (Throwable ignored) {}\n''' + resume[p:]
    s = s[:a] + resume + s[e:]

# Add a source-level contract marker. This is intentionally documentation-only;
# the actual virtual result engine stays in v9518b and must never depend on an
# opened Binance position.
if 'V9537_VIRTUAL_SIGNAL_CONTRACT' not in s:
    pos = s.find('\n', s.find('public class '))
    if pos < 0:
        pos = 0
    s = s[:pos + 1] + (
        '    // V9537_VIRTUAL_SIGNAL_CONTRACT: dashboard must show virtual signal TP/STOP result even without Binance order.\n'
    ) + s[pos + 1:]

MAIN.write_text(s)

# Monitor contract must still contain the virtual cycle/result engine.
m = MON.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.37', m)
MON.write_text(m)

# Version bump.
build = BUILD.read_text()
build = re.sub(r'versionCode\s+\d+', 'versionCode 26091208', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.37'", build, count=1)
BUILD.write_text(build)

# ---------------------------------------------------------------------------
# Fail-fast regression checks.
# ---------------------------------------------------------------------------
main = MAIN.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

# Count only standalone invocations; method declaration does not match this form.
install_calls = len(re.findall(r'(?m)^[ \t]*v9527InstallTopDashboard\(\);[ \t]*$', main))
checks = {
    'dashboard installed exactly once': install_calls == 1,
    'dashboard install after content view': 'setContentView(buildUi());\n        // V9537_RESTORE_TOP_DASHBOARD\n        v9527InstallTopDashboard();' in main,
    'dashboard visible label retained': 'PORTFÖY / 24 SAAT' in main,
    'dashboard refresh retained': 'v9527RefreshTopText' in main,
    'virtual signal summary UI retained': 'v9518SignalOzet' in main and 'v9518_history_' in main and 'v9518_signal_active_' in main,
    'virtual result engine retained': 'v9518UpdateSignalResult' in mon and 'v9518Finish' in mon,
    'profit result retained': 'KÂR İLE KAPANDI - TP3' in mon,
    'loss result retained': 'ZARAR İLE KAPANDI - STOP' in mon,
    'notification ticket fix retained': 'v9536_open_trade_ticket' in main and 'v9536OpenTradeTicketIntent' in mon,
    'version code': 'versionCode 26091208' in bf,
    'version name': "versionName '9.5.37'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.37 sanity failed: ' + ', '.join(bad))

print('v9.5.37 OK: PORTFÖY / 24 SAAT top dashboard restored; Binance PnL + virtual signal TP/STOP history remain visible.')
