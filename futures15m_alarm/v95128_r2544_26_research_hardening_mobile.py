r"""V95128_R2544_26_RESEARCH_HARDENING_MOBILE
Android read-only telemetry/UI alignment for BrainHub R2544.26.
- PC remains sole execution brain; phone cannot originate orders.
- Surfaces actual PC runtime release already mirrored through v95105_pc_feature_version.
- Adds a concise note that local-L2 / soft-memory / shadow-liquidation evidence lives on PC.
- No /live/execute POST, no risk/stop/TP/execution changes.
"""
from pathlib import Path
import re

app = Path('/tmp/futures15m-build/Futures15mAlarm')
java = app / 'app/src/main/java/com/futuresalarm/app'
main_path = java / 'MainActivity.java'
card_path = java / 'AutoDecisionCard.java'
build_path = app / 'app/build.gradle'

main = main_path.read_text(encoding='utf-8')
card = card_path.read_text(encoding='utf-8')
build = build_path.read_text(encoding='utf-8')

assert 'V95127_R2544_4_DESK_STATS' in main, 'v95127 must run first'

# Keep install identity current without changing the PC-only authority boundary.
main = re.sub(r'v9\.5\.(?:118|119)-JEV-PC-ONLY-R2544[^"\n]*',
              'v9.5.120-JEV-PC-ONLY-R2544.26-RESEARCH-HARDENING',
              main, count=1)
card = card.replace('İŞLEM MERKEZİ • R2544', 'İŞLEM MERKEZİ • R2544.26')

old = 'String bodyText = V95113PcTruth.deskStatsText(sp, now, true);'
new = '''String bodyText = V95113PcTruth.deskStatsText(sp, now, true);
        String v95128PcRelease = sp.getString("v95105_pc_feature_version", "—");
        bodyText += "\\n🧠 PC sürüm: " + v95128PcRelease
                + "\\n🔬 R2544.26 kanıtları: sequence-safe L2 + soft vaka hafızası + shadow modeled likidasyon"
                + "\\n🔒 TELEFON SALT-OKUNUR • emir/strateji otoritesi PC JEV'de";'''
if old not in main:
    raise SystemExit('V95128 desk body anchor not found')
main = main.replace(old, new, 1)

main = main.replace('🏢 MASA İSTATİSTİKLERİ • PC DEFTERİ',
                    '🏢 MASA İSTATİSTİKLERİ • PC R2544.26 • DEFTER', 1)

build = re.sub(r'versionCode\s+\d+', 'versionCode 26100101', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]",
               "versionName '9.5.120-r2544.26'", build, count=1)

client = (java / 'BrainHubClient.java').read_text(encoding='utf-8')
engine = (java / 'AutoTradeEngine.java').read_text(encoding='utf-8')
assert 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client
assert 'post(c, "/live/execute", intent, true)' not in client
assert 'historical PHONE Binance executor permanently inert' in engine
assert 'ANDROID DIRECT EXECUTOR DISABLED • PC ONLY' in engine

main += '\n// V95128_R2544_26_RESEARCH_HARDENING_MOBILE\n'
card += '\n// V95128_R2544_26_RESEARCH_HARDENING_MOBILE\n'
main_path.write_text(main, encoding='utf-8')
card_path.write_text(card, encoding='utf-8')
build_path.write_text(build, encoding='utf-8')
print('V95128_R2544_26_RESEARCH_HARDENING_MOBILE_OK')
