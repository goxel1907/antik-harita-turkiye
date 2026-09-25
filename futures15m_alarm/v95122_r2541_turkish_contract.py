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
AGENT=JAVA/"TradeAgentActivity.java"
LEARN=JAVA/"BrainLearning.java"
BUILD=APP/"app/build.gradle"

for p in (MAIN,CARD,CLIENT,AUTO,TRUTH,AGENT,LEARN,BUILD):
    if not p.exists():
        raise SystemExit("R2541 missing required file: "+str(p))

main=MAIN.read_text(encoding="utf-8")
card=CARD.read_text(encoding="utf-8")
client=CLIENT.read_text(encoding="utf-8")
auto=AUTO.read_text(encoding="utf-8")
truth=TRUTH.read_text(encoding="utf-8")
agent=AGENT.read_text(encoding="utf-8")
learn=LEARN.read_text(encoding="utf-8")
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

main=main.replace("v9.5.114-JEV-PC-ONLY-R2539","v9.5.115-JEV-PC-ONLY-R2541-HF4",1)
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

# R2541-HF4 Android ana ekran Türkçe görünür metin onarımı.
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
    agent=agent.replace(old,new)
    learn=learn.replace(old,new)

# R2541_HF3_BINANCE_TIME_SYNC
# Android hesabı read-only senkronunda telefon saati/ağ gecikmesi recvWindow dışına çıkmasın.
# Emir başlatma sınırı değişmez; yalnız legacy signed account read timestamp üretimi sağlamlaştırılır.
if 'private volatile long v9522TimeOffset = 0L;' in main and 'v9522TimeSyncAt' not in main:
    main=main.replace(
        'private volatile long v9522TimeOffset = 0L;',
        'private volatile long v9522TimeOffset = 0L;\n    private volatile long v9522TimeSyncAt = 0L;',
        1
    )

signed_old='''        if (signed) {
            String[] cr = v9522Credentials(); apiKey = cr[0]; secret = cr[1];
            p.put("recvWindow", "5000");
            p.put("timestamp", Long.toString(System.currentTimeMillis() + v9522TimeOffset));
        }'''
signed_new='''        if (signed) {
            long v2541Now=System.currentTimeMillis();
            if(v9522TimeSyncAt<=0L || v2541Now-v9522TimeSyncAt>30000L){
                try{ v9522SyncTime(); }catch(Throwable ignored){}
            }
            String[] cr = v9522Credentials(); apiKey = cr[0]; secret = cr[1];
            p.put("recvWindow", "10000");
            p.put("timestamp", Long.toString(System.currentTimeMillis() + v9522TimeOffset));
        }'''
if signed_old in main:
    main=main.replace(signed_old,signed_new,1)

sync_old='''    private void v9522SyncTime() throws Exception {
        String b = v9522Http("GET", "/fapi/v1/time", null, false);
        long server = new org.json.JSONObject(b).getLong("serverTime");
        v9522TimeOffset = server - System.currentTimeMillis();
    }'''
sync_new='''    private void v9522SyncTime() throws Exception {
        long t0=System.currentTimeMillis();
        String b = v9522Http("GET", "/fapi/v1/time", null, false);
        long t1=System.currentTimeMillis();
        long server = new org.json.JSONObject(b).getLong("serverTime");
        long midpoint=t0+((t1-t0)/2L);
        v9522TimeOffset = server - midpoint;
        v9522TimeSyncAt = t1;
    }'''
if sync_old in main:
    main=main.replace(sync_old,sync_new,1)

# PC'den gelen bütçe kilidi kullanıcıya ham enum yerine anlaşılır Türkçe görünsün.
# Tam satıra bağlı olma: patch zincirindeki küçük format farklarında da çalışır.
budget_tr='JEV GÜNLÜK ÜCRETLİ KARAR BÜTÇESİ DOLDU'
if budget_tr not in main:
    main,budget_hits=re.subn(
        r'append\(lastPcReasons\.trim\(\)\)',
        'append(lastPcReasons.trim().replace("JEV_DAILY_BUDGET_EXHAUSTED","'+budget_tr+'"))',
        main
    )
    if budget_hits < 1:
        raise SystemExit("R2541 budget reason UI anchor missing")

# Öğrenim özeti BrainLearning.java tarafından dinamik üretilir.
# Parça bazlı dönüşüm sırası bağımsızdır; önceki genel çeviriler uygulanmış olsa da çalışır.
learning_keys={
    "LEARNING_V=":"ÖĞRENME_SÜRÜMÜ=",
    "CLOSED=":"KAPANAN=",
    "WINS=":"KAZANAN=",
    "WINRATE=":"KAZANMA_ORANI=",
    "AVG_SIGNAL_PCT=":"ORT_SİNYAL_YÜZDESİ=",
    "RECENT_TRADES=":"SON_İŞLEMLER=",
    "RECENT_CHAT_TOPICS=":"SON_SOHBET_KONULARI=",
    "RULE=":"KURAL=",
    "hard risk kurallarını":"zorunlu risk kurallarını",
}
for old,new in learning_keys.items():
    learn=learn.replace(old,new)

# Ücretsiz ajan ayrı TradeAgentActivity.java dosyasındadır.
agent=agent.replace("🧠 TRADE AJANI • FREE-FIRST","🧠 İŞLEM AJANI • ÖNCE ÜCRETSİZ")
agent=agent.replace("FREE-ONLY mod","YALNIZCA ÜCRETSİZ mod")
agent=agent.replace("FREE-ONLY • ","YALNIZCA ÜCRETSİZ • ")
agent=agent.replace("FREE-ONLY kilidi açıktır","YALNIZCA ÜCRETSİZ kilidi açıktır")
agent=agent.replace("FREE-ONLY hazır","YALNIZCA ÜCRETSİZ hazır")
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

build=re.sub(r"versionCode\s+\d+","versionCode 26092506",build,count=1)
build=re.sub(r"versionName\s+[\"'][^\"']+[\"']","versionName '9.5.115-r2541-hf4'",build,count=1)

MAIN.write_text(main,encoding="utf-8")
CARD.write_text(card,encoding="utf-8")
CLIENT.write_text(client,encoding="utf-8")
AGENT.write_text(agent,encoding="utf-8")
LEARN.write_text(learn,encoding="utf-8")
BUILD.write_text(build,encoding="utf-8")

checks={
    "marker":MARKER in MAIN.read_text(encoding="utf-8"),
    "identity":"v9.5.115-JEV-PC-ONLY-R2541-HF4" in MAIN.read_text(encoding="utf-8"),
    "client blocked":"ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in CLIENT.read_text(encoding="utf-8"),
    "no live execute post":'post(c, "/live/execute", intent, true)' not in CLIENT.read_text(encoding="utf-8"),
    "direct runner inert":"historical PHONE Binance executor permanently inert" in AUTO.read_text(encoding="utf-8"),
    "truth stable grace":"FRESH_MS = 45000L" in TRUTH.read_text(encoding="utf-8") and "MIN_FAILURES_BEFORE_UNHEALTHY = 3" in TRUTH.read_text(encoding="utf-8") and "shouldMarkProbeUnhealthy" in TRUTH.read_text(encoding="utf-8"),
    "version":"versionName '9.5.115-r2541-hf4'" in BUILD.read_text(encoding="utf-8") and "versionCode 26092506" in BUILD.read_text(encoding="utf-8"),
    "ui timing Turkish":"GERİ ÇEKİLME BEKLENİYOR" in CARD.read_text(encoding="utf-8") and "ŞİMDİ PİYASA GİRİŞİ" in CARD.read_text(encoding="utf-8") and "KIRILIM + GERİ TEST" in CARD.read_text(encoding="utf-8"),
    "ui direction Turkish":"OTO KARAR MERKEZİ • ALIŞ (LONG) / SATIŞ (SHORT)" in CARD.read_text(encoding="utf-8"),
    "client release banner":"PC R2541 ATOMİK AYNA • ANDROID PC-ONLY FAIL-CLOSED" in CLIENT.read_text(encoding="utf-8"),
    "main status Turkish":"BAĞIMSIZ JEV AKIŞI" in MAIN.read_text(encoding="utf-8") and "SON KARAR YETKİSİ" in MAIN.read_text(encoding="utf-8") and "YALNIZCA DİKKAT" in MAIN.read_text(encoding="utf-8"),
    "learning Turkish":"ÖĞRENME_SÜRÜMÜ=1 KAPANAN=" in LEARN.read_text(encoding="utf-8") and "KAZANMA_ORANI" in LEARN.read_text(encoding="utf-8") and "SON_İŞLEMLER" in LEARN.read_text(encoding="utf-8"),
    "agent Turkish":"İŞLEM AJANI • ÖNCE ÜCRETSİZ" in AGENT.read_text(encoding="utf-8") and "YALNIZCA ÜCRETSİZ mod" in AGENT.read_text(encoding="utf-8"),
    "binance time sync hardening":"v9522TimeSyncAt" in MAIN.read_text(encoding="utf-8") and 'p.put("recvWindow", "10000")' in MAIN.read_text(encoding="utf-8") and "long midpoint=t0+((t1-t0)/2L);" in MAIN.read_text(encoding="utf-8"),
    "budget reason Turkish":"JEV GÜNLÜK ÜCRETLİ KARAR BÜTÇESİ DOLDU" in MAIN.read_text(encoding="utf-8"),
}
failed=[k for k,v in checks.items() if not v]
if failed:
    raise SystemExit("R2541 contract failed: "+", ".join(failed))
print(MARKER+"_OK")
