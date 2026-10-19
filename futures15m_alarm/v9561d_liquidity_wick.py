from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
CTX=JAVA/'V9532CandleContext.java'; DCTX=JAVA/'V9531DecisionContext.java'; ENG=JAVA/'StructureEngine.java'
MAIN=JAVA/'MainActivity.java'; MON=JAVA/'MonitorService.java'; ANA=JAVA/'AnalysisPackActivity.java'; BUILD=APP/'app/build.gradle'
for p in (CTX,DCTX,ENG,MAIN,MON,ANA,BUILD):
    if not p.exists():raise SystemExit('v9.5.61d missing: '+str(p))

c=CTX.read_text()
old='''        if (f.lowerPct >= 48 && f.upperPct >= 30) f.wick = "İKİ_TARAFLI_SÜPÜRME/KARARSIZ";\n        else if (f.lowerPct >= 48) f.wick = "ALT_FİTİL_REJECTION/SSL_SWEEP_ADAY";\n        else if (f.upperPct >= 48) f.wick = "ÜST_FİTİL_REJECTION/BSL_SWEEP_ADAY";\n        else f.wick = "NÖTR";'''
if 'V9561_CONFIRMED_WICK_SWEEP' not in c:
    if old not in c:raise SystemExit('v9.5.61d wick anchor missing')
    c=c.replace(old,'''        // V9561_CONFIRMED_WICK_SWEEP — context only, never a hard vote.\n        boolean v9561LowerSweep=f.lowerPct>=48&&v9561ConfirmedSweep(a,n-1,false,atr);\n        boolean v9561UpperSweep=f.upperPct>=48&&v9561ConfirmedSweep(a,n-1,true,atr);\n        if(f.lowerPct>=48&&f.upperPct>=30) f.wick=(v9561LowerSweep||v9561UpperSweep)?"İKİ_TARAFLI_SWEEP_CONFIRMED/KARARSIZ":"İKİ_TARAFLI_REJECTION/KARARSIZ";\n        else if(f.lowerPct>=48) f.wick=v9561LowerSweep?"ALT_FİTİL_REJECTION/SSL_SWEEP_CONFIRMED":"ALT_FİTİL_REJECTION";\n        else if(f.upperPct>=48) f.wick=v9561UpperSweep?"ÜST_FİTİL_REJECTION/BSL_SWEEP_CONFIRMED":"ÜST_FİTİL_REJECTION";\n        else f.wick="NÖTR";''',1)
    idx=c.find('    private static boolean bullEngulf(')
    if idx<0:raise SystemExit('v9.5.61d helper anchor missing')
    helper=r'''
    private static boolean v9561ConfirmedSweep(List<AnalysisPackActivity.Candle> a,int idx,boolean high,double atr) {
        if(a==null||idx<5||idx>=a.size())return false;AnalysisPackActivity.Candle cur=a.get(idx);
        double px=Math.max(1e-12,cur.close),tol=Math.max(px*0.00035,finite(atr)&&atr>0?atr*0.04:px*0.00035);
        double reclaim=Math.max(px*0.00012,finite(atr)&&atr>0?atr*0.015:px*0.00012);int from=Math.max(2,idx-32);
        for(int j=idx-2;j>=from;j--){AnalysisPackActivity.Candle x=a.get(j);
            boolean pivot=high?x.high>a.get(j-1).high&&x.high>=a.get(j-2).high&&x.high>=a.get(j+1).high&&x.high>=a.get(j+2).high
                    :x.low<a.get(j-1).low&&x.low<=a.get(j-2).low&&x.low<=a.get(j+1).low&&x.low<=a.get(j+2).low;
            if(!pivot)continue;double level=high?x.high:x.low;boolean swept=false;
            for(int k=j+1;k<idx;k++){AnalysisPackActivity.Candle q=a.get(k);if(high?q.high>level+tol:q.low<level-tol){swept=true;break;}}
            if(swept)continue;if(high&&cur.high>level+tol&&cur.close<level-reclaim)return true;
            if(!high&&cur.low<level-tol&&cur.close>level+reclaim)return true;
        }return false;
    }

'''
    c=c[:idx]+helper+c[idx:]
CTX.write_text(c)

d=DCTX.read_text()
for oldv,newv in {
 'safeKlines(symbol, "15m", 192)':'safeKlines(symbol, "15m", 384)',
 'safeKlines(symbol, "30m", 120)':'safeKlines(symbol, "30m", 240)',
 'safeKlines(symbol, "1h", 120)':'safeKlines(symbol, "1h", 240)',
 'safeKlines(symbol, "2h", 120)':'safeKlines(symbol, "2h", 180)',
 'safeKlines(symbol, "4h", 120)':'safeKlines(symbol, "4h", 180)',
 'safeKlines(symbol, "1d", 90)':'safeKlines(symbol, "1d", 365)',
}.items():
    if oldv in d:d=d.replace(oldv,newv,1)
    elif newv not in d:raise SystemExit('v9.5.61d lookback missing: '+oldv)
if 'V9561_DEEP_LIQUIDITY_LOOKBACK' not in d:
    p=d.find('\n',d.find('final class V9531DecisionContext'));d=d[:p+1]+'    // V9561_DEEP_LIQUIDITY_LOOKBACK — background numerical history only.\n'+d[p+1:]
DCTX.write_text(d)

e=ENG.read_text()
if 'src.size() - 100' in e:e=e.replace('src.size() - 100','src.size() - 180',1)
if 'V9561_STRUCTURE_LOOKBACK_180' not in e:
    p=e.find('\n',e.find('final class StructureEngine'));e=e[:p+1]+'    // V9561_STRUCTURE_LOOKBACK_180 — deeper context, no extra hard vote.\n'+e[p+1:]
ENG.write_text(e)

for p in (MAIN,MON,ANA):
    z=p.read_text();z=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.61',z)
    z=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.61',z)
    z=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.61  •  MANUEL PRO',z);p.write_text(z)
b=BUILD.read_text();b=re.sub(r'versionCode\s+\d+','versionCode 26091501',b,count=1);b=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.61'",b,count=1);BUILD.write_text(b)
print('v9.5.61d OK: wick sweep requires actual unswept-pivot raid/reclaim; background liquidity lookback deepened without adding a hard veto.')
