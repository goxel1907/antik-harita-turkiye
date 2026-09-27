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
        raise SystemExit('v9.5.55 missing: ' + str(p))


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
# MASTER prompt: retest is ONE execution path, never a universal requirement.
# Add crowding/squeeze/failed-auction logic without turning auxiliary data into
# independent vetoes. Existing daily plans are not regenerated or rewritten.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()

# Remove older wording that could be interpreted as a mandatory 5m textbook retest.
a = a.replace(
    'LTF=5M_BEKLE yap ve gerçek giriş için tamamlanmış 5m yapısal retest/reclaim/rejection iste.',
    'LTF=EXEC_BEKLE yap; gerçek giriş için retest/reclaim VEYA v9.5.55 çoklu execution yollarından yeterli olanını iste.'
)
a = a.replace(
    'fiyatı kovalamadan 5m yapısal retest bekleyin.',
    'fiyatı kovalamadan v9.5.55 çoklu execution teyitlerinden yeterli olanını bekleyin; 5m retest zorunlu değildir.'
)
a = a.replace(
    'BEKLE/GEÇERSİZ veya yeni 5m retest kurun.',
    'BEKLE/GEÇERSİZ veya yeni yapısal execution kurun.'
)
a = a.replace(
    'LTF=5M_BEKLE yap.',
    'LTF=EXEC_BEKLE yap.'
)
a = a.replace(
    'Şimdi giriş mi, yoksa 5m retest mi?',
    'Şimdi giriş mi, yoksa daha iyi execution teyidi mi?'
)

if 'V9.5.55 COKLU EXECUTION YOLLARI' not in a:
    marker = '        sb.append("V9.5.54 SELF-CHECK:'
    pos = a.find(marker)
    if pos < 0:
        raise SystemExit('v9.5.55 v9.5.54 self-check anchor missing')
    end = a.find('\\n");', pos)
    if end < 0:
        raise SystemExit('v9.5.55 self-check statement end missing')
    end += len('\\n");')

    rules = r'''
        sb.append("V9.5.55 COKLU EXECUTION YOLLARI: 5m retest yalnızca BİR execution yoludur ve evrensel şart değildir. Tamamlanmış 15m senaryo teyidinden sonra aynı yön için RETEST_RECLAIM, SWEEP_RECLAIM, DISPLACEMENT_ACCEPTANCE, COMPRESSION_BREAK, MICRO_BOS/CHOCH veya güçlü CONTINUATION_ACCEPTANCE yollarından biri/uyumlu birkaçı gerçek yapısal teyit sağlayabilir. Fiyat textbook FVG/OB retestine dönmedi diye geçerli senaryoyu otomatik iptal etme; fakat giriş koridorundan kopmuş fiyatı da kovalamayın. 3m timing, 5m execution/re-entry, 15m ana senaryo rolü korunur; 30m/45m/1h/4h/1D bağlamdır.\n");
        sb.append("V9.5.55 EXECUTION AILE SINIRI: Aynı mikro hareketten türeyen MICRO_BOS + COMPRESSION_BREAK + tek displacement mumunu üç ayrı oy sayma. STRUCTURE/LIQUIDITY, CANDLE/ACCEPTANCE, LEVERAGE/FLOW, EXECUTION/MICRO ve REGIME aile sınırı korunur. Alternatif execution ancak en az iki bağımsız aile uyumluysa veya tek çok güçlü yapısal acceptance, squeeze/crowding bağlamıyla destekleniyorsa immediate girişe aday olabilir. Hard veto olan eski/kritik veri, yapısal invalidation, tamamlanmış ana teyit yokluğu veya yetersiz gerçek R/R asla bypass edilmez.\n");
        sb.append("V9.5.55 CROWDING/SQUEEZE MATRISI: 'Çok yükseldi -> SHORT' veya 'çok düştü -> LONG' mantığı yasaktır. Fiyat yükselirken OI artıyor ve funding/pozisyonlanma short-heavy ise, fiyat ayrıca seviyenin üstünde kabul görüyorsa SHORT_SQUEEZE riski artabilir; bu SHORT için uyarıdır, otomatik LONG değildir. Fiyat düşerken OI artıyor ve long-heavy crowding varsa LONG_SQUEEZE riski artabilir; bu LONG için uyarıdır, otomatik SHORT değildir. Fiyat yükselirken OI düşmesi short-covering, fiyat düşerken OI düşmesi long liquidation/deleveraging olabilir; ikisi de tek başına dönüş sinyali değildir. Funding, OI, taker, CVD ve orderbook aynı leverage/flow ailesinde birlikte yorumlanır.\n");
        sb.append("V9.5.55 TOP-MOVER CONTRARIAN TRAP: RADAR TOP3/TOP mover olması veya 24s yüzde değişiminin aşırı görünmesi yön sinyali değildir. Kalabalığın olası SHORT/ LONG birikimini kesin bilmediğini kabul et; yalnız gözlenen OI/funding/taker/CVD/acceptance ile CROWDING tahmini yap. Top mover yukarıda uzun süre tutunuyor, tekrar tekrar satış wicklerine rağmen tamamlanmış mumlar seviyeyi kaybetmiyor ve short-heavy/squeeze bağlamı destekliyorsa sırf pahalı göründüğü için SHORT üretme. Aynı mantığın aynası sert düşen coin için geçerlidir. Market-maker niyetini bildiğini iddia etme; yalnız gözlenen davranıştan squeeze/trap RİSKİ çıkar.\n");
        sb.append("V9.5.55 TIME-AT-LEVEL / FAILED-AUCTION: Tek wick'i dönüş kabul etme. Bir seviye tekrar test edilirken fiyat karşı wicklere rağmen tamamlanmış mumlarla bölgede kalıyor, dip/tepe geri alınmıyor ve zaman geçiriyorsa bu absorption/acceptance adayıdır; karşı yön reversal ihtimalini azaltabilir. Tersine art arda denemeler kapanışla başarısız oluyor, reclaim tutmuyor ve karşı yönde displacement geliyorsa failed-auction/rejection güçlenir. Tekrar test sayısını mekanik olarak 'seviye zayıfladı' diye kullanma; kapanış ve kabul davranışı belirleyicidir.\n");
        sb.append("V9.5.55 LIKIDITE HEDEF, TEK BASINA TETIK DEGIL: BSL/SSL, EQH/EQL ve forceOrder snapshot olası çekim/hedef alanıdır; fiyat oraya ulaştı diye otomatik reversal bekleme. Sweep sonrası geri kabul, displacement, yapı değişimi ve gerçek R/R yoksa ters işlem üretme. OBS_LIQ Binance public forceOrder snapshot'tır; tam liquidation tape/heatmap değildir ve kesin piyasa yapıcı niyeti çıkarılamaz.\n");
        sb.append("V9.5.55 SENARYO GUVENI / EXECUTION GUVENI: Yön senaryosunun güveni ile şu-an giriş güvenini ayrı değerlendir. SCENARIO_CONF yüksek olup EXEC_CONF düşük olabilir: örneğin trend ve HTF yapı LONG'u desteklerken fiyat kötü konumda olabilir. Bu durumda senaryoyu tersine çevirme; EXEC_BEKLE de. Tersi durumda kısa vadeli güzel mum, HTF senaryosu zayıfsa tek başına yeni ana yön üretmez.\n");
        sb.append("V9.5.55 VOLATILITEYE UYARLAN: Sabit yüzde eşikleri yerine mümkün olduğunda ATR/tick/son salınım bağlamına normalize et. Aynı %0.3 hareket sakin coinde displacement, çok volatil coinde gürültü olabilir. Aşırı volatilitede daha geniş yapısal stop gerekiyorsa stopu daraltma; yapısal stopla R/R bozuluyorsa işlem yok veya yeni execution bekle.\n");
        sb.append("V9.5.55 META EKLERI: Mevcut 14 pipe alanını DEĞİŞTİRME. Yalnız mevcut META alanına mümkünse şu anahtarları ekle: MOVE_STATE=CONTINUATION|SQUEEZE_RISK|EXHAUSTION|REVERSAL_SETUP|NEUTRAL; CROWDING=LONG_HEAVY|SHORT_HEAVY|BALANCED|UNKNOWN; SQUEEZE_RISK=SHORTS_AT_RISK|LONGS_AT_RISK|LOW|UNKNOWN; EXEC_PATH=RETEST_RECLAIM|SWEEP_RECLAIM|DISPLACEMENT_ACCEPTANCE|COMPRESSION_BREAK|MICRO_BOS|CONTINUATION_ACCEPTANCE|NONE; SCENARIO_CONF=0-100; EXEC_CONF=0-100; TRAP_RISK=LOW|MED|HIGH|UNKNOWN. Bunlar yeni pipe alanı değildir ve gözlenmeyen veriyi uydurma.\n");
        sb.append("V9.5.55 KARAR OTOMASYONU: Önce STATE sınıflandır, sonra CROWDING/SQUEEZE bağlamını çıkar, sonra yapısal yol ve invalidation/RR kontrolünü yap, en son execution yolunu seç. RETEST gelmezse alternatif yol ara; alternatif yol yoksa kovalamadan BEKLE. Yardımcı verilerin tamamının aynı yönde olmasını bekleme. Amaç sinyali boğmak değil, yanlış yerde continuation/reversal kovalamayı engellemektir.\n");
'''
    a = a[:end] + rules + a[end:]

ANALYSIS.write_text(a)

# ---------------------------------------------------------------------------
# MonitorService: v9.5.53's forced 5m retest remains the conservative fallback,
# but a SOFT hold (marginal acceptance / late-expansion-flow) can be released by
# alternative completed 3m/5m structural evidence. STOP/RR/data hard failures
# are never bypassed. This is deliberately ATR-normalized and family-capped.
# ---------------------------------------------------------------------------
m = MON.read_text()

if 'V9555_MULTI_PATH_EXECUTION' not in m:
    anchor = '    private String v9521Norm(String x) {'
    if anchor not in m:
        anchor = '    private String v953Decision(String symbol) {'
    idx = m.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.55 Monitor helper anchor missing')

    helper = r'''
    // ============================================================
    // V9555_MULTI_PATH_EXECUTION
    // Retest is one path, not a universal requirement. Only SOFT v9.5.53 holds
    // may be released by fresh closed-candle evidence. Structural STOP/RR and
    // data-integrity failures remain authoritative hard vetoes.
    // ============================================================
    private String v9555Norm(String x) {
        if (x == null) return "";
        return x.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C');
    }

    private boolean v9555HardHoldReason(String reason) {
        String r=v9555Norm(reason);
        if (r.length()==0) return true;
        return r.contains("STOP") || r.contains("R/R")
                || r.contains("ATR-YAPI") || r.contains("DOGRULANAMADI")
                || r.contains("GECICI OLARAK") || r.contains("VERI ESKI")
                || r.contains("KRITIK VERI");
    }

    private boolean v9555SqueezeSupport(String symbol, boolean lng) {
        String meta=v9555Norm(prefs.getString("v95_meta_"+symbol,""));
        if (lng) {
            return (meta.contains("CROWDING=SHORT_HEAVY") || meta.contains("CROWDING:SHORT_HEAVY"))
                    && (meta.contains("SQUEEZE_RISK=SHORTS_AT_RISK")
                        || meta.contains("SQUEEZE_RISK:SHORTS_AT_RISK")
                        || meta.contains("MOVE_STATE=SQUEEZE_RISK")
                        || meta.contains("MOVE_STATE:SQUEEZE_RISK"));
        }
        return (meta.contains("CROWDING=LONG_HEAVY") || meta.contains("CROWDING:LONG_HEAVY"))
                && (meta.contains("SQUEEZE_RISK=LONGS_AT_RISK")
                    || meta.contains("SQUEEZE_RISK:LONGS_AT_RISK")
                    || meta.contains("MOVE_STATE=SQUEEZE_RISK")
                    || meta.contains("MOVE_STATE:SQUEEZE_RISK"));
    }

    private boolean v9555AlternativeExecution(String symbol, boolean lng,
            String holdReason, double trigger, String detail, MarketSnapshot market) {
        if (v9555HardHoldReason(holdReason)) return false;
        String rr=v9555Norm(holdReason);
        boolean soft=rr.contains("MARJINAL") || rr.contains("GEC GENISLEME")
                || rr.contains("TUKENME") || rr.contains("ZAYIF VEYA CELISKILI FLOW");
        if (!soft) return false;
        try {
            java.util.List<V9525MiniCandle> m5=v9525ClosedKlines(symbol,"5m",48);
            java.util.List<V9525MiniCandle> m3=v9525ClosedKlines(symbol,"3m",60);
            if (m5==null || m3==null || m5.size()<8 || m3.size()<10) return false;
            double atr5=v9525Atr(m5,14);
            if (Double.isNaN(atr5) || !(atr5>0)) return false;

            V9525MiniCandle z=m5.get(m5.size()-1);
            double range=Math.max(1e-12,z.h-z.l);
            double body=Math.abs(z.c-z.o)/range;
            double closeLoc=lng ? (z.c-z.l)/range : (z.h-z.c)/range;
            boolean dir=lng ? z.c>z.o : z.c<z.o;

            double priorHigh=-Double.MAX_VALUE, priorLow=Double.MAX_VALUE;
            double avgPrevRange=0.0;
            int n=0;
            for(int i=m5.size()-5;i<=m5.size()-2;i++){
                if(i<0) continue;
                V9525MiniCandle q=m5.get(i);
                priorHigh=Math.max(priorHigh,q.h);
                priorLow=Math.min(priorLow,q.l);
                avgPrevRange+=Math.max(0.0,q.h-q.l); n++;
            }
            if(n>0) avgPrevRange/=n;

            boolean displacement=dir && body>=0.55 && closeLoc>=0.72
                    && range>=atr5*0.80
                    && (lng ? z.c>priorHigh : z.c<priorLow);
            boolean compressionBreak=dir && body>=0.40 && avgPrevRange<=atr5*0.85
                    && (lng ? z.c>priorHigh : z.c<priorLow);

            V9525MiniCandle c3=m3.get(m3.size()-1);
            double p3hi=-Double.MAX_VALUE,p3lo=Double.MAX_VALUE;
            for(int i=m3.size()-6;i<=m3.size()-2;i++){
                if(i<0) continue;
                V9525MiniCandle q=m3.get(i);
                p3hi=Math.max(p3hi,q.h); p3lo=Math.min(p3lo,q.l);
            }
            boolean sweepReclaim=lng
                    ? c3.l<p3lo && c3.c>p3lo && c3.c>c3.o
                    : c3.h>p3hi && c3.c<p3hi && c3.c<c3.o;
            boolean microBos=lng
                    ? c3.c>p3hi && c3.c>c3.o
                    : c3.c<p3lo && c3.c<c3.o;

            int held=0;
            for(int i=Math.max(0,m5.size()-3);i<m5.size();i++){
                V9525MiniCandle q=m5.get(i);
                boolean ok=lng ? q.c>trigger-atr5*0.10 : q.c<trigger+atr5*0.10;
                if(ok) held++;
            }
            boolean continuationAcceptance=held>=2 && dir && closeLoc>=0.60;

            // Family cap: displacement/compression = candle/acceptance family;
            // sweep = liquidity family; micro-BOS/hold = structure family.
            boolean famAcceptance=displacement || compressionBreak;
            boolean famLiquidity=sweepReclaim;
            boolean famStructure=microBos || continuationAcceptance;
            int families=(famAcceptance?1:0)+(famLiquidity?1:0)+(famStructure?1:0);

            // Never turn an alternative path into a chase. Existing original
            // signal checks still run, and this local check keeps the latest
            // completed 5m close reasonably near the planned entry corridor.
            double[] er=v953EntryRange(detail,trigger,lng);
            if(!v953InEntryRange(z.c,er[0],er[1],0.50)) return false;

            boolean squeeze=v9555SqueezeSupport(symbol,lng);
            return families>=2 || (squeeze && families>=1 && (displacement || sweepReclaim || microBos));
        } catch(Throwable ignored) {
            return false;
        }
    }

'''
    m = m[:idx] + helper + m[idx:]

b = method_bounds(m, '    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b:
    raise SystemExit('v9.5.55 evaluate missing')
a0, _, e0 = b
body = m[a0:e0]

if 'V9555_LB_MULTI_PATH_GATE' not in body:
    old = '''        if (v9553LbRaw && !v9553LbGate.immediate)\n            v9553ArmRetest(p.symbol,true,v9553LbGate.reason);\n        else if (v9553LbRaw)\n            v9553ClearRetest(p.symbol,true);'''
    new = '''        // V9555_LB_MULTI_PATH_GATE\n        boolean v9555LbAlternative = v9553LbRaw && !v9553LbGate.immediate\n                && v9555AlternativeExecution(p.symbol,true,v9553LbGate.reason,\n                        p.breakoutClose,p.longBreakDetail,market);\n        if (v9553LbRaw && !v9553LbGate.immediate && !v9555LbAlternative)\n            v9553ArmRetest(p.symbol,true,v9553LbGate.reason);\n        else if (v9553LbRaw)\n            v9553ClearRetest(p.symbol,true);'''
    if old not in body:
        raise SystemExit('v9.5.55 LB v9553 hold block missing')
    body = body.replace(old,new,1)
    needle='                && v9553LbGate.immediate\n'
    if needle not in body:
        raise SystemExit('v9.5.55 LB gate condition missing')
    body=body.replace(needle,'                && (v9553LbGate.immediate || v9555LbAlternative)\n',1)

if 'V9555_SB_MULTI_PATH_GATE' not in body:
    old = '''        if (v9553SbRaw && !v9553SbGate.immediate)\n            v9553ArmRetest(p.symbol,false,v9553SbGate.reason);\n        else if (v9553SbRaw)\n            v9553ClearRetest(p.symbol,false);'''
    new = '''        // V9555_SB_MULTI_PATH_GATE\n        boolean v9555SbAlternative = v9553SbRaw && !v9553SbGate.immediate\n                && v9555AlternativeExecution(p.symbol,false,v9553SbGate.reason,\n                        p.breakdownClose,p.shortBreakDetail,market);\n        if (v9553SbRaw && !v9553SbGate.immediate && !v9555SbAlternative)\n            v9553ArmRetest(p.symbol,false,v9553SbGate.reason);\n        else if (v9553SbRaw)\n            v9553ClearRetest(p.symbol,false);'''
    if old not in body:
        raise SystemExit('v9.5.55 SB v9553 hold block missing')
    body = body.replace(old,new,1)
    needle='                && v9553SbGate.immediate\n'
    if needle not in body:
        raise SystemExit('v9.5.55 SB gate condition missing')
    body=body.replace(needle,'                && (v9553SbGate.immediate || v9555SbAlternative)\n',1)

m = m[:a0] + body + m[e0:]
MON.write_text(m)

# UI wording: a held scenario waits for execution confirmation; 5m textbook
# retest is not presented to the user as mandatory anymore.
s = MAIN.read_text()
s = s.replace('5m yapısal retest/reclaim gerekli • yaklaşık ',
              'çoklu execution teyidi bekleniyor (retest şart değil) • yaklaşık ')
s = s.replace('5m yapısal retest/reclaim bekleniyor',
              'execution teyidi bekleniyor (retest şart değil)')
MAIN.write_text(s)

# Visible version bump only. No SharedPreferences plan migration or auto-analysis.
for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE):
    z=p.read_text()
    z=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.55',z)
    z=z.replace('v9.5.54','v9.5.55')
    p.write_text(z)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091403',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.55'",bf,count=1)
BUILD.write_text(bf)

print('v9.5.55 patch applied: multi-path execution, crowding/squeeze/failed-auction prompt logic, soft-hold alternative runtime path; hard STOP/RR/data vetoes retained. Existing pasted plans unchanged.')