from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
ANA=JAVA/'AnalysisPackActivity.java'
MAIN=JAVA/'MainActivity.java'
MON=JAVA/'MonitorService.java'
BUILD=APP/'app/build.gradle'
for p in (ANA,MAIN,MON,BUILD):
    if not p.exists():
        raise SystemExit('v9.5.62 missing: '+str(p))

a=ANA.read_text()
marker='V9.5.62 ANALIZ PAKETI BUTUNLUK / EXACT SYMBOL / GORSEL KANIT KORUMASI'
if marker not in a:
    anchors=[
        '        sb.append("GÜNCEL KAYNAK KURALI:',
        '        sb.append("GUNCEL KAYNAK KURALI:',
        '        sb.append("15M FUTURES PRO MANUEL ANALİZ PROTOKOLÜ',
        '        sb.append("15M FUTURES PRO MANUEL ANALIZ PROTOKOLU',
    ]
    pos=-1
    for x in anchors:
        pos=a.find(x)
        if pos>=0:
            break
    if pos<0:
        raise SystemExit('v9.5.62 master prompt anchor missing')
    line_start=a.rfind('\n',0,pos)+1
    rules=r'''        sb.append("V9.5.62 ANALIZ PAKETI BUTUNLUK / EXACT SYMBOL / GORSEL KANIT KORUMASI:\n");
        sb.append("1) EXACT SYMBOL IDENTITY: Yalniz bu paketteki Coin: alaninda yazan TAM Binance sembolunu analiz et. TUSDT ile THEUSDT, SUSDT, TURBOUSDT veya baska prefix/substring benzerlikleri ASLA ayni sembol kabul edilmez. Grafik panel basligi, Coin: alani, anlik fiyat/veri bloklari ve final plan SYMBOL alani birebir ayni sembole ait olmalidir. Bunlardan biri farkliysa VERI CELISKISI yaz; LONG/SHORT/UYGUN dal ve uygulama plan kodu uretme.\n");
        sb.append("2) PAKET BUTUNLUGU: Bu mesajdaki Coin + Paket zamani + ekli grafik basligi + otomatik canli veri + sayisal yapi taramasi TEK analiz paketidir. Onceki mesajdaki baska sembolun fiyatini, STOP/TP seviyesini, FVG/OB/BSL/SSL haritasini, META kararini veya eski plan seviyesini bu pakete TASIMA. Yalniz ayni exact sembolun onceki analizi karsilastirma icin anilabilir; nihai karar daima EN SON paketin verilerinden uretilir. Paket icinde sembol/zaman/grafik kimligi maddi olarak uyusmuyorsa VERI CELISKISI yaz ve WAIT=Veri paketini yenileyin kullan.\n");
        sb.append("3) GORSEL KANIT SINIRI: Grafik cozunurlugunde veya verilen kapanmis OHLC gecmisinde dogrulanamayan wick/sweep, swing, BOS/CHoCH, FVG/OB/breaker siniri ya da likidite kumesini kesinlesmis gercek gibi UYDURMA. Sayisal motorun ADAY etiketi gorsel/OHLC dogrulamasi yoksa ADAY olarak kalir. Buna karsilik gorsel + kapanmis OHLC acikca dogruluyorsa otomatik taramadaki NONE tek basina yokluk kaniti degildir.\n");
        sb.append("4) KIMLIK HARD VETO SINIRI: Exact sembol uyusmazligi veya paket butunlugu ihlali YENI bir besinci veto degildir; mevcut dort hard veto icindeki kritik veri eski/eksik veya grafik-metin arasinda maddi celiski kapsamina girer. Yardimci metriklerle bypass edilemez; uyusmazlik yoksa bu kural normal sinyali bogmak icin kullanilamaz.\n");
        sb.append("5) FINAL SYMBOL DENETIMI: Son 14 alanli plan kodunu yazmadan hemen once SYMBOL degerinin Coin: ile birebir ayni oldugunu tekrar kontrol et. Eski sembol, kisa ad, prefix, benzer ticker veya onceki paketin sembolunu kullanma.\n\n");
'''
    a=a[:line_start]+rules+a[line_start:]
    ANA.write_text(a)

# Version must move with the feature so the installed APK/UI is distinguishable.
for p in (MAIN,MON,ANA):
    z=p.read_text()
    z=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.62',z)
    z=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.62',z)
    z=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.62  •  MANUEL PRO',z)
    p.write_text(z)

b=BUILD.read_text()
b=re.sub(r'versionCode\s+\d+','versionCode 26091502',b,count=1)
b=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.62'",b,count=1)
BUILD.write_text(b)

# Fail loudly if the guard or version did not land; never silently ship without it.
a=ANA.read_text(); main=MAIN.read_text(); b=BUILD.read_text()
checks={
    'exact symbol guard':marker in a and 'TUSDT ile THEUSDT' in a,
    'package integrity':'PAKET BUTUNLUGU' in a and 'WAIT=Veri paketini yenileyin' in a,
    'visual evidence limit':'GORSEL KANIT SINIRI' in a and 'ADAY olarak kalir' in a,
    'no fifth veto':'YENI bir besinci veto degildir' in a,
    'final symbol audit':'FINAL SYMBOL DENETIMI' in a,
    'version':"versionName '9.5.62'" in b,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.62 sanity failed: '+', '.join(bad))
print('v9.5.62 OK: exact-symbol identity, package integrity and visual-evidence limits added without creating a new trading veto.')
