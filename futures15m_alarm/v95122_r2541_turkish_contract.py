"""R2541 Android post-patch contract.

Runs after v95121_android_pc_only_fail_closed_r2539.py.
It keeps the R2539 PC-only fail-closed execution boundary intact and only advances
the installable identity / visible contract to the R2541 atomic-Turkish release.
"""
from pathlib import Path
import re

MARKER="V95122_ANDROID_R2541_TURKISH_CONTRACT"
APP=Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA=APP/"app/src/main/java/com/futuresalarm/app"
MAIN=JAVA/"MainActivity.java"
CARD=JAVA/"AutoDecisionCard.java"
CLIENT=JAVA/"BrainHubClient.java"
AUTO=JAVA/"AutoTradeEngine.java"
TRUTH=JAVA/"V95113PcTruth.java"
BUILD=APP/"app/build.gradle"

for p in (MAIN,CARD,CLIENT,AUTO,TRUTH,BUILD):
    if not p.exists():
        raise SystemExit("R2541 missing required file: "+str(p))

main=MAIN.read_text(encoding="utf-8")
card=CARD.read_text(encoding="utf-8")
client=CLIENT.read_text(encoding="utf-8")
auto=AUTO.read_text(encoding="utf-8")
truth=TRUTH.read_text(encoding="utf-8")
build=BUILD.read_text(encoding="utf-8")

required=[
    ("R2539 identity","v9.5.114-JEV-PC-ONLY-R2539" in main),
    ("PC-only client","ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client),
    ("direct runner inert","historical PHONE Binance executor permanently inert" in auto),
    ("15s truth","FRESH_MS = 15000L" in truth),
]
bad=[name for name,ok in required if not ok]
if bad:
    raise SystemExit("R2541 safety prerequisite missing: "+", ".join(bad))

main=main.replace("v9.5.114-JEV-PC-ONLY-R2539","v9.5.115-JEV-PC-ONLY-R2541-HF1",1)
main=main.replace(
    "R2539 ANDROID SAFETY:",
    "R2541 ANDROID GÜVENLİĞİ: PC tek emir yürütücüsü • telefon kontrol + telemetri • LIVE durumu PC teyitli • durum eski/ulaşılamazsa BİLİNMİYOR •",
    1
)
if "R2539 PC-ONLY FAIL-CLOSED" in card:
    card=card.replace("R2539 PC-ONLY FAIL-CLOSED","R2541 PC-ONLY FAIL-CLOSED • TÜRKÇE DURUM",1)

if "PC R2538 LIVE MIRROR • ANDROID PC-ONLY FAIL-CLOSED" in client:
    client=client.replace(
        "PC R2538 LIVE MIRROR • ANDROID PC-ONLY FAIL-CLOSED",
        "PC R2541 ATOMİK AYNA • ANDROID PC-ONLY FAIL-CLOSED",
        1
    )

# R2541-HF1 Android ana ekran Türkçe görünür metin onarımı.
# Yalnız görünür Java string/UI kopyasını değiştirir; emir enumları ve kontrol akışı değişmez.
visible_replacements={
    'JEV R2534 FULL CORTEX + R2.5.3.2 SOVEREIGN FLOW:':'JEV R2534 TAM CORTEX + R2.5.3.2 BAĞIMSIZ JEV AKIŞI:',
    'FINAL AUTHORITY':'SON KARAR YETKİSİ',
    'scanner ATTENTION_ONLY':'tarayıcı YALNIZCA DİKKAT',
    'worker EVIDENCE_ONLY':'kanıt ajanı YALNIZCA KANIT',
    'workerlar yalnız EVIDENCE_ONLY':'kanıt ajanları yalnız YALNIZCA KANIT',
    'learning SHADOW':'öğrenme GÖLGE',
    'self-modify/auto-promotion':'kendi kendini değiştirme/otomatik terfi',
    'Phase-3 observer: READ_ONLY':'Aşama-3 gözlemci: SALT OKUNUR',
    'Phase-3 observer READ_ONLY':'Aşama-3 gözlemci SALT OKUNUR',
    'decision authority NONE':'karar yetkisi YOK',
    'evidence dispatch':'kanıt isteği',
    'R2.5.3.2 SOVEREIGN FLOW:':'R2.5.3.2 BAĞIMSIZ JEV AKIŞI:',
    '5m LONG/SHORT scalp':'5 dk ALIŞ/SATIŞ scalp',
    '15m LONG/SHORT trade':'15 dk ALIŞ/SATIŞ ana işlem',
    'LONG/SHORT/WAIT':'ALIŞ/SATIŞ/BEKLE',
    'hard-15m':'zorunlu-15dk',
    'identity/freshness/range/nonblank':'kimlik/tazelik/aralık/boş-değil',
    'numeric conflict → Binance/BrainHub wins.':'sayısal çelişkide Binance/BrainHub verisi geçerlidir.',
    'target/partial/BE/trail':'hedef/kısmi/başabaş/iz sürme',
    'SHADOW teacher lesson':'GÖLGE öğretmen dersi',
    'Self-modify / auto-promotion yok.':'Kendi kendini değiştirme / otomatik terfi yok.',
    'R2532 ACTIVE:':'R2532 AKTİF:',
    'evidence request':'kanıt isteği',
    'hard safety only':'yalnız zorunlu güvenlik',
    'PC R2538 karar/uygulama beynidir':'PC BrainHub karar/yürütme merkezidir',
    'Android CONTROL/TELEMETRY only':'Android yalnız KONTROL/TELEMETRİ',
    'PC BrainHub R2538 JEV Live Mirror + R2537 complete context kullanır':'PC BrainHub R2541 atomik ayna + tam bağlam kullanır',
    'LIVE KAPAT yalnız PC armed=false + leaderAuto=false onayıyla tamamlanmış sayılır':'LIVE KAPAT yalnız PC LIVE kapalı + OTO lider kapalı onayıyla tamamlanmış sayılır',
    'stale bağlantı':'eski/ulaşılamayan bağlantı',
    ' • LONG SHORT':' • ALIŞ (LONG) SATIŞ (SHORT)',
    'LONG otomatik işlemlere izin ver':'ALIŞ (LONG) otomatik işlemlere izin ver',
    'SHORT otomatik işlemlere izin ver':'SATIŞ (SHORT) otomatik işlemlere izin ver',
    'ÖĞRENİM: LEARNING_V=':'ÖĞRENİM: ÖĞRENME_SÜRÜMÜ=',
    ' CLOSED=':' KAPANAN=',
    ' WINS=':' KAZANAN=',
    ' WINRATE=':' KAZANMA_ORANI=',
    ' AVG_SIGNAL_PCT=':' ORT_SİNYAL_YÜZDESİ=',
    ' RECENT_TRADES=':' SON_İŞLEMLER=',
    ' RECENT_CHAT_TOPICS=':' SON_SOHBET_KONULARI=',
    ' RULE=':' KURAL=',
    'hard risk kurallarını':'zorunlu risk kurallarını',
    'TRADE AJANI • FREE-FIRST':'İŞLEM AJANI • ÖNCE ÜCRETSİZ',
    'FREE-ONLY mod':'YALNIZCA ÜCRETSİZ mod',
    '15m long/short senaryosu nedir?':'15 dk alış/satış senaryosu nedir?',
    'trade fikri ver':'işlem fikri ver',
}
for old,new in visible_replacements.items():
    main=main.replace(old,new)
    card=card.replace(old,new)
    client=client.replace(old,new)
# R2541 Android UI timing/setup dictionary: presentation-only, control-flow enumları değişmez.
ui_anchor='        s=s.replace("LEADER_AUTO_BLOCKED","OTO İŞLEM GÜVENLİK NEDENİYLE DURDU")'
if ui_anchor not in card:
    raise SystemExit("R2541 AutoDecisionCard trText anchor missing")
ui_lines='''        s=s.replace("WAIT_PULLBACK","GERİ ÇEKİLME BEKLENİYOR")
             .replace("WAIT_STRUCTURE_CLOSE","YAPI KAPANIŞI BEKLENİYOR")
             .replace("MARKET_NOW","ŞİMDİ PİYASA GİRİŞİ")
             .replace("BREAKOUT_RETEST","KIRILIM + GERİ TEST")
             .replace("MOMENTUM_CONTINUATION","MOMENTUM DEVAMI")
             .replace("STRUCTURAL_REVERSAL","YAPISAL DÖNÜŞ")
             .replace("EVIDENCE_ONLY","YALNIZCA KANIT TOPLAMA")
             .replace("ATTENTION_ONLY","YALNIZCA DİKKAT")
             .replace("HARD_SAFETY_READY","ZORUNLU GÜVENLİK HAZIR")
             .replace("DAILY_LOSS_CAP_REACHED","GÜNLÜK ZARAR TAVANI DOLDU");
'''
card=card.replace(ui_anchor,ui_lines+ui_anchor,1)
card=card.replace("OTO KARAR MERKEZİ • LONG (YÜKSELİŞ) / SHORT (DÜŞÜŞ)","OTO KARAR MERKEZİ • ALIŞ (LONG) / SATIŞ (SHORT)",1)
# R2541 Android UI timing/setup dictionary

# User-visible state words only in known UI literals; execution enums remain unchanged.
ui_replacements={
    "WAIT_PULLBACK":"GERİ ÇEKİLME BEKLENİYOR",
    "WAIT_STRUCTURE_CLOSE":"YAPI KAPANIŞI BEKLENİYOR",
    "MARKET_NOW":"ŞİMDİ PİYASA GİRİŞİ",
    "BREAKOUT_RETEST":"KIRILIM + GERİ TEST",
    "MOMENTUM_CONTINUATION":"MOMENTUM DEVAMI",
    "STRUCTURAL_REVERSAL":"YAPISAL DÖNÜŞ",
}
# Do not mutate control-flow comparisons. Add a visible dictionary marker for UI renderers.
main += "\n// "+MARKER+"\n// UI_TR_R2541 "+repr(ui_replacements)+"\n"
card += "\n// "+MARKER+"\n"

build=re.sub(r"versionCode\s+\d+","versionCode 26092503",build,count=1)
build=re.sub(r"versionName\s+[\"'][^\"']+[\"']","versionName '9.5.115-r2541-hf1'",build,count=1)

MAIN.write_text(main,encoding="utf-8")
CARD.write_text(card,encoding="utf-8")
CLIENT.write_text(client,encoding="utf-8")
BUILD.write_text(build,encoding="utf-8")

checks={
    "marker":MARKER in MAIN.read_text(encoding="utf-8"),
    "identity":"v9.5.115-JEV-PC-ONLY-R2541-HF1" in MAIN.read_text(encoding="utf-8"),
    "client blocked":"ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in CLIENT.read_text(encoding="utf-8"),
    "no live execute post":'post(c, "/live/execute", intent, true)' not in CLIENT.read_text(encoding="utf-8"),
    "direct runner inert":"historical PHONE Binance executor permanently inert" in AUTO.read_text(encoding="utf-8"),
    "truth 15s":"FRESH_MS = 15000L" in TRUTH.read_text(encoding="utf-8"),
    "version":"versionName '9.5.115-r2541-hf1'" in BUILD.read_text(encoding="utf-8") and "versionCode 26092503" in BUILD.read_text(encoding="utf-8"),
    "ui timing Turkish":"GERİ ÇEKİLME BEKLENİYOR" in CARD.read_text(encoding="utf-8") and "ŞİMDİ PİYASA GİRİŞİ" in CARD.read_text(encoding="utf-8") and "KIRILIM + GERİ TEST" in CARD.read_text(encoding="utf-8"),
    "ui direction Turkish":"OTO KARAR MERKEZİ • ALIŞ (LONG) / SATIŞ (SHORT)" in CARD.read_text(encoding="utf-8"),
    "client release banner":"PC R2541 ATOMİK AYNA • ANDROID PC-ONLY FAIL-CLOSED" in CLIENT.read_text(encoding="utf-8"),
}
failed=[k for k,v in checks.items() if not v]
if failed:
    raise SystemExit("R2541 contract failed: "+", ".join(failed))
print(MARKER+"_OK")
