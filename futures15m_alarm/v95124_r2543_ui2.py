"""Current, plain-language UI identity. Execution and stored history are unchanged."""
from pathlib import Path
import re

app = Path('/tmp/futures15m-build/Futures15mAlarm')
java = app / 'app/src/main/java/com/futuresalarm/app'
main_path, card_path = java / 'MainActivity.java', java / 'AutoDecisionCard.java'
main, card = main_path.read_text(encoding='utf-8'), card_path.read_text(encoding='utf-8')
assert 'V95123_ANDROID_R2543_CONTRACT' in main
assert 'max 2 pozisyon' in card
main = main.replace('v9.5.116-JEV-PC-ONLY-R2543', 'v9.5.117-JEV-PC-ONLY-R2543-UI2')
main = main.replace('"v9.5.117-JEV-PC-ONLY-R2543-UI2  •  MANUEL PRO"', '"BrainHub " + "9.5.117-r2543-ui2" + " • " + "26092801"')
main = main.replace('Sürüm: v9.5.114-JEV-PRO-SCALPER-R2531 • V110 MULTILANE tabanı • Claude v111 hızlı tetik/Jev/runner', 'Uygulama: 9.5.117 • R2543 UI2 • JEV karar merkezi')
main = main.replace('st.append("\\nUygulama: 9.5.117 • R2543 UI2 • JEV karar merkezi");', 'st.append("\\nUygulama: ").append("9.5.117-r2543-ui2").append(" • build ").append("26092801").append(" • JEV Son Karar");')
main = main.replace('PC BrainHub R2541 atomik ayna + tam bağlam kullanır', 'PC sürümü ve bağlantı durumu canlı telemetriden doğrulanır')
card = card.replace('İŞLEM MERKEZİ • PC BRAINHUB', 'İŞLEM MERKEZİ • R2543 UI2')
card = card.replace('• max 2 pozisyon', '• pozisyon sınırı PC panel ayarından alınır')
main += '\n// V95124_R2543_UI2\n'
card += '\n// V95124_R2543_UI2\n'
build_path = app / 'app/build.gradle'
build = build_path.read_text(encoding='utf-8')
build = re.sub(r'versionCode\s+\d+', 'versionCode 26092801', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.117-r2543-ui2'", build, count=1)
client = (java / 'BrainHubClient.java').read_text(encoding='utf-8')
truth = (java / 'V95113PcTruth.java').read_text(encoding='utf-8')
assert 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client
assert 'post(c, "/live/execute", intent, true)' not in client
assert 'FRESH_MS = 45000L' in truth and 'MIN_FAILURES_BEFORE_UNHEALTHY = 3' in truth
assert 'historical PHONE Binance executor permanently inert' in (java / 'AutoTradeEngine.java').read_text(encoding='utf-8')
for p, text in [(main_path, main), (card_path, card), (build_path, build)]:
    p.write_text(text, encoding='utf-8')
print('V95124_R2543_UI2_OK')
