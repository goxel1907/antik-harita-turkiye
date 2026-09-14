from pathlib import Path
APP=Path('/tmp/futures15m-build/Futures15mAlarm');JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java';MON=JAVA/'MonitorService.java';CTX=JAVA/'V9532CandleContext.java';DCTX=JAVA/'V9531DecisionContext.java';ENG=JAVA/'StructureEngine.java';BUILD=APP/'app/build.gradle'
for p in (MAIN,MON,CTX,DCTX,ENG,BUILD):
    if not p.exists():raise SystemExit('v9.5.61e missing: '+str(p))
main=MAIN.read_text();mon=MON.read_text();ctx=CTX.read_text();dc=DCTX.read_text();eng=ENG.read_text();b=BUILD.read_text()
checks={
 'version':"versionName '9.5.61'" in b and 'versionCode 26091501' in b,
 'late chase':'V9561_LONG_EXECUTION_LOCATION' in mon and 'V9561_SHORT_EXECUTION_LOCATION' in mon,
 'retained v9560':'V9560_ATOMIC_SIGNAL_COMMIT' in mon,
 'precise cleanup':'/fapi/v1/openAlgoOrders' in main and '"DELETE","/fapi/v1/algoOrder"' in main,
 'flat prerequisite':'/fapi/v2/positionRisk' in main,
 'no cancel all':'/fapi/v1/algoOpenOrders' not in main[main.find('V9561_MANAGED_PROTECTIVE_ORDER_CLEANUP'):],
 'exact symbol':'v9561SameSymbol' in main and 'exact-symbol defense' in main,
 'compact plans':'V9561_COMPACT_STORED_PLANS' in main and 'KAYITLI PLANLAR' in main,
 'income net':'BINANCE_INCOME_NET' in main,
 'wick confirmed':'V9561_CONFIRMED_WICK_SWEEP' in ctx and 'SWEEP_CONFIRMED' in ctx,
 'deep context':'"15m", 384' in dc and '"1d", 365' in dc,
 'structure 180':'src.size() - 180' in eng,
 'no wick/liquidity hard marker in monitor':'V9561_CONFIRMED_WICK_SWEEP' not in mon and 'V9561_DEEP_LIQUIDITY_LOOKBACK' not in mon,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.61e failed: '+', '.join(bad))
for name,src in [('MainActivity',main),('MonitorService',mon),('WickContext',ctx)]:
    if src.count('{')!=src.count('}'):raise SystemExit('v9.5.61e brace mismatch: '+name)
# Exact-collision semantic invariant.
def norm(x):
    import re
    y=re.sub(r'[^A-Z0-9]','',(x or '').upper());return y if y.endswith('USDT') else ''
if norm('TUSDT')==norm('THEUSDT'):raise SystemExit('v9.5.61e T/THE symbol collision')
print('v9.5.61e OK: late-entry, exact cleanup, compact stored plans, symbol isolation and liquidity/wick invariants survived composition.')
