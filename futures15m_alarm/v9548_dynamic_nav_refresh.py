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

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.48 missing required generated file: ' + str(p))


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


m = MAIN.read_text()
for marker in (
    'V9544_COIN_JUMP_NAV',
    'V9545_BATCH_ANALYSIS',
    'V9546_ANALYSIS_DELETE_SHORTCUT',
    'V9547_SHARED_BATCH_SELECTOR',
    'v9543b_strict_ticket_',
    'V9543C_EXECUTION_DRIFT_RECHECK',
):
    if marker not in m:
        raise SystemExit('v9.5.48 prerequisite missing in MainActivity: ' + marker)

# ---------------------------------------------------------------------------
# Root cause fix: v9.5.44 navigator is injected after onCreate/onResume only.
# Plan import can rebuild MainActivity's content view in-place, which removes
# the injected navigator until the next Activity resume. Make dynamic cards
# self-heal after every buildUi setContentView and every successful plan import.
# Trading/signal/order state is not modified here.
# ---------------------------------------------------------------------------
if 'V9548_DYNAMIC_CARD_REFRESH' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.48 MainActivity closing brace missing')
    helper = r'''

    // ============================================================
    // V9548_DYNAMIC_CARD_REFRESH
    // UI-only self-heal after plan import / in-place buildUi redraw.
    // Does NOT alter plan, signal, order or monitoring state.
    // ============================================================
    private void v9548PostDynamicCardRefresh(long delayMs) {
        try {
            android.view.View content = findViewById(android.R.id.content);
            if (content == null) return;
            content.postDelayed(() -> {
                try {
                    v9544InstallCoinNavigator();
                    v9545InstallTopOverlay();
                } catch (Throwable ignored) {}
            }, Math.max(0L, delayMs));
        } catch (Throwable ignored) {}
    }

    private void v9548RefreshDynamicCards() {
        // Several short retries cover dashboard/radar/plan cards that are
        // attached asynchronously after buildUi without requiring app restart.
        v9548PostDynamicCardRefresh(0L);
        v9548PostDynamicCardRefresh(90L);
        v9548PostDynamicCardRefresh(280L);
        v9548PostDynamicCardRefresh(750L);
        v9548PostDynamicCardRefresh(1400L);
    }
'''
    m = m[:pos] + helper + '\n' + m[pos:]

# Hook every in-place Main UI rebuild. Preserve the original call and add only
# an idempotent dynamic-card refresh. Avoid duplicate insertion on reruns.
pat = re.compile(r'(?m)^(\s*)setContentView\s*\(\s*buildUi\s*\(\s*\)\s*\)\s*;\s*$')
matches = list(pat.finditer(m))
if not matches:
    raise SystemExit('v9.5.48 setContentView(buildUi()) anchor missing')

def repl_setcontent(mm):
    indent = mm.group(1)
    return mm.group(0) + '\n' + indent + '// V9548_REINSTALL_AFTER_BUILDUI\n' + indent + 'v9548RefreshDynamicCards();'

# Only add where the marker is not already immediately after the call.
out = []
last = 0
for mm in matches:
    out.append(m[last:mm.start()])
    tail = m[mm.end():mm.end()+180]
    if 'V9548_REINSTALL_AFTER_BUILDUI' in tail:
        out.append(mm.group(0))
    else:
        out.append(repl_setcontent(mm))
    last = mm.end()
out.append(m[last:])
m = ''.join(out)

# Refresh after each successfully accepted plan line. The delayed buildUi hook
# above handles a subsequent redraw; this hook also updates the card when the
# import path updates views without replacing the whole content view.
b = method_bounds(m, '    private void openImportDialog()')
if not b:
    b = method_bounds(m, 'private void openImportDialog()')
if not b:
    raise SystemExit('v9.5.48 openImportDialog missing')
a0, _, e0 = b
imp = m[a0:e0]
if 'V9548_REFRESH_AFTER_PLAN_IMPORT' not in imp:
    hit = re.search(r'(?m)^(\s*)success\+\+;\s*$', imp)
    if not hit:
        raise SystemExit('v9.5.48 import success++ anchor missing')
    indent = hit.group(1)
    inject = (hit.group(0) + '\n' + indent + '// V9548_REFRESH_AFTER_PLAN_IMPORT\n'
              + indent + 'v9548RefreshDynamicCards();')
    imp = imp[:hit.start()] + inject + imp[hit.end():]
    m = m[:a0] + imp + m[e0:]

# Keep onResume self-heal explicit as a final safety net. Existing v9544
# scheduling remains; this call is UI-only and idempotent.
b = method_bounds(m, 'protected void onResume(')
if b:
    a0, _, e0 = b
    body = m[a0:e0]
    if 'V9548_REFRESH_ON_RESUME' not in body:
        p = body.rfind('}')
        if p < 0:
            raise SystemExit('v9.5.48 onResume close missing')
        body = body[:p] + ('        // V9548_REFRESH_ON_RESUME\n'
                          '        v9548RefreshDynamicCards();\n') + body[p:]
        m = m[:a0] + body + m[e0:]

# Visible version alignment only.
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.48', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.48  •  MANUEL PRO', m)
MAIN.write_text(m)

for p in (MON, ANALYSIS, RADAR, ENGINE):
    s = p.read_text()
    s = s.replace('v9.5.47', 'v9.5.48').replace('V9.5.47', 'V9.5.48')
    p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091312', bf, count=1)
bf = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.48'", bf, count=1)
BUILD.write_text(bf)

# Fail fast on the exact persistence behavior we are fixing.
out = MAIN.read_text()
checks = {
    'dynamic helper': 'V9548_DYNAMIC_CARD_REFRESH' in out and 'v9548RefreshDynamicCards()' in out,
    'buildUi reinstall': 'V9548_REINSTALL_AFTER_BUILDUI' in out,
    'import refresh': 'V9548_REFRESH_AFTER_PLAN_IMPORT' in out,
    'resume refresh': 'V9548_REFRESH_ON_RESUME' in out,
    'navigator retained': 'V9544_COIN_JUMP_NAV' in out and 'v9544InstallCoinNavigator' in out,
    'batch retained': 'V9547_SHARED_BATCH_SELECTOR' in out,
    'delete retained': 'V9546_ANALYSIS_DELETE_SHORTCUT' in out,
    'signal lock retained': 'v9543b_strict_ticket_' in out,
    'late entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in out,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.48 sanity failed: ' + ', '.join(bad))

print('v9.5.48 OK: quick navigation/delete/batch cards self-heal after plan import and buildUi redraw; trading core untouched.')
