from pathlib import Path

p = Path(__file__).with_name('v9526_liquidity_liquidation_intel.py')
s = p.read_text()
needle = "        raise SystemExit('v9.5.26 Gradle dependencies block missing')"
replacement = '''        b += "\\n\\ndependencies {\\n}\\n"
        mm = re.search(r'(?m)^dependencies\\s*\\{', b)'''

if needle in s:
    s = s.replace(needle, replacement, 1)
    p.write_text(s)
    print('v9.5.26 bootstrap OK: missing Gradle dependencies block will be created safely.')
elif 'v9.5.26 Gradle dependencies block missing' in s:
    raise SystemExit('v9.5.26 bootstrap found unexpected dependency guard shape')
else:
    print('v9.5.26 bootstrap: dependency guard already compatible.')
