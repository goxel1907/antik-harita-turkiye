"""R2544.35: isolate PC heartbeat, separate auxiliary work, current UI contract.
Source-generation patch after V95130; never enables phone order execution.
"""
from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
CLIENT=JAVA/'BrainHubClient.java'
PACK=JAVA/'AnalysisPackActivity.java'
MARKER='V95131_R2544_35_PC_SYNC_UI'

def replace(s,old,new):
    if old not in s: raise SystemExit('R35 anchor missing: '+old[:90])
    return s.replace(old,new,1)

main=MAIN.read_text(encoding='utf-8')
client=CLIENT.read_text(encoding='utf-8')
pack=PACK.read_text(encoding='utf-8')
if 'V95130_R2544_33_BRAINHUB_8443' not in client: raise SystemExit('R35 requires R33')
if MARKER in main: raise SystemExit('R35 already applied')
client=replace(client,'conn.setReadTimeout(path.equals("/live/execute") ? 120000 : 22000);','conn.setReadTimeout(path.equals("/health") || path.startsWith("/live/status") ? 8000 : 22000);')
client=replace(client,'        try { syncAttentionSnapshot(c,new JSONObject(V9542AttentionRadar.latestJson(c))); } catch(Throwable ignored) {}\n','')
client=replace(client,'JSONObject status=get(c, "/live/status");','JSONObject status=get(c, "/live/status?compact=1");')
client=client.replace('hazır • SON KARAR YETKİSİ • R2.5.3.2 SOVEREIGN • PC R2543 ATOMİK AYNA • DETERMİNİSTİK GRAFİK OKUMASI • ANDROID PC-ONLY FAIL-CLOSED','hazır • SON KARAR JEV • GÜNCEL PC DURUMU • TELEFON KONTROL/İZLEME')
client=client.replace('if(out.optInt("_httpStatus",200)<400){','if(out.optInt("_httpStatus",200)<400&&out.optBoolean("ok",false)){')
client=replace(client,'        JSONObject burst=new JSONObject();\n        try { burst=get(c, "/live/burst"); } catch(Throwable ignored) {}\n','')
client=replace(client,'.putString("r2544_29_burst",burst.toString()).apply();','.apply();')
anchor='    // V95128 read-only BURST telemetry.'
aux='''    // R35 optional network work cannot delay the PC heartbeat.
    public static void refreshAuxTelemetry(Context c) {
        try { syncAttentionSnapshot(c,new JSONObject(V9542AttentionRadar.latestJson(c))); } catch(Throwable ignored) {}
        try { JSONObject burst=get(c,"/live/burst");
            c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE).edit()
                .putString("r2544_29_burst",burst.toString()).putLong("r2544_35_burst_at",System.currentTimeMillis()).apply();
        } catch(Throwable ignored) {}
    }
'''
client=replace(client,anchor,aux+anchor)
start=main.index('    private void v9582MaybeProbePcLive(){')
end=main.index('    private String v9582Age(',start)
probe=main[start:end]
probe=replace(probe,'        v9522Io.execute(()->{','        v95131PcIo.execute(()->{')
a=probe.index('                if(now-sp.getLong("v9588_pc_auto_sync_ts"')
b=probe.index('            }catch(Throwable e){',a)
auxbody=probe[a:b]
probe=probe[:a]+'                v95131MaybeRefreshAux();\n'+probe[b:]
main=main[:start]+probe+main[end:]
fields='''    private final java.util.concurrent.ExecutorService v95131PcIo=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService v95131AuxIo=java.util.concurrent.Executors.newSingleThreadExecutor();
    private volatile boolean v95131AuxBusy=false;
    private volatile long v95131AuxAt=0L;
    private void v95131MaybeRefreshAux(){
        final long now=System.currentTimeMillis();
        if(v95131AuxBusy||now-v95131AuxAt<10000L)return;
        v95131AuxBusy=true;v95131AuxAt=now;
        v95131AuxIo.execute(()->{
            android.content.SharedPreferences sp=v9522Prefs();
            try {
'''+auxbody+'''
                BrainHubClient.refreshAuxTelemetry(this);
            } finally {v95131AuxBusy=false;}
        });
    }
'''
main=replace(main,'    private volatile long v9582PcProbeAt=0L;',fields+'\n    private volatile long v9582PcProbeAt=0L;')
main=re.sub(r'TextView info=text\("CANLI OTO mod.*?BrainLearning\.summary\(this\),', 'TextView info=text(V95131CurrentContract.pcSummary(sp),', main, count=1)
main=replace(main,'String last=sp.getString("v9576_auto_last_status","Henüz oto işlem yok.");','String last=V95113PcTruth.label(sp,System.currentTimeMillis());')
main=main.replace('BINANCE API / EMİR\\nAnahtar ve işlem ayarları','BINANCE VERİ BAĞLANTISI\\nHesap izlemesi • emir PC üzerinden')
main=main.replace('⚡ HIZLI EMİR AYARI\\nMarj / kaldıraç kaydet • geç giriş kilidi %0,50','⚡ PC İŞLEM AYARLARI\\nMarj / kaldıraç / sınır • PC onayı gerekir')
# Retired quick-order preferences must not masquerade as PC exposure settings.
a=main.index('    private void v9543cShowQuickSettings(){')
b=main.index('    private void v9543cClearQuickApproval(',a)
main=main[:a]+'''    private void v9543cShowQuickSettings(){
        v9576ShowAutoSettings();
    }

'''+main[b:]
main=replace(main,'" USDT • 24s uygulama net ≈ " + v9527Money(realized24 - comm24) + " USDT" +\n                " • kayıt açık/kapalı " + appOpen + "/" + appClosed;',
             '" USDT • kapanışlar ve net sonuç: PC pozisyon defteri";')
main=replace(main,'"\\n\\n24 SAAT • UYGULAMA İŞLEMLERİ\\n" + v9527TradeLedgerText() +',
             '"\\n\\nKapanışlar, komisyonlar ve öğrenme: aşağıdaki PC defteri ve İşlem Merkezi. Telefonun eski işlem kayıtları PC performansı değildir." +')
main=replace(main,'v9527AccountSummary + "\\n" + v9527LedgerCompact() + "\\n🔔 " + v9527SignalsCompact();',
             'v9527AccountSummary + "\\n" + V95113PcTruth.label(v9522Prefs(),System.currentTimeMillis());')
main=main.replace('İZLENEN PLANLAR  •  MANUEL PRO','KAYITLI HARİCİ PLANLAR • SALT İZLEME')
old='Planlar yalnız yapıştırdığınız ChatGPT analiz kodundan gelir. Dinamik retest: eski kırılım noktasına birebir temas şart değil; plan kodundaki giriş koridoru en güçlü güncel yapısal kümeyi temsil eder.\\nKritik alarm: tamamlanmış 15 dk teyidi + geçerli giriş + canlı akış • API emri yalnız kullanıcı onayıyla.'
main=replace(main,old,'Bu bölüm harici analizden kaydettiğiniz planları izler. PC/JEV planları İşlem Merkezi kartındadır. Telefonda emir yürütme kapalıdır; manuel Binance işlemleri PC defterinde görüldüğünde harici pozisyon olarak izlenir.')
main=main.replace('ANA ANALİZ PROMPTU\\nPanoya kopyala','GÜNCEL HARİCİ ANALİZ PROMPTU\\nPC/JEV sözleşmesi • panoya kopyala')
main=main.replace('ANALİZ PAKETİ\\n8 zaman dilimi • 3m / 5m / 15m / 30m / 45m / 1h / 4h / 1D','HARİCİ ANALİZ PAKETİ\\nGüncel veri • PC bağlamı varsa eklenir')
main=main.replace('9 coin • TOP 3 + 6 güçlü aday • teknik + katalizör','Telefon keşif listesi • PC/JEV kısa listesi ayrıdır')
main=main.replace('9 coin • TOP 3 + 6 güçlü aday • dokun: aç','Telefon keşif listesi • dokun: ayrıntı')
main=main.replace('s.append("\\nDokun: Çok Konuşulan • Erken Pozitif • Erken Risk");',
                  's.append("\\n").append(BrainHubClient.attentionSyncLabel(this)).append(" • emir/sinyal değildir");')
client=replace(client,anchor,'''    public static String attentionSyncLabel(Context c){
        SharedPreferences p=prefs(c);long at=p.getLong("attention_sync_at",0L);
        long src=p.getLong("attention_sync_source_at",0L);
        try {long current=new JSONObject(V9542AttentionRadar.latestJson(c)).optLong("updatedAt",0L);
            if(at>0L&&System.currentTimeMillis()-at<=90000L&&current>0L&&src==current)
                return "Keşif PC tarafından alındı; JEV için dikkat bağlamı";
        } catch(Exception ignored) {}
        return "Keşif PC aktarımı bekleniyor / doğrulanamadı";
    }
'''+anchor)
a=main.index('    private void copyAnalysisPrompt() {')
b=main.index('    private void confirmDelete(',a)
main=main[:a]+'''    private void copyAnalysisPrompt() {
        String prompt=V95131CurrentContract.prompt();
        ClipboardManager cb=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        if(cb!=null)cb.setPrimaryClip(ClipData.newPlainText("JEV güncel harici analiz sözleşmesi",prompt));
        Toast.makeText(this,"Güncel analiz sözleşmesi kopyalandı; emir yetkisi vermez.",Toast.LENGTH_LONG).show();
    }

'''+main[b:]
# Preserve current numerical candles, replace contradictory retired manual instructions.
a=pack.index('    private String buildPrompt(String symbol,')
b=pack.index('    private String get(String url)',a)
pack=pack[:a]+'''    private String buildPrompt(String symbol, Map<String, List<Candle>> data, Map<String, Candle> forming, Metrics m, long now) {
        StringBuilder sb=new StringBuilder(V95131CurrentContract.prompt());
        sb.append("\\nSYMBOL=").append(symbol).append(" • paket zamanı(ms)=").append(now);
        sb.append("\\nKaynak: telefon Binance herkese açık verisi; PC/JEV gönderilmiş karar paketi değildir. Eksik TF açıkça eksiktir.\\n");
        for(Map.Entry<String,List<Candle>> e:data.entrySet()){
            sb.append("\\nTF=").append(e.getKey()).append(" kapalı mumlar: openTime,closeTime,open,high,low,close,volume\\n");
            List<Candle> rows=e.getValue();
            for(int i=Math.max(0,rows.size()-72);i<rows.size();i++){
                Candle c=rows.get(i);sb.append(c.openTime).append(',').append(c.closeTime).append(',').append(c.open).append(',').append(c.high).append(',').append(c.low).append(',').append(c.close).append(',').append(c.volume).append('\\n');
            }
            Candle f=forming.get(e.getKey());if(f!=null)sb.append("FORMING teyit değildir: ").append(f.open).append('/').append(f.high).append('/').append(f.low).append('/').append(f.close).append('\\n');
        }
        sb.append("\\nKeşif: ").append(V9542AttentionRadar.promptContext(this,symbol));
        return sb.toString();
    }

'''+pack[b:]
pack=pack.replace('Uygulama Binance Futures herkese açık verisinden 15m / 5m / 3m / 1h / 4h / 1D son 100 TAMAMLANMIŞ mumu çeker; tek görsel + MASTER prompt + canlı teyit verilerini hazırlar.','Bu harici analiz ekranı telefonun güncel Binance verisini hazırlar; PC bağlantısı varsa PC bağlamı ayrıca eklenir. JEV karar paketi ve Office grafiği PC kaynaklıdır.')
helper='''package com.futuresalarm.app;
import android.content.SharedPreferences;
import org.json.JSONObject;
public final class V95131CurrentContract {
    private V95131CurrentContract() {}
    public static String pcSummary(SharedPreferences sp){
        long now=System.currentTimeMillis();
        String s="JEV son stratejik kararı verir; emirleri PC yürütür. Telefon kontrol ve salt izleme yapar. OTO kapatma PC onayıyla LIVE’ı da kapatır.\\n"+V95113PcTruth.label(sp,now);
        if(!V95113PcTruth.fresh(sp,now))return s+"\\nPC deneyim hafızası güncel alınamadı; yerel telefon kayıtları PC beyninin öğrenimi değildir.";
        try {JSONObject l=new JSONObject(sp.getString("v9599_learning","{}"));
            return s+"\\nPC deneyim hafızası: "+l.optInt("measuredSampleCount",0)+" ölçülmüş kapanış • "+l.optInt("jevLessonCount",0)+" JEV dersi. Öğrenme yumuşak bağlamdır; kod/strateji otomatik değişmez.";
        } catch(Exception e){return s+"\\nPC deneyim hafızası okunamadı.";}
    }
    public static String prompt(){return "R2544.35 GÜNCEL HARİCİ ANALİZ SÖZLEŞMESİ\\n"+
        "5m scalp ve 15m ana işlem ayrı hatlardır. 1m/3m zamanlama, 30m/45m/1h/4h/1d bağlamdır; 45m sentetiktir. TF oy sayımı, 2/3 kapısı ve zorunlu 15m teyidi stratejik veto değildir. Kapalı mum gerçeğini forming mumdan ayır. Eksik/eskimiş veriyi uydurma.\\n"+
        "Yön LONG/SHORT/BEKLE; setup ailesi, avantaj kaynağı ve giriş zamanlamasını ayrıca belirt. Şimdi piyasa girişi ile retest/beklemeyi ayır; yapısal stop ve hedeflerin yönünü, mesafesini ve ücretleri açıkla. Gözlenen tasfiyeler geçmiş veri; gelecekte gizli likidite iddiası değildir. Keşif puanı dikkat bağlamıdır, işlem onayı değildir.\\n"+
        "PC/JEV son stratejik otoritedir. Bu harici yorum emir yetkisi vermez. Telefon emir yürütmez. Hafıza kazanan/kaybeden karşı örnekleri içeren yumuşak bağlamdır; otomatik strateji/kod değişimi yoktur. Vur-kaç LONG/SHORT simetriktir; güvenli borsa üst sınırında kaldıraç, sabit kâr hedefi yerine JEV kâr değerlendirmesi ve zorunlu stop/süre koruması.\\n"+
        "İsteğe bağlı kayıtlı plan formatı: SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB|META\\n"+
        "LP=stop;tp1;tp2;tp3, LB=girisAlt;girisUst;stop;tp1;tp2;tp3, SR=stop;tp1;tp2;tp3, SB=girisAlt;girisUst;stop;tp1;tp2;tp3. Sayısal seviye yoksa kod üretme; bu kayıt PC oto planı değildir.\\n";}
}
'''
for p,s in [(MAIN,main),(CLIENT,client),(PACK,pack)]:p.write_text(s+'\n// '+MARKER+'\n',encoding='utf-8')
(JAVA/'V95131CurrentContract.java').write_text(helper,encoding='utf-8')
learning_path=JAVA/'BrainLearning.java'
learning=learning_path.read_text(encoding='utf-8')
a=learning.index('    public static String summary(Context c){')
learning=learning[:a]+'''    public static String summary(Context c){
        return V95131CurrentContract.pcSummary(app(c))+"\\nTelefon sohbet arşivi PC/JEV öğrenimi değildir; sohbetler otomatik strateji değişimi yapmaz.";
    }
}
'''
learning_path.write_text(learning,encoding='utf-8')
agent_path=JAVA/'TradeAgentActivity.java'
agent=agent_path.read_text(encoding='utf-8').replace('ÖĞRENİM HAFIZASI (geçmiş sinyal/sonuç + önceki ajan konuşmaları):','PC/JEV DENEYİM HAFIZASI (güncellik doğrulanır; telefon arşivi ayrı):')
agent_path.write_text(agent,encoding='utf-8')
build=APP/'app/build.gradle'
s=build.read_text(encoding='utf-8')
s=re.sub(r'versionCode\s+\d+','versionCode 26100402',s,count=1)
s=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.123-r2544.35-pc-sync-ui'",s,count=1)
build.write_text(s,encoding='utf-8')
assert 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client
assert 'FRESH_MS = 45000L' in (JAVA/'V95113PcTruth.java').read_text(encoding='utf-8')
assert ':8443' in client and 'post(c, "/live/execute", intent, true)' not in client
assert 'PC yürütücüsü eklendiğinde' not in main
assert 'BrainLearning.summary(this)' not in main[main.index('private void v9576ShowAutoSettings'):main.index('private volatile long v9582PcProbeAt')]
print(MARKER+'_OK')
