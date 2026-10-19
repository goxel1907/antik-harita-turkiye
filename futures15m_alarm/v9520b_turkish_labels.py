from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
ANALYSIS=JAVA/'AnalysisPackActivity.java'
for p in (MAIN,ANALYSIS):
    if not p.exists(): raise SystemExit('v9.5.20b missing '+str(p))

# Main screen: keep only the meaningful status dot; action buttons are text-first.
m=MAIN.read_text()
m=m.replace('Binance public veri','Binance herkese açık veri')
m=m.replace('MASTER PROMPT\\nPanoya kopyala','ANA ANALİZ PROMPTU\\nPanoya kopyala')
m=m.replace('MASTER ANALİZ PROMPTUNU KOPYALA','ANA ANALİZ PROMPTUNU KOPYALA')
m=m.replace('ChatGPT planı • Binance public veri','ChatGPT planı • Binance herkese açık veri')
# User-facing market/structure wording; standard abbreviations remain unchanged.
for old,new in [
    ('Order book','Emir defteri'),('order book','emir defteri'),
    ('Funding','Fonlama'),('funding','fonlama'),
    ('Taker Buy/Sell','Agresif Alış/Satış'),
    ('Bid/Ask','Alış/Satış'),
    ('Wick/temas','Fitil/temas'),('wick/temas','fitil/temas'),
    ('HTF ','üst zaman dilimi '),
]: m=m.replace(old,new)
MAIN.write_text(m)

# Analysis package/chart: Turkish visible labels. Code/META abbreviations are untouched.
a=ANALYSIS.read_text()
repls=[
    ('Binance Futures public veri','Binance Futures herkese açık veri'),
    ('Binance public veri','Binance herkese açık veri'),
    ('Mark price:','İşaret fiyatı:'),('Mark price ','İşaret fiyatı '),('Mark ','İşaret '),
    ('Funding:','Fonlama:'),('Funding ','Fonlama '),
    ('Open Interest:','Açık pozisyon (OI):'),
    ('Taker Buy/Sell:','Agresif Alış/Satış:'),
    ('Order book top20 Bid/Ask notional:','Emir defteri ilk20 Alış/Satış tutarı:'),
    ('Order book','Emir defteri'),('order book','emir defteri'),
    ('Bid/Ask','Alış/Satış'),
    ('VOLUME','HACİM'),
    ('Wick/temas','Fitil/temas'),('wick/temas','fitil/temas'),
    ('Wick/','Fitil/'),('wick/','fitil/'),
    ('HTF ','üst zaman dilimi '),
    ('MASTER PROMPT','ANA ANALİZ PROMPTU'),
    ('market maker','piyasa yapıcı'),
]
for old,new in repls: a=a.replace(old,new)

# Make the data-quality warning impossible to miss in the generated prompt.
needle='CVD GERÇEK ÖRNEKLEM KAPSAMASI:'
if needle in a and 'CVD AĞIRLIK KURALI:' not in a:
    # Do not alter calculations; only add an explicit interpretation reminder near the prompt rule.
    rule='CVD AĞIRLIK KURALI: gerçek kapsama 5 dakikadan kısaysa çok kısa örneklem ve düşük ağırlık; 5-12 dk kısmi; 12 dk ve üzeri ancak 15 dk bağlamında yardımcı teyit. '
    anchor='CVD için etikette yazan 5m/15m adına değil GERÇEK ÖRNEKLEM KAPSAMASINA bak.'
    if anchor in a:
        a=a.replace(anchor,anchor+' '+rule,1)

ANALYSIS.write_text(a)

# Final assertions target user-visible quality, not internal machine terms.
main=MAIN.read_text(); ana=ANALYSIS.read_text()
checks=[
 ('ANA ANALİZ PROMPTU\\nPanoya kopyala' in main,'main prompt action Turkish'),
 ('Binance herkese açık veri' in main,'main public-data Turkish'),
 ('SON TAMAMLANMIŞ KAPANIŞ C' in ana,'closed candle label retained'),
 ('HACİM' in ana,'chart volume Turkish'),
 ('İşaret fiyatı:' in ana,'mark price Turkish'),
 ('Fonlama:' in ana,'funding Turkish'),
 ('Açık pozisyon (OI):' in ana,'open interest Turkish'),
 ('Agresif Alış/Satış:' in ana,'taker Turkish'),
 ('Emir defteri ilk20 Alış/Satış tutarı:' in ana,'order book Turkish'),
 ('Gerçek işlem tetik teyidi yalnız TAMAMLANMIŞ 15m mum kapanışından gelebilir' in ana,'15m trigger rule retained'),
]
for ok,name in checks:
    print(('OK   ' if ok else 'FAIL '),name)
    if not ok: raise SystemExit('v9.5.20b sanity failed: '+name)
print('v9.5.20b OK: decorative action icons removed; Turkish labels and chart copy polished.')
