from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
SELECTOR = JAVA / 'V9547BatchSelector.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, SELECTOR, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.49b missing: ' + str(p))


def java_balance(text, label):
    braces = parens = brackets = 0
    i = 0
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/': block_comment = False; i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/': line_comment = True; i += 1
            elif c == '/' and n == '*': block_comment = True; i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': braces += 1
            elif c == '}':
                braces -= 1
                if braces < 0: raise SystemExit(label + ': extra }')
            elif c == '(': parens += 1
            elif c == ')':
                parens -= 1
                if parens < 0: raise SystemExit(label + ': extra )')
            elif c == '[': brackets += 1
            elif c == ']':
                brackets -= 1
                if brackets < 0: raise SystemExit(label + ': extra ]')
        i += 1
    if in_str or in_chr or block_comment:
        raise SystemExit(label + ': unterminated string/char/comment')
    if braces or parens or brackets:
        raise SystemExit(f'{label}: unbalanced braces={braces} parens={parens} brackets={brackets}')

main = MAIN.read_text(); mon = MON.read_text(); ana = ANALYSIS.read_text()
radar = RADAR.read_text(); eng = ENGINE.read_text(); selector = SELECTOR.read_text(); bf = BUILD.read_text()

for label, text in (
    ('MainActivity.java', main), ('MonitorService.java', mon),
    ('AnalysisPackActivity.java', ana), ('MarketRadarActivity.java', radar),
    ('V9538MarketRadarEngine.java', eng), ('V9547BatchSelector.java', selector),
):
    java_balance(text, label)

checks = {
    'foreground ui loop': 'V9549_FOREGROUND_UI_COHERENCE' in main and 'postDelayed(this, 1500L)' in main,
    'periodic full refresh': 'now - v9549LastFullRefreshAt >= 15000L' in main and 'v9549RebuildPreservingScroll' in main,
    'scroll preserved': 'restoreY' in main and 'sv.scrollTo' in main,
    'dialog typing guard': 'hasWindowFocus()' in main and 'instanceof android.widget.EditText' in main,
    'portfolio text live refresh': 'v9527RefreshTopText();' in main,
    'account poll retained': 'V9543_LIVE_ACCOUNT_POLL' in main and 'postDelayed(this, 5000L)' in main,
    'recent real trade card': 'V9549_RECENT_REAL_TRADES_CARD' in main and 'CANLI / SON GERÇEK İŞLEMLER' in main,
    'virtual history excluded from real card': 'if (key.startsWith("v9518_")) continue' in main,
    'trade metrics': 'Marj:' in main and 'Kaldıraç:' in main and 'ROI:' in main and 'PnL:' in main,
    'geometry advisory': 'V9549_PLAN_GEOMETRY_ADVISORY' in main and 'v9549PlanGeometryWarning' in main,
    'geometry is not hard veto': 'Bu uyarı alarmı otomatik engellemez' in main,
    'geometry import hook': 'V9549_PLAN_GEOMETRY_IMPORT' in main,
    'geometry panel': 'V9549_PLAN_GEOMETRY_PANEL' in main,
    'quick nav persistence retained': 'V9548_DYNAMIC_CARD_REFRESH' in main and 'V9544_COIN_JUMP_NAV' in main,
    'radar retained': 'v9540EnsureRadarCard' in main and 'v9542EnsureAttentionCard' in main,
    'signal persistence retained': 'v9541_notif_signal_ts_' in main and 'v9543b_strict_ticket_' in main,
    'manual order safety retained': 'V9543C_SINGLE_TAP_APPROVAL' in main and 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'batch retained': 'V9547_SHARED_BATCH_SELECTOR' in main and 'final class V9547BatchSelector' in selector,
    'version main': 'v9.5.49' in main,
    'version build': 'versionCode 26091313' in bf and "versionName '9.5.49'" in bf,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '), k)
bad = [k for k,v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.49b sanity failed: ' + ', '.join(bad))

start = main.find('V9549_FOREGROUND_UI_COHERENCE')
end = main.find('V9549_PLAN_GEOMETRY_ADVISORY')
ui_block = main[start:end if end > start else len(main)]
for forbidden in ('/fapi/v1/order', 'newOrder', 'cancelOrder', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'):
    if forbidden in ui_block:
        raise SystemExit('v9.5.49b UI helper unexpectedly contains trading side effect: ' + forbidden)

print('v9.5.49b OK: in-app UI self-refreshes without restart; real-trade mini cards and advisory geometry warnings are present; trading safety remains unchanged.')

# V9550 stage is intentionally NOT chained here.
# Codemagic invokes v9550_stable_live_ui_trade_meta.py and v9550b_compile_safe.py
# explicitly after this regression check. Keeping one owner for patch order makes
# the source preparation deterministic and prevents double-application failures.
print('v9.5.49b chain OK: v9.5.50 is owned by Codemagic explicit stage.')
