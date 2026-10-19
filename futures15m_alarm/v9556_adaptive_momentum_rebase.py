from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.56 missing: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    ins = inc = esc = lc = bc = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i+1] if i+1 < len(src) else ''
        if lc:
            if c == '\n': lc = False
        elif bc:
            if c == '*' and n == '/': bc = False; i += 1
        elif ins:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': ins = False
        elif inc:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": inc = False
        else:
            if c == '/' and n == '/': lc = True; i += 1
            elif c == '/' and n == '*': bc = True; i += 1
            elif c == '"': ins = True
            elif c == "'": inc = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)


# ---------------------------------------------------------------------------
# MASTER prompt: cumulative % move and distance from an OLD entry are never a
# direction veto. Re-anchor to fresh accepted structure, then compare competing
# continuation vs reversal hypotheses. This keeps the four hard vetoes only.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()

a = a.replace(
    'Fiyat textbook FVG/OB retestine dönmedi diye geçerli senaryoyu otomatik iptal etme; fakat giriş koridorundan kopmuş fiyatı da kovalamayın.',
    'Fiyat textbook FVG/OB retestine dönmedi diye geçerli senaryoyu otomatik iptal etme. Eski giriş koridoru artık geride kaldıysa bunu otomatik yasak sayma: güncel fiyat yeni tamamlanmış 3m/5m/15m yapıda REBASE olmuşsa, yeni yapısal invalidation ve ileri gerçek hedeflerle yeterli R/R varsa continuation relay değerlendir. REBASE yoksa kör momentum takibi yapma.'
)
a = a.replace(
    "'Çok yükseldi -> SHORT' veya 'çok düştü -> LONG' mantığı yasaktır.",
    "Günlük/toplam yüzde değişim tek başına yön kararı değildir. +%20/+%50 yükselmiş coin hem daha fazla devam edebilir hem de dönebilir; çok yükseldi diye otomatik SHORT veya çok düştü diye otomatik LONG üretme, fakat gerçek reversal kanıtı baskınsa ters yönü de yasaklama."
)
a = a.replace(
    'sırf pahalı göründüğü için SHORT üretme.',
    'sırf pahalı göründüğü için SHORT üretme; fakat failed-auction + yapı kırılımı + long-crowding/exhaustion gibi bağımsız reversal aileleri baskınsa SHORT senaryosunu da engelleme.'
)
a = a.replace(
    'RETEST gelmezse alternatif yol ara; alternatif yol yoksa kovalamadan BEKLE.',
    'RETEST gelmezse alternatif yol ara. Eski anchor geride kaldıysa fresh REBASE ara; fresh REBASE oluşursa kümülatif yüzde hareket ne kadar büyük olursa olsun yeni yerel yapıdan tekrar değerlendir. REBASE de yoksa eski impulsu kör takip etmeden BEKLE.'
)

if 'V9.5.56 YASAK YERINE ADAPTIF REBASE' not in a:
    marker='        sb.append("V9.5.55 KARAR OTOMASYONU:'
    pos=a.find(marker)
    if pos < 0:
        raise SystemExit('v9.5.56 v9.5.55 automation anchor missing')
    end=a.find('\\n");',pos)
    if end < 0:
        raise SystemExit('v9.5.56 automation statement end missing')
    end += len('\\n");')
    rules=r'''
        sb.append("V9.5.56 YASAK YERINE ADAPTIF REBASE: Kümülatif +%20/+%50/+%100 yükseliş veya -%20/-50 düşüş, günlük değişim, RSI aşırılığı ya da eski giriş koridoruna uzaklık TEK BAŞINA continuation/reversal yasağı değildir. Fiyat yeni bir kabul tabanı, HL/LH, compression, sweep-reclaim, breakout-base veya tamamlanmış yeni 15m acceptance kurduğunda eski leg'in extension ölçümünü sıfırla ve REBASE_STATE=FRESH olarak güncel yapıya yeniden bağla. 'Pahalı/ucuz' yerine 'güncel anchor'a göre erken/geç' sorusunu cevapla.\n");
        sb.append("V9.5.56 IKI HIPOTEZ AYNI ANDA: Her coin için CONT_SCORE ve REV_SCORE'u 0-100 arası ayrı üret; biri diğerinin otomatik tersi değildir. CONT_SCORE: çoklu-TF yön sürekliliği, fresh acceptance/rebase, trend efficiency, ileri hedef boşluğu, uygun flow/crowding ve squeeze desteğinden gelir. REV_SCORE: failed-auction, karşı CHOCH/BOS, sweep sonrası kalıcı rejection, momentum/acceptance bozulması, karşı crowding ve HTF karşı bölgeden gelir. Aynı veri ailesini iki kez sayma. Yüzde yükseliş/düşüş yalnız bağlamdır, puan değildir. CONT belirgin baskınsa devam; REV belirgin baskınsa dönüş; ikisi yakın/yüksekse savaş alanı=BEKLE.\n");
        sb.append("V9.5.56 TREND EFFICIENCY / PATH QUALITY: Kaufman Efficiency Ratio mantığını yardımcı REGIME ölçüsü olarak kullanabilirsin: ER=|C_now-C_n| / sum(|delta C|). ER yüksekse hareket daha yönlü/az gürültülü, düşükse daha choppy olabilir. Evrensel sihirli eşik kullanma; mümkünse aynı coin ve TF'nin yakın geçmişine göre göreli/percentile yorumla. ER tek başına LONG/SHORT veya hard veto değildir. 5m ve 15m path quality, ATR-normalized slope, close persistence ve pullback derinliği birlikte trendin hala verimli olup olmadığını anlatır.\n");
        sb.append("V9.5.56 MOMENTUM RELAY: Eski LB/LP giriş kutusu kaçmış olsa bile ana 15m senaryo invalid olmadıysa ve fiyat FRESH REBASE kurduysa aynı yön fırsatı yeniden değerlendirilebilir. Yeni giriş eski fiyat kutusuna zorlanmaz; güncel 3m/5m/15m accepted structure, güncel yapısal STOP ve HALA ILERIDE olan yapısal hedeflerle R/R hesaplanır. Fresh rebase sonrası kısa bir displacement fiyatı eski entry'den daha uzağa taşımış diye sırf mesafe nedeniyle reddetme; drift'i ATR ve yeni anchor'a göre ölç.\n");
        sb.append("V9.5.56 REVERSAL RELAY: Çok yükselmiş TOP3 coin SHORT'a, çok düşmüş TOP3 coin LONG'a kapalı değildir. Countertrend ancak REV_SCORE gerçek bağımsız kanıtlarla güçlenirse açılır: örneğin HTF/15m karşı bölge + failed-auction/reclaim kaybı + tamamlanmış karşı yapı kırılımı + crowding/exhaustion uyumu. Sadece overbought/oversold, yüzde değişim veya tek wick yeterli değildir. Böylece hem +%50'den +%150'ye giden continuation hem de gerçek tepe/dip reversal ihtimali açık kalır.\n");
        sb.append("V9.5.56 EXTENSION RESET / LEG AGE: 'Hareket çok uzadı' değerlendirmesini gün başlangıcından değil son FRESH REBASE anchor'ından ATR cinsinden ölç. Yeni taban/compression/HL-LH ve kabul oluşunca leg age yeniden başlar; önceki yüzde kazanç cezası taşınmaz. Buna karşılık yeni anchor olmadan tek parabolik impuls sürüyorsa extension riskini artır; bu yön yasağı değil execution riskidir.\n");
        sb.append("V9.5.56 TARGET EXHAUSTION: Mevcut günlük planın TP1/TP2/TP3 hedefleri fiyatın tamamen arkasında kaldıysa model yeni hedef UYDURMASIN. Bu 'çok yükseldi, artık girme' yasağı değildir; mevcut haritanın hedef alanı tükenmiştir. META/WAIT'te MOMENTUM_RELAY_ANALYSIS_REQUIRED yaz ve fresh analiz iste. Yeni analiz yeni güncel yapısal hedefler ürettikten sonra continuation veya reversal yeniden serbestçe değerlendirilsin.\n");
        sb.append("V9.5.56 CROWDING YON DEGIL KUVVET CARPANI: OI/funding/taker/CVD/orderbook crowding yalnız yön kanıtıyla birlikte kuvvet çarpanıdır. Yükselen fiyat + rising OI + short-heavy funding + üstte acceptance continuation/squeeze lehine olabilir; yükselen fiyat + rising OI + aşırı long-heavy funding + failed-auction/rejection reversal lehine olabilir. Fakat positioning verisi eksik/çelişkiliyse fiyat yapısı tek başına otomatik iptal edilmez.\n");
        sb.append("V9.5.56 BASITLIK / OVERFIT KORUMASI: Yeni zekayı onlarca eşik ile boğma. Hard veto sayısı yine yalnız dört olsun. Diğer tüm özellikler soft score/bağlamdır; aynı aile en fazla bir oy etkisi taşır. Sabit yüzde yerine ATR/percentile/güncel yapı kullan. Bir özellik geçmiş iki kaybı açıklıyor diye kalıcı veto ekleme; ileriye dönük dry-run/backtest ile doğrulanmayan mikro kuralı çekirdeğe alma.\n");
        sb.append("V9.5.56 META EKLERI: 14 pipe alanını değiştirme. Mevcut META içine mümkünse REBASE_STATE=FRESH|STALE|NONE, CONT_SCORE=0-100, REV_SCORE=0-100, TREND_EFF=HIGH|MID|LOW|UNKNOWN, LEG_STATE=EARLY|MATURE|PARABOLIC|RESET, RELAY=CONTINUATION|REVERSAL|WAIT|ANALYSIS_REQUIRED ekle. Bunlar gözlenebilir veriden türetilir; eksikse UNKNOWN kullan.\n");
'''
    a=a[:end]+rules+a[end:]

ANALYSIS.write_text(a)

# ---------------------------------------------------------------------------
# Runtime: missed primary entry can use a fresh continuation REBASE without a
# textbook retest. The cumulative move is irrelevant. The anchor must be a fresh
# completed 5m close with independent structure/acceptance/regime evidence.
# Existing target geometry and hard STOP/RR/data vetoes stay authoritative.
# ---------------------------------------------------------------------------
m=MON.read_text()
if 'V9556_ADAPTIVE_MOMENTUM_REBASE' not in m:
    anchor='    private String v9521Norm(String x) {'
    if anchor not in m:
        anchor='    private String v953Decision(String symbol) {'
    idx=m.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.56 Monitor helper anchor missing')
    helper=r'''
    // ============================================================
    // V9556_ADAPTIVE_MOMENTUM_REBASE
    // A large cumulative move is never a veto. Re-anchor to current closed
    // structure. ER is a soft path-quality measure, not a direction signal.
    // ============================================================
    private double v9556Efficiency(java.util.List<V9525MiniCandle> a,int n) {
        if(a==null||a.size()<n+1||n<2) return Double.NaN;
        int e=a.size()-1,s=e-n;
        double net=Math.abs(a.get(e).c-a.get(s).c),path=0.0;
        for(int i=s+1;i<=e;i++) path+=Math.abs(a.get(i).c-a.get(i-1).c);
        return path>1e-12?Math.max(0.0,Math.min(1.0,net/path)):0.0;
    }

    private V9525Retest v9556ContinuationAnchor(java.util.List<V9525MiniCandle> a,boolean lng,double trigger) {
        V9525Retest r=new V9525Retest();
        if(a==null||a.size()<12) return r;
        int n=a.size(); V9525MiniCandle last=a.get(n-1);
        long age=System.currentTimeMillis()-last.closeTime;
        if(age<0||age>90000L) return r;
        double atr=v9525Atr(a,14); if(Double.isNaN(atr)||!(atr>0)) return r;
        double er=v9556Efficiency(a,8); if(Double.isNaN(er)) er=0.0;

        double priorHigh=-Double.MAX_VALUE,priorLow=Double.MAX_VALUE;
        for(int i=Math.max(0,n-5);i<n-1;i++){
            priorHigh=Math.max(priorHigh,a.get(i).h);
            priorLow=Math.min(priorLow,a.get(i).l);
        }
        boolean structure=lng?last.c>priorHigh:last.c<priorLow;
        double range=Math.max(1e-12,last.h-last.l);
        boolean body=lng?last.c>last.o:last.c<last.o;
        boolean closeQuality=lng?(last.c-last.l)/range>=0.62:(last.h-last.c)/range>=0.62;
        boolean acceptance=body&&closeQuality;

        double preRange=0.0; int rn=0;
        for(int i=Math.max(0,n-5);i<n-1;i++){preRange+=Math.max(0.0,a.get(i).h-a.get(i).l);rn++;}
        double preAvg=rn>0?preRange/rn:atr;
        boolean compressionBreak=preAvg<atr*0.95 && range>preAvg*1.10 && structure;
        boolean efficient=er>=0.45;
        int families=0;
        if(structure) families++;
        if(acceptance) families++;
        if(efficient||compressionBreak) families++;
        if(families<2 || !structure) return r;

        // Original 15m scenario still has to be on the correct side.
        if(lng && last.c<=trigger) return r;
        if(!lng && last.c>=trigger) return r;

        double local=lng?Double.MAX_VALUE:-Double.MAX_VALUE;
        for(int i=Math.max(0,n-7);i<n;i++) local=lng?Math.min(local,a.get(i).l):Math.max(local,a.get(i).h);
        double buffer=Math.max(atr*0.12,last.c*0.0006);
        double stop=lng?local-buffer:local+buffer;
        if(lng&&stop>=last.c) return r;
        if(!lng&&stop<=last.c) return r;

        r.ok=true;
        r.zoneLow=Math.min(last.l,last.c);
        r.zoneHigh=Math.max(last.h,last.c);
        r.stop=stop;
        r.label="5M CONTINUATION REBASE: fresh structure + acceptance/path quality; ER8="
                +String.format(java.util.Locale.US,"%.2f",er);
        return r;
    }

    private double v9556FreshDriftBudget(java.util.List<V9525MiniCandle> a,double price) {
        double atr=v9525Atr(a,14),er=v9556Efficiency(a,8);
        if(Double.isNaN(er)) er=0.0;
        if(Double.isNaN(atr)||!(atr>0)) return Math.max(price*0.0015,1e-12);
        // Budget follows CURRENT volatility/path efficiency, never cumulative % move.
        return Math.max(price*0.0015,atr*(0.22+0.55*Math.max(0.0,Math.min(1.0,er))));
    }

'''
    m=m[:idx]+helper+m[idx:]

b=method_bounds(m,'    private void v9525EvaluateDynamicReentry(TradePlan p,MarketSnapshot market,double live)')
if not b:
    raise SystemExit('v9.5.56 dynamic reentry missing')
a0,_,e0=b
body=m[a0:e0]

old='V9525Retest rr=v9525FindRetest(m5,true,p.breakoutClose); if(!rr.ok) return;'
new='V9525Retest rr=v9525FindRetest(m5,true,p.breakoutClose);\n                if(!rr.ok) rr=v9556ContinuationAnchor(m5,true,p.breakoutClose);\n                if(!rr.ok) return;'
if old not in body:
    raise SystemExit('v9.5.56 LONG reentry anchor missing')
body=body.replace(old,new,1)
old='V9525Retest rr=v9525FindRetest(m5,false,p.breakdownClose); if(!rr.ok) return;'
new='V9525Retest rr=v9525FindRetest(m5,false,p.breakdownClose);\n                if(!rr.ok) rr=v9556ContinuationAnchor(m5,false,p.breakdownClose);\n                if(!rr.ok) return;'
if old not in body:
    raise SystemExit('v9.5.56 SHORT reentry anchor missing')
body=body.replace(old,new,1)

old='if(live>c.c*1.0035) return; // no chase after the fresh 5m confirmation'
new='if(live-c.c>v9556FreshDriftBudget(m5,c.c)) return; // adaptive fresh-anchor drift; cumulative % move is irrelevant'
if old not in body:
    raise SystemExit('v9.5.56 LONG fixed chase guard missing')
body=body.replace(old,new,1)
old='if(live<c.c*0.9965) return;'
new='if(c.c-live>v9556FreshDriftBudget(m5,c.c)) return; // adaptive fresh-anchor drift; cumulative % move is irrelevant'
if old not in body:
    raise SystemExit('v9.5.56 SHORT fixed chase guard missing')
body=body.replace(old,new,1)

body=body.replace('5M DİNAMİK YAPISAL RETEST\\nYapı: ','5M DİNAMİK EXECUTION / REBASE\\nYapı: ')
body=body.replace('LONG DİNAMİK RETEST','LONG DİNAMİK EXECUTION')
body=body.replace('SHORT DİNAMİK RETEST','SHORT DİNAMİK EXECUTION')
body=body.replace('orijinal giriş kovalanmadı. Kapanmış 5m yapısal kabul + güncel R/R + ağırlıklı akış uygun.',
                  'eski entry yüzdesi veto edilmedi; güncel 5m anchor/rebase + güncel R/R + ağırlıklı akış uygun.')
body=body.replace('orijinal giriş kovalanmadı. Kapanmış 5m yapısal ret + güncel R/R + ağırlıklı akış uygun.',
                  'eski entry yüzdesi veto edilmedi; güncel 5m anchor/rebase + güncel R/R + ağırlıklı akış uygun.')

m=m[:a0]+body+m[e0:]
MON.write_text(m)

# Version bump only. Existing pasted plans remain untouched.
for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE):
    z=p.read_text()
    z=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.56',z)
    z=z.replace('v9.5.55','v9.5.56')
    p.write_text(z)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091404',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.56'",bf,count=1)
BUILD.write_text(bf)

print('v9.5.56 patch applied: no cumulative-move ban, adaptive fresh-structure rebase, continuation-vs-reversal dual hypothesis, ER path-quality helper, ATR-normalized fresh-anchor drift. Existing pasted plans unchanged.')