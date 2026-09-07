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

# v9525_dynamic_retest_precision.py inserts the canonical no-double-counting
# sentence with the wording "tek YAPI ailesinin kuvveti", but its fail-fast
# check accidentally looked for "aynı YAPI ailesinin kuvveti". That makes a
# correct prompt fail before Java/Gradle even starts. Patch only the checker;
# do not duplicate or weaken the actual decision rule in the MASTER prompt.
downstream = Path(__file__).with_name('v9525_dynamic_retest_precision.py')
if not downstream.exists():
    raise SystemExit('v9.5.25a downstream dynamic-retest patch missing')

s = downstream.read_text()
old_check = "('aynı YAPI ailesinin kuvveti' in af and 'CANLI AKIŞ ailesidir' in af, 'no double-counting rule'),"
new_check = "('RETEST KÜMELEME / ÇİFTE SAYMAMA:' in af and 'tek YAPI ailesinin kuvveti' in af and 'CANLI AKIŞ ailesidir' in af, 'no double-counting rule'),"
if old_check in s:
    s = s.replace(old_check, new_check, 1)
elif new_check not in s:
    raise SystemExit('v9.5.25a no-double-counting sanity anchor missing')
downstream.write_text(s)

verify = downstream.read_text()
if new_check not in verify:
    raise SystemExit('v9.5.25a no-double-counting sanity compatibility failed')

print('v9.5.25a OK: canonical WAIT rule present; dynamic-retest no-double-counting sanity check aligned with the actual prompt wording.')
