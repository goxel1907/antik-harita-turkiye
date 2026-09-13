from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MON = JAVA / 'MonitorService.java'
RADAR = JAVA / 'MarketRadarActivity.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, ANALYSIS, MON, BUILD):
    if not p.exists(): raise SystemExit('v9.5.47b missing: ' + str(p))


def java_balance(text, label):
    braces = parens = brackets = 0
    i = 0
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(text):
        c = text[i]; n = text[i+1] if i+1 < len(text) else ''
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

main = MAIN.read_text(); ana = ANALYSIS.read_text(); mon = MON.read_text(); bf = BUILD.read_text()
java_balance(main,'MainActivity.java'); java_balance(ana,'AnalysisPackActivity.java'); java_balance(mon,'MonitorService.java')
if RADAR.exists(): java_balance(RADAR.read_text(),'MarketRadarActivity.java')

checks = {
    'new selector': 'V9547_BATCH_RADAR_MANUAL_SELECTOR' in main,
    'radar data source': 'V9538MarketRadarEngine.latestJson(this)' in main and 'optJSONArray("rows")' in main,
    'manual field': 'MANUEL COİN GİRİŞİ' in main and 'final EditText manual' in main,
    'manual normalization': 'v9547NormalizeBatchSymbol' in main and 'replaceAll("[^A-Z0-9]", "")' in main,
    'dedupe': 'java.util.LinkedHashSet<String> chosen' in main,
    '2-8 hard limit': 'chosen.size() < 2 || chosen.size() > 8' in main,
    'no analyzed auto select': 'Eski analizli coinler artık otomatik seçilmez' in main and 'cb.setChecked(false)' in main,
    'batch analysis engine retained': 'V9545_BATCH_FIELDS' in ana and 'v9545BatchInternalKick' in ana,
    'batch handoff retained': 'v9545_batch_symbols' in main,
    'delete shortcut retained': 'V9546_ANALYSIS_DELETE_SHORTCUT' in main and 'V9546A_PRECISE_DELETE_TARGET' in main,
    'top overlay retained': 'V9545_TOP_OVERLAY' in main,
    'portfolio retained': 'PORTFÖY / 24 SAAT' in main,
    'radar retained': 'FUTURES RADAR' in main or 'v9540EnsureRadarCard' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'quick order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main,
    'late-entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main and 'dv>0.50' in main,
    'version main': 'v9.5.47' in main,
    'version analysis': 'v9.5.47' in ana,
    'version build': 'versionCode 26091311' in bf and "versionName '9.5.47'" in bf,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.47b sanity failed: '+', '.join(bad))

for forbidden in ('V9547_AUTO_ORDER','v9547AutoOrder','V9547_SIGNAL_DECISION_CHANGE'):
    if forbidden in main or forbidden in ana or forbidden in mon:
        raise SystemExit('v9.5.47b forbidden marker: '+forbidden)

print('v9.5.47b OK: radar/manual batch selector compile guards passed; trading core unchanged.')
