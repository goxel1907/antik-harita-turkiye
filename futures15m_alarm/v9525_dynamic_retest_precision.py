from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
ENGINE = JAVA / 'StructureEngine.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, MON, ANALYSIS, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.25 missing: ' + str(p))

# -----------------------------------------------------------------------------
# 1) MASTER PROMPT: a retest is structural acceptance, not an exact-price touch.
# Keep the original 15m scenario semantics strict, but allow a MISSED confirmed
# 15m move to form a NEW 5m structural re-entry. 3m remains timing only.
# -----------------------------------------------------------------------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.25', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.25', a)

if 'DİNAMİK RETEST / YENİDEN KABUL KURALI:' not in a:
    anchor = '        sb.append("ALT ZAMAN DİLİMİ YENİDEN GİRİŞ KURALI:'
    pos = a.find(anchor)
    if pos < 0:
        raise SystemExit('v9.5.25 LTF rule anchor missing')
    end = a.find('\n', pos)
    if end < 0:
        raise SystemExit('v9.5.25 LTF rule line end missing')
    rule = r'''
        sb.append("DİNAMİK RETEST / YENİDEN KABUL KURALI: Retest, eski kırılım çizgisine veya ilk giriş kutusuna nokta atışı temas demek değildir. Önce 15m ana yön/senaryo teyidi korunur. Orijinal giriş kaçmışsa 45 dakikalık 5m yeniden giriş penceresinde fiyat aynı yönü destekleyen YENİ bir yapısal kabul koridorunda dönebilir. Geçerli adaylar: kırılan destek/direncin rol değişimi, AKTİF FVG/imbalance/gap, GEÇERLİ order block, breaker/mitigation, son net impulsun Fibonacci 0.50/0.618/0.705/0.786 bölgesi, anlamlı mikro HL/LH veya swing, BSL/SSL sweep sonrası reclaim/rejection. 'ICT/SMC var' tek başına gerekçe değildir; mutlaka somut yapı ve fiyat bölgesini adlandır. Orijinal kırılım seviyesine temas ZORUNLU DEĞİLDİR.\\n");
        sb.append("DİNAMİK RETEST KALİTE KURALI: Bir alternatif retesti gerçek giriş adayı saymak için en az bir GÜÇLÜ yapısal dayanak + TAMAMLANMIŞ 5m kabul/geri kazanım/ret/yapı kırılımı gerekir; veya aynı fiyat kümesinde iki daha zayıf dayanak + TAMAMLANMIŞ 5m teyit gerekir. Fibonacci tek başına, FVG etiketi tek başına, tek wick veya tek 3m mum tek başına sinyal değildir. 3m yalnız 5m setup geçerliyken giriş hassasiyeti sağlar. INVALIDATED OB, FILLED FVG veya tüketilmiş breaker aktif retest dayanağı sayılamaz.\\n");
        sb.append("RETEST KÜMELEME / ÇİFTE SAYMAMA: Aynı fiyat hareketinden türeyen BOS+CHoCH+FVG+OB+Fib işaretlerini beş bağımsız oy gibi sayma; aynı bölgede üst üste geliyorsa tek YAPI ailesinin kuvveti olarak değerlendir. CVD+taker+order book da ayrı ayrı üç zorunlu teyit değil, CANLI AKIŞ ailesidir. Güveni aynı bilginin türevlerini tekrar sayarak şişirme. Birden fazla uzak retest alanını tek geniş giriş kutusunda birleştirme; yalnız en güçlü ve güncel TEK yapısal kümeyi giriş koridoru yap.\\n");
        sb.append("ORİJİNAL SENARYO İLE YENİDEN GİRİŞİ KARIŞTIRMA: LP/SR ilk senaryosu kendi plan bölgesine temas + tamamlanmış 15m reclaim/rejection kuralını korur. Fiyat o bölgeye hiç gelmeden başka bir yapısal alandan dönerse 'LP/SR teyit oldu' deme. Eğer ana 15m yön daha önce teyitliyse bunu YENİ 5m yeniden giriş setup'ı olarak sınıflandır; LTF=5M_UYGUN ve RETEST alanında kullanılan somut yapıyı yaz. Böylece eski senaryonun şartları gevşetilmez, fakat kaliteli alternatif retest de kaçırılmaz.\\n");
        sb.append("DİNAMİK RETEST GEÇ GİRİŞ FİLTRESİ: Yeni 5m retest teyidi geldiğinde fiyat yeni yapısal STOP'a göre hâlâ yeterli R/R vermeli ve bir sonraki bağımsız TP/likidite alanına çok yaklaşmış olmamalı. Fiyat TP1 alanını zaten tüketmişse, impuls ATR/son salınıma göre aşırı uzamışsa veya yeni giriş için STOP anlamsız genişliyorsa fiyatı kovalamadan BEKLE. Yeni 5m girişte STOP güncel mikro yapının geçersizlik tarafında yeniden hesaplanır; eski 15m STOP'u körlemesine taşıma. Hedefler hâlâ güncel bağımsız yapısal seviyelerden gelmelidir.\\n");
'''
    a = a[:end + 1] + rule + a[end + 1:]

# Clarify how the 14-field numeric plan should encode the strongest structural
# retest corridor instead of mechanically copying the breakout line.
if 'PLAN RETEST KORİDORU KURALI:' not in a:
    anchor = '        sb.append("9) UYGULAMA PLAN KODU'
    pos = a.find(anchor)
    if pos < 0:
        raise SystemExit('v9.5.25 plan code anchor missing')
    end = a.find('\n', pos)
    plan_rule = r'''        sb.append("PLAN RETEST KORİDORU KURALI: pullLow/pullHigh ile LB/SB girişAlt-girişUst alanlarını otomatik olarak eski kırılım çizgisinin çevresine yapıştırma. O anda grafikte doğrulanan en güçlü TEK yapısal retest kümesini kullan: örneğin 5m FVG + Fib + mikro swing veya geçerli breaker/OB. Birbirinden uzak iki bölgeyi tek geniş aralıkta birleştirme. Henüz hangi yapısal retest kümesinin geçerli olacağı belli değilse senaryoyu UYGUN yapma; BEKLE yaz ve WAIT alanında hangi 5m yapısal kabulün beklendiğini belirt.\\n");
'''
    a = a[:end + 1] + plan_rule + a[end + 1:]

# Extend META without changing the outer 14-field parser contract.
if 'RETEST:<ORIJINAL/5M_FVG/5M_OB/5M_BREAKER/5M_FIB/5M_SWING/KARMA/NONE>' not in a:
    token = 'LTF:<KAPALI/5M_BEKLE/5M_UYGUN>'
    repl = token + ';RETEST:<ORIJINAL/5M_FVG/5M_OB/5M_BREAKER/5M_FIB/5M_SWING/KARMA/NONE>'
    if token not in a:
        raise SystemExit('v9.5.25 META LTF token missing')
    a = a.replace(token, repl, 1)

# Make WAIT semantics explicit and sequential; it should never demand an exact
# legacy level when an alternative 5m structural retest is the active idea.
if 'WAIT DİNAMİK RETEST SEMANTİĞİ:' not in a:
    wait_anchor = 'WAIT mutlaka Türkçe ve gerçekleşmemiş bir sonraki şartı kısa yazsın.'
    if wait_anchor not in a:
        raise SystemExit('v9.5.25 WAIT anchor missing')
    a = a.replace(wait_anchor, wait_anchor +
        ' WAIT DİNAMİK RETEST SEMANTİĞİ: Eski kırılım fiyatına birebir dönüş zorunlu değilse WAIT içinde bunu zorunluymuş gibi yazma; bunun yerine örn. "5m aktif FVG/Fib kümesinde tamamlanmış 5m geri kazanım" gibi somut bir sonraki yapısal şartı yaz.', 1)

if 'V9525_DYNAMIC_STRUCTURAL_RETEST' not in a:
    p = a.find('\n', a.find('public class '))
    if p < 0: p = 0
    a = a[:p+1] + '    // V9525_DYNAMIC_STRUCTURAL_RETEST\n' + a[p+1:]
ANALYSIS.write_text(a)

# -----------------------------------------------------------------------------
# 2) StructureEngine: expose ACTIVE/VALID structural retest candidates to the
# model. This is an ADAY map only; it does not auto-confirm a trade.
# -----------------------------------------------------------------------------
e = ENGINE.read_text()

fib_line = '            out.append("• Fibonacci: ").append(f.fib).append("\\n");'
if 'Dinamik Retest Adayları' not in e:
    if fib_line not in e:
        raise SystemExit('v9.5.25 engine fibonacci output anchor missing')
    e = e.replace(fib_line, fib_line + '\n            out.append("• Dinamik Retest Adayları: ").append(f.retest).append("\\n");', 1)

frame_old = 'String structure, bos, choch, fvg, ob, breaker, eqh, eql, bsl, ssl, hunt, fib, pd;'
frame_new = 'String structure, bos, choch, fvg, ob, breaker, eqh, eql, bsl, ssl, hunt, fib, pd, retest;'
if frame_old in e:
    e = e.replace(frame_old, frame_new, 1)
elif 'pd, retest;' not in e:
    raise SystemExit('v9.5.25 engine Frame fields anchor missing')

nodata_old = 'structure = bos = choch = fvg = ob = breaker = eqh = eql = bsl = ssl = hunt = fib = pd = "YETERSIZ_VERI";'
nodata_new = 'structure = bos = choch = fvg = ob = breaker = eqh = eql = bsl = ssl = hunt = fib = pd = retest = "YETERSIZ_VERI";'
if nodata_old in e:
    e = e.replace(nodata_old, nodata_new, 1)
elif 'pd = retest = "YETERSIZ_VERI"' not in e:
    raise SystemExit('v9.5.25 engine no-data anchor missing')

ret_block = '''        } else {
            f.fib = "IMPULSE_NOT_CLEAR";
            f.pd = "UNRESOLVED";
        }
        return f;'''
ret_new = '''        } else {
            f.fib = "IMPULSE_NOT_CLEAR";
            f.pd = "UNRESOLVED";
        }
        f.retest = dynamicRetestMap(bullGap, bearGap, bullOb, bearOb, f.breaker, lastH, lastL, f.fib, last.close);
        return f;'''
if 'f.retest = dynamicRetestMap(' not in e:
    if ret_block not in e:
        raise SystemExit('v9.5.25 engine return anchor missing')
    e = e.replace(ret_block, ret_new, 1)

if 'private static String dynamicRetestMap(' not in e:
    helper_anchor = '    private static String equalLevel(List<Swing> s, double tol) {'
    if helper_anchor not in e:
        raise SystemExit('v9.5.25 engine helper anchor missing')
    helper = r'''    private static String dynamicRetestMap(Gap bullGap, Gap bearGap,
                                                   Ob bullOb, Ob bearOb,
                                                   String breaker, Swing lastH, Swing lastL,
                                                   String fib, double close) {
        List<String> lng = new ArrayList<>();
        List<String> sht = new ArrayList<>();
        if (bullGap != null && !bullGap.filled)
            lng.add("FVG " + p(bullGap.low) + "-" + p(bullGap.high));
        if (bearGap != null && !bearGap.filled)
            sht.add("FVG " + p(bearGap.low) + "-" + p(bearGap.high));
        if (bullOb != null && !bullOb.invalid)
            lng.add("OB " + p(bullOb.low) + "-" + p(bullOb.high));
        if (bearOb != null && !bearOb.invalid)
            sht.add("OB " + p(bearOb.low) + "-" + p(bearOb.high));
        if (breaker != null && !"NONE_DETECTED".equals(breaker)) {
            if (breaker.contains("BULL BREAKER")) lng.add("BREAKER " + breaker);
            if (breaker.contains("BEAR BREAKER")) sht.add("BREAKER " + breaker);
        }
        if (fib != null && fib.startsWith("UP ")) lng.add("FIB_PULLBACK " + fib.substring(3));
        if (fib != null && fib.startsWith("DOWN ")) sht.add("FIB_RETRACE " + fib.substring(5));
        if (lastL != null && lastL.price <= close * 1.003) lng.add("MIKRO_SWING_LOW " + p(lastL.price));
        if (lastH != null && lastH.price >= close * 0.997) sht.add("MIKRO_SWING_HIGH " + p(lastH.price));
        String ls = lng.isEmpty() ? "YOK" : join(lng, " + ");
        String ss = sht.isEmpty() ? "YOK" : join(sht, " + ");
        return "LONG[" + ls + "] | SHORT[" + ss + "] • ADAY HARITA; nokta atisi temas sarti degildir";
    }

'''
    e = e.replace(helper_anchor, helper + helper_anchor, 1)

if 'V9525_DYNAMIC_RETEST_MAP' not in e:
    p = e.find('\n', e.find('final class StructureEngine'))
    if p < 0: p = 0
    e = e[:p+1] + '    // V9525_DYNAMIC_RETEST_MAP\n' + e[p+1:]
ENGINE.write_text(e)

# -----------------------------------------------------------------------------
# 3) UI/runtime wording. Do NOT silently relax the original LP/SR 15m gates.
# Dynamic 5m re-entry is a separate setup generated from the structural map.
# -----------------------------------------------------------------------------
m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.25', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.25  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.25 MANUEL PRO çalışma şekli:', m)
if 'Dinamik retest: eski kırılım noktasına birebir temas şart değil' not in m:
    marker = 'Planlar yalnız yapıştırdığınız ChatGPT analiz kodundan gelir.'
    if marker in m:
        m = m.replace(marker,
            marker + ' Dinamik retest: eski kırılım noktasına birebir temas şart değil; plan kodundaki giriş koridoru en güçlü güncel yapısal kümeyi temsil eder.', 1)
MAIN.write_text(m)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.25', mon)
# Keep the actual hard gates honest: initial LP/SR still require their own zone.
# Only clarify terminology shown in live status.
mon = mon.replace('fiyat giriş/yeniden test alanında', 'fiyat planlanan yapısal giriş/yeniden test koridorunda')
MON.write_text(mon)

# -----------------------------------------------------------------------------
# 4) Version bump.
# -----------------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 39', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.25'", b, count=1)
BUILD.write_text(b)

# -----------------------------------------------------------------------------
# Fail-fast: decision semantics must stay strict and dynamic retest must not
# replace the original 15m reclaim/rejection contract.
# -----------------------------------------------------------------------------
af = ANALYSIS.read_text(); ef = ENGINE.read_text(); mf = MAIN.read_text(); monf = MON.read_text(); bf = BUILD.read_text()
checks = [
    ('V9525_DYNAMIC_STRUCTURAL_RETEST' in af, 'prompt dynamic retest marker'),
    ('DİNAMİK RETEST / YENİDEN KABUL KURALI:' in af, 'dynamic retest rule'),
    ('ORİJİNAL SENARYO İLE YENİDEN GİRİŞİ KARIŞTIRMA:' in af, 'sequential scenario semantics'),
    ('RETEST:<ORIJINAL/5M_FVG/5M_OB/5M_BREAKER/5M_FIB/5M_SWING/KARMA/NONE>' in af, 'RETEST META key'),
    ('PLAN RETEST KORİDORU KURALI:' in af, 'plan corridor rule'),
    ('aynı YAPI ailesinin kuvveti' in af and 'CANLI AKIŞ ailesidir' in af, 'no double-counting rule'),
    ('V9525_DYNAMIC_RETEST_MAP' in ef and 'Dinamik Retest Adayları' in ef, 'structure retest map'),
    ('!bullGap.filled' in ef and '!bullOb.invalid' in ef, 'invalid/filled structures excluded from retest candidates'),
    ('closed.close >= p.pullbackHigh' in monf, 'original LONG 15m reclaim retained'),
    ('closed.close <= p.resistanceLow' in monf, 'original SHORT 15m rejection retained'),
    ('ALT ZAMAN DİLİMİ YENİDEN GİRİŞ KURALI:' in af and 'TAMAMLANMIŞ 5m' in af, '5m re-entry remains explicit'),
    ('versionCode 39' in bf and "versionName '9.5.25'" in bf, 'version bump'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.25 sanity failed: ' + name)
print('v9.5.25 OK: exact-touch bias removed from re-entry reasoning; structural 5m retest candidates + no-double-counting + strict original 15m gates retained.')
