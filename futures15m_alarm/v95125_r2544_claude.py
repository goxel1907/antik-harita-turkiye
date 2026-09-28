"""V95125_R2544_CLAUDE (Claude, Anthropic • Cowork • 2026-09-28): Android kimlik + R2544 PC telemetri etiketi.
Yürütme DEĞİŞMEZ: Android hâlâ PC-only / fail-closed; /live/execute POST yok (aşağıda doğrulanır).
- versionName 9.5.118-r2544-claude / versionCode 26092802 (Claude yapımı sürüm açıkça işaretli).
- "PC Brain Hub sürümü" artık /live/status runtimeRelease alanından (yoksa eski featureVersion) okunur;
  eski sabit 9.5.113-CLAUDE-VISION metni gerçek çalışan PC sürümü gibi görünmez.
- İşlem kartı güvenlik satırı: risk otoritesi PANEL (marj × kaldıraç × max poz) + 10 sn pozisyon koruması.
"""
from pathlib import Path
import re

app = Path('/tmp/futures15m-build/Futures15mAlarm')
java = app / 'app/src/main/java/com/futuresalarm/app'
main_path, card_path = java / 'MainActivity.java', java / 'AutoDecisionCard.java'
main, card = main_path.read_text(encoding='utf-8'), card_path.read_text(encoding='utf-8')
assert 'V95124_R2543_UI2' in main, 'v95124 must run first'

main = main.replace('v9.5.117-JEV-PC-ONLY-R2543-UI2', 'v9.5.118-JEV-PC-ONLY-R2544-CLAUDE')
main = main.replace('"9.5.117-r2543-ui2"', '"9.5.118-r2544-claude"')
main = main.replace('"26092801"', '"26092802"')

old_fv = '.putString("v95105_pc_feature_version",st.optString("featureVersion",""))'
new_fv = '.putString("v95105_pc_feature_version",st.optString("runtimeRelease",st.optString("featureVersion","")))'
if old_fv in main:
    main = main.replace(old_fv, new_fv)
    print('V95125 PC runtimeRelease identity: applied')
else:
    # Anchor başka bir dosyada olabilir; derlemeyi kırmadan tüm java dosyalarında ara.
    hit = False
    for p in java.glob('*.java'):
        t = p.read_text(encoding='utf-8')
        if old_fv in t:
            p.write_text(t.replace(old_fv, new_fv), encoding='utf-8'); hit = True
            print('V95125 PC runtimeRelease identity: applied in', p.name)
    if not hit:
        print('V95125 WARNING: featureVersion anchor not found; PC version label unchanged')

card = card.replace('İŞLEM MERKEZİ • R2543 UI2', 'İŞLEM MERKEZİ • R2544')
card = card.replace('• pozisyon sınırı PC panel ayarından alınır',
                    '• risk: PANEL (marj × kaldıraç × max poz) • pozisyon koruması 10 sn')
main += '\n// V95125_R2544_CLAUDE\n'
card += '\n// V95125_R2544_CLAUDE\n'

build_path = app / 'app/build.gradle'
build = build_path.read_text(encoding='utf-8')
build = re.sub(r'versionCode\s+\d+', 'versionCode 26092802', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.118-r2544-claude'", build, count=1)

client = (java / 'BrainHubClient.java').read_text(encoding='utf-8')
assert 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client
assert 'post(c, "/live/execute", intent, true)' not in client
assert 'historical PHONE Binance executor permanently inert' in (java / 'AutoTradeEngine.java').read_text(encoding='utf-8')
for p, text in [(main_path, main), (card_path, card), (build_path, build)]:
    p.write_text(text, encoding='utf-8')
print('V95125_R2544_CLAUDE_OK')
