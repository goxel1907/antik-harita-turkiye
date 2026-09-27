"""R2543 Android contract post-patch.

Runs after v95123_r2542_professional_mobile_ui.py on the public release branch.

PC tarafi R2541'den R2543'e gecti: exit siniflandirmasi (JEV_EXIT_NOW / kismi cikis /
BrainHub disinda kapanis / kullanici manuel), risk tavani fail-closed reddi, ve order-flow
availability semantigi yeni kodlar uretiyor. Telefon sozlugunde bu kodlarin karsiligi yoktu,
yani kullanici ekranda ham Ingilizce sabit goruyordu.

Bu yama YALNIZCA gorunur sozlesmeyi ve kurulabilir kimligi ilerletir:
  * kontrol akisi enum'lari, karsilastirmalar ve emir yolu DEGISMEZ,
  * PC-only fail-closed sinir (ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY, /live/execute yok) korunur,
  * PC truth tazeligi 45 sn ve 3 ardisik hata kurali korunur (15 sn'ye ASLA donulmez),
  * panel yetkisi (marj / kaldirac / max pozisyon / LIVE ac-kapa) oldugu gibi birakilir.
"""
from pathlib import Path
import re

MARKER = "V95123_ANDROID_R2543_CONTRACT"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
AUTO = JAVA / "AutoTradeEngine.java"
TRUTH = JAVA / "V95113PcTruth.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, AUTO, TRUTH, BUILD):
    if not p.exists():
        raise SystemExit("R2543 missing required file: " + str(p))

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
auto = AUTO.read_text(encoding="utf-8")
truth = TRUTH.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

required = [
    ("R2542 UI1 identity", "v9.5.116-JEV-PC-ONLY-R2542-UI1" in main),
    ("R2542 professional UI base", "V95123_PRO_UI_R2542" in main and "V95123_PRO_UI_R2542" in card),
    ("PC-only client", "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client),
    ("no live execute post", 'post(c, "/live/execute", intent, true)' not in client),
    ("direct runner inert", "historical PHONE Binance executor permanently inert" in auto),
    ("45s truth", "FRESH_MS = 45000L" in truth),
    ("3 fail truth", "MIN_FAILURES_BEFORE_UNHEALTHY = 3" in truth),
    ("panel authority", "maxOpenPositions" in client and "marginQuote" in client and "leverage" in client),
    ("arm from phone", '"/live/arm"' in client and '"/live/disarm"' in client),
]
bad = [name for name, ok in required if not ok]
if bad:
    raise SystemExit("R2543 safety prerequisite missing: " + ", ".join(bad))

# --- kurulabilir kimlik -------------------------------------------------------
main = main.replace("v9.5.116-JEV-PC-ONLY-R2542-UI1", "v9.5.116-JEV-PC-ONLY-R2543", 1)
main = main.replace(
    "R2541 ANDROID GÜVENLİĞİ:",
    "R2543 ANDROID GÜVENLİĞİ: PC tek emir yürütücüsü • marj/kaldıraç/max pozisyon ve LIVE bu telefondan ayarlanır • emir PC'den gider • risk tavanı aşılırsa işlem hiç açılmaz •",
    1,
)
if "R2541 PC-ONLY FAIL-CLOSED • TÜRKÇE DURUM" in card:
    card = card.replace(
        "R2541 PC-ONLY FAIL-CLOSED • TÜRKÇE DURUM",
        "R2543 PC-ONLY FAIL-CLOSED • TÜRKÇE DURUM • GRAFİK OKUMA BEYNİ",
        1,
    )
if "PC R2541 ATOMİK AYNA • ANDROID PC-ONLY FAIL-CLOSED" in client:
    client = client.replace(
        "PC R2541 ATOMİK AYNA • ANDROID PC-ONLY FAIL-CLOSED",
        "PC R2543 ATOMİK AYNA • DETERMİNİSTİK GRAFİK OKUMASI • ANDROID PC-ONLY FAIL-CLOSED",
        1,
    )

# --- R2542/R2543 gorunur sozluk ----------------------------------------------
# DIKKAT: .replace zinciri alt-dizge eslestirir; UZUN kod ONCE gelmeli
# (JEV_PARTIAL_THEN_EXTERNAL_CLOSE, EXTERNAL_CLOSE'dan once).
ui_anchor = '        s=s.replace("WAIT_PULLBACK","GERİ ÇEKİLME BEKLENİYOR")'
if ui_anchor not in card:
    raise SystemExit("R2543 AutoDecisionCard trText anchor missing")

ui_lines = '''        s=s.replace("JEV_PARTIAL_THEN_EXTERNAL_CLOSE","JEV KISMİ ÇIKIŞ + DIŞARIDA KAPANDI")
             .replace("RISK_CAP_BELOW_EXCHANGE_MINIMUM","RİSK TAVANINA UYAN MİKTAR BORSA MİNİMUMUNUN ALTINDA — EMİR AÇILMADI")
             .replace("USER_PANEL_EXACT_WITHIN_CONFIGURED_RISK_CAP","PANEL AYARI AYNEN — RİSK TAVANI İÇİNDE")
             .replace("TRADE_RISK_CAP_EXCEEDED","İŞLEM RİSK TAVANI AŞILDI — EMİR AÇILMADI")
             .replace("CONFIGURED_RISK_CAP_BINDING","YAPILANDIRILAN RİSK TAVANI BAĞLAYICI")
             .replace("JEV_PARTIAL_TAKE_PROFIT","JEV KISMİ KÂR ALMA")
             .replace("JEV_EXIT_NOW","JEV HEMEN ÇIKIŞ")
             .replace("EXTERNAL_CLOSE","BRAINHUB DIŞINDA KAPANDI (KULLANICI/BORSA)")
             .replace("USER_MANUAL","KULLANICI MANUEL KAPATTI")
             .replace("OTHER_CLOSE","DİĞER KAPANIŞ — NEDEN DOĞRULANMADI")
             .replace("TP1_RUNNER_TRAIL","TP1 + İZ SÜREN")
             .replace("TP1_BREAKEVEN","TP1 + BAŞABAŞ")
             .replace("TP1_THEN_STOP","TP1 SONRA STOP")
             .replace("STOP_LOSS","STOP")
             .replace("TAKE_PROFIT","HEDEF")
             .replace("UNKNOWN_TRADE_AGE","İŞLEM YAŞI BİLİNMİYOR")
             .replace("NO_TRADE_SAMPLE","İŞLEM ÖRNEĞİ YOK")
             .replace("STALE_STREAM","AKIŞ ESKİ")
             .replace("NO_CVD_VALUE","CVD DEĞERİ YOK")
             .replace("MIN_QTY_REQUIRED","BORSA MİNİMUM MİKTARI")
             .replace("MIN_NOTIONAL","BORSA MİNİMUM TUTARI");
'''
card = card.replace(ui_anchor, ui_lines + ui_anchor, 1)

main += "\n// " + MARKER + "\n// UI_TR_R2543 exit/risk/orderflow sozlugu AutoDecisionCard.trText icine eklendi\n"
card += "\n// " + MARKER + "\n"

# --- kurulabilir surum --------------------------------------------------------
build = re.sub(r"versionCode\s+\d+", "versionCode 26092703", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.116-r2543'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

card_now = CARD.read_text(encoding="utf-8")
main_now = MAIN.read_text(encoding="utf-8")
client_now = CLIENT.read_text(encoding="utf-8")
truth_now = TRUTH.read_text(encoding="utf-8")
build_now = BUILD.read_text(encoding="utf-8")

checks = {
    "marker": MARKER in main_now,
    "identity": "v9.5.116-JEV-PC-ONLY-R2543" in main_now,
    "version": "versionName '9.5.116-r2543'" in build_now and "versionCode 26092703" in build_now,
    # guvenlik siniri degismedi
    "client blocked": "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client_now,
    "no live execute post": 'post(c, "/live/execute", intent, true)' not in client_now,
    "direct runner inert": "historical PHONE Binance executor permanently inert" in AUTO.read_text(encoding="utf-8"),
    "truth 45s": "FRESH_MS = 45000L" in truth_now,
    "truth 3 fail": "MIN_FAILURES_BEFORE_UNHEALTHY = 3" in truth_now,
    # panel yetkisi yerinde
    "panel authority": all(k in client_now for k in ("marginQuote", "leverage", "maxOpenPositions", "allowLong", "allowShort")),
    "arm from phone": '"/live/arm"' in client_now and '"/live/disarm"' in client_now,
    # yeni sozluk
    "exit tr": "JEV HEMEN ÇIKIŞ" in card_now and "KULLANICI MANUEL KAPATTI" in card_now and "BRAINHUB DIŞINDA KAPANDI (KULLANICI/BORSA)" in card_now,
    "risk cap tr": "İŞLEM RİSK TAVANI AŞILDI — EMİR AÇILMADI" in card_now and "RİSK TAVANINA UYAN MİKTAR BORSA MİNİMUMUNUN ALTINDA — EMİR AÇILMADI" in card_now,
    "order flow tr": "CVD DEĞERİ YOK" in card_now and "İŞLEM YAŞI BİLİNMİYOR" in card_now,
    # uzun kod kisa kodtan ONCE degistirilmeli
    "replace order": card_now.index('"JEV_PARTIAL_THEN_EXTERNAL_CLOSE"') < card_now.index('"EXTERNAL_CLOSE"'),
    # R2541 sozlugu bozulmadi
    "r2541 kept": "GERİ ÇEKİLME BEKLENİYOR" in card_now and "ŞİMDİ PİYASA GİRİŞİ" in card_now,
}
failed = [k for k, v in checks.items() if not v]
if failed:
    raise SystemExit("R2543 contract failed: " + ", ".join(failed))
print(MARKER + "_OK")
