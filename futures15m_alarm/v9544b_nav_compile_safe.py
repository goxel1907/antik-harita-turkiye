from pathlib import Path

MAIN = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/MainActivity.java')
if not MAIN.exists():
    raise SystemExit('v9.5.44b MainActivity missing')

s = MAIN.read_text()
if 'V9544_COIN_JUMP_NAV' not in s:
    raise SystemExit('v9.5.44b navigator marker missing')

# Do not depend on MainActivity having an explicit HorizontalScrollView import.
s = s.replace('        HorizontalScrollView hs = new HorizontalScrollView(this);',
              '        android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(this);')
s = s.replace('        hs.addView(row, new HorizontalScrollView.LayoutParams(',
              '        hs.addView(row, new android.widget.HorizontalScrollView.LayoutParams(')

MAIN.write_text(s)
out = MAIN.read_text()
checks = {
    'navigator retained': 'V9544_COIN_JUMP_NAV' in out,
    'horizontal scroll fully qualified': 'android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(this);' in out,
    'layout params fully qualified': 'new android.widget.HorizontalScrollView.LayoutParams(' in out,
    'coin jump retained': 'v9544ScrollToCoin' in out and 'smoothScrollTo' in out,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.44b sanity failed: '+', '.join(bad))
print('v9.5.44b OK: coin navigator compile-safe without HorizontalScrollView import dependency.')
