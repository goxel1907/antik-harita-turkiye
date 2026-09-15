from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
ANALYSIS=JAVA/'AnalysisPackActivity.java'
CTX=JAVA/'V9531DecisionContext.java'
BUILD=APP/'app/build.gradle'
for p in (MAIN,ANALYSIS,CTX,BUILD):
    if not p.exists(): raise SystemExit('v9.5.60 missing: '+str(p))

# ---------------------------------------------------------------------------
# V9.5.60 SOURCE/PROVENANCE CONTRACT
#
# Goal: improve interpretation quality without adding another signal family,
# score, hard veto or duplicate order-book metric.
#
# Important boundary learned from the reviewed research:
# - A Binance depth snapshot can measure near-touch concentration/imbalance.
# - It does NOT expose an order-by-order lifecycle that lets us reliably label
#   every change as cancel, refill, spoof, passive retreat or replenishment.
# - Therefore QuantFlowLab-style passive lifecycle features are NOT fabricated
#   from snapshot deltas. They stay unavailable/scoreless until a sufficiently
#   granular event-level collector exists and is validated.
# ---------------------------------------------------------------------------

c=CTX.read_text()

# The existing value is max-level share inside top-20 depth. "Wall" could be
# misread as time-persistent liquidity, although no age/persistence algorithm is
# computed here. Rename only the human-facing labels; calculation is unchanged.
c=c.replace(' | bidWall=', ' | bidTop20Concentration=')
c=c.replace(' | askWall=', ' | askTop20Concentration=')

if 'V9560_BOOK_PROVENANCE' not in c:
    anchor='            b.append("BOOK KULLANIMI: order book hizli degisir; sadece entry timing/near-threshold tie-break icin kullan. ")'
    pos=c.find(anchor)
    if pos<0:
        raise SystemExit('v9.5.60 BOOK KULLANIMI anchor missing')
    close=c.find('        } else {',pos)
    if close<0:
        raise SystemExit('v9.5.60 BOOK else anchor missing')
    extra=r'''            // V9560_BOOK_PROVENANCE
            b.append("BOOK PROVENANCE: Binance /fapi/v1/depth anlik snapshotidir; imb5/imb20 ve top20 concentration hesaplanir. ")
                    .append("Duvar yasi/persistence, order-id yasam dongusu, cancel-vs-fill, spoof/pull veya gercek replenishment OLCULMUYOR; bunlari varmis gibi yorumlama. ")
                    .append("Bu veri execution/micro ailesinde soft contexttir; snapshot yok/bayatsa PUANSIZ.\n");
'''
    c=c[:close]+extra+c[close:]

CTX.write_text(c)

# Add a compact interpretation contract to the ChatGPT analysis prompt. This
# intentionally adds semantics, not another decision gate or duplicated metric.
a=ANALYSIS.read_text()
if 'V9.5.60 KAYNAK / PROVENANCE SOZLESMESI' not in a:
    marker='V9.5.58 EMA KULLANIM SOZLESMESI:'
    pos=a.find(marker)
    if pos<0:
        raise SystemExit('v9.5.60 prompt anchor missing')
    line_end=a.find('\n',pos)
    if line_end<0:
        raise SystemExit('v9.5.60 prompt line end missing')
    rules=r'''
        sb.append("V9.5.60 KAYNAK / PROVENANCE SOZLESMESI: BOOK_MICRO yalniz Binance anlik depth snapshotundan gelen imbalance/concentration verisidir. Mamonet/orderbook-heatmap'teki yatay kalici bant anlatimi gorsel heatmap semantigidir; uygulamada olculen duvar-yasi/persistence algoritmasi gibi yorumlama ve mevcut BOOK/CVD/absorpsiyon ailesini tekrar puanlama.\n");
        sb.append("V9.5.60 ORDER-LIFECYCLE SINIRI: QuantFlowLab'daki passive-add/cancel/update/reprice/replenishment ayrimi order-level event akisina dayanir. Mevcut Binance snapshot verisinden cancel-vs-fill, spoof, passive retreat/protection veya gercek replenishment KESIN cikarsanamaz; bu alanlar olculmedikce PUANSIZDIR ve yeni hard veto yaratmaz.\n");
        sb.append("V9.5.60 LIKIDITE PROVENANCE: BSL/SSL/LIQ_DRAW=YAPISAL_TAHMINI hedef havuzu; LIQ_DENS=MODELLENMIS_TAHMINI yogunluk; OBS_LIQ=BINANCE_FORCEORDER_GOZLENEN_GECMIS snapshot. Ucunu birbirinin kaniti gibi kullanma, market-maker niyeti veya bireysel liquidation price uydurma; ayni leverage/flow olayini cift sayma.\n");
        sb.append("V9.5.60 HFTBACKTEST SINIRI: hftbacktest queue/latency/fill gercekligi OFFLINE dogrulama metodudur; Android runtime LONG/SHORT puani, alarm veya veto degildir.\n");
'''
    a=a[:line_end+1]+rules+a[line_end+1:]

# Marker makes later patches/tests able to assert this contract survived.
if 'V9560_PROVENANCE_CONTRACT' not in a:
    cp=a.find('\n',a.find('public class '))
    if cp<0:
        raise SystemExit('v9.5.60 Analysis class anchor missing')
    a=a[:cp+1]+'    // V9560_PROVENANCE_CONTRACT\n'+a[cp+1:]

ANALYSIS.write_text(a)

# Version bump. Connected GitHub build lineage is v9.5.59 -> v9.5.60.
m=MAIN.read_text()
m=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.60',m)
m=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.60  •  MANUEL PRO',m)
MAIN.write_text(m)

b=BUILD.read_text()
b=re.sub(r'versionCode\s+\d+','versionCode 26091501',b,count=1)
b=re.sub(r"versionName\s+'[^']+'","versionName '9.5.60'",b,count=1)
BUILD.write_text(b)

ctx=CTX.read_text(); ana=ANALYSIS.read_text(); main=MAIN.read_text(); bld=BUILD.read_text()
checks={
    'book display no fake persistence label':
        'bidTop20Concentration=' in ctx and 'askTop20Concentration=' in ctx,
    'snapshot provenance':
        'V9560_BOOK_PROVENANCE' in ctx and 'Duvar yasi/persistence' in ctx,
    'prompt provenance contract':
        'V9560_PROVENANCE_CONTRACT' in ana and 'V9.5.60 KAYNAK / PROVENANCE SOZLESMESI' in ana,
    'quantflow boundary':
        'passive-add/cancel/update/reprice/replenishment' in ana and 'PUANSIZDIR' in ana,
    'liquidation source split':
        'BSL/SSL/LIQ_DRAW=YAPISAL_TAHMINI' in ana and
        'LIQ_DENS=MODELLENMIS_TAHMINI' in ana and
        'OBS_LIQ=BINANCE_FORCEORDER_GOZLENEN_GECMIS' in ana,
    'hftbacktest offline only':
        'HFTBACKTEST SINIRI' in ana and 'OFFLINE dogrulama' in ana,
    'no new decision gate':
        'V9560_HARD_GATE' not in ana and 'V9560_HARD_GATE' not in ctx,
    'version':
        'v9.5.60' in main and "versionName '9.5.60'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.60 sanity failed: '+', '.join(bad))
print('v9.5.60 OK: provenance hardened; no fake wall-persistence/order-lifecycle metric, no duplicate score, no new hard veto.')
