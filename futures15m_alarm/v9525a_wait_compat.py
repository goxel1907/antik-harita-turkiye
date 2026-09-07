from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
ANALYSIS = APP / 'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java'
if not ANALYSIS.exists():
    raise SystemExit('v9.5.25a missing AnalysisPackActivity.java')

a = ANALYSIS.read_text()
needle = 'WAIT mutlaka Türkçe ve gerçekleşmemiş bir sonraki şartı kısa yazsın.'

# Older prompt revisions can phrase the WAIT rule differently. v9.5.25 only
# needs one canonical sentence to attach the dynamic-retest semantics to, so
# add that sentence inside buildPrompt instead of failing the whole build.
if needle not in a:
    start = a.find('    private String buildPrompt(')
    if start < 0:
        raise SystemExit('v9.5.25a buildPrompt missing')
    ret = a.find('        return sb.toString();', start)
    if ret < 0:
        raise SystemExit('v9.5.25a buildPrompt return missing')
    line = '        sb.append("WAIT mutlaka Türkçe ve gerçekleşmemiş bir sonraki şartı kısa yazsın.\\n");\n'
    a = a[:ret] + line + a[ret:]

ANALYSIS.write_text(a)
out = ANALYSIS.read_text()
if needle not in out:
    raise SystemExit('v9.5.25a WAIT compatibility insertion failed')
print('v9.5.25a OK: canonical WAIT rule is present for the dynamic-retest patch.')
