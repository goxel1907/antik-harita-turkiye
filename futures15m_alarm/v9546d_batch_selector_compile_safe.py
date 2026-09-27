from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java';ANA=JAVA/'AnalysisPackActivity.java';MON=JAVA/'MonitorService.java';BUILD=APP/'app/build.gradle'
for p in (MAIN,ANA,MON,BUILD):
    if not p.exists():raise SystemExit('v9.5.46d missing '+str(p))


def bal(text,label):
    b=p=q=0;i=0;ss=sc=esc=lc=bc=False
    while i<len(text):
        c=text[i];n=text[i+1] if i+1<len(text) else ''
        if lc:
            if c=='\n':lc=False
        elif bc:
            if c=='*' and n=='/':bc=False;i+=1
        elif ss:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':ss=False
        elif sc:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":sc=False
        else:
            if c=='/' and n=='/':lc=True;i+=1
            elif c=='/' and n=='*':bc=True;i+=1
            elif c=='"':ss=True
            elif c=="'":sc=True
            elif c=='{':b+=1
            elif c=='}':b-=1
            elif c=='(':p+=1
            elif c==')':p-=1
            elif c=='[':q+=1
            elif c==']':q-=1
            if b<0 or p<0 or q<0:raise SystemExit(label+' lexical underflow')
        i+=1
    if ss or sc or bc or b or p or q:raise SystemExit(f'{label} unbalanced b={b} p={p} q={q}')

main=MAIN.read_text();ana=ANA.read_text();mon=MON.read_text();bf=BUILD.read_text()
bal(main,'MainActivity.java');bal(ana,'AnalysisPackActivity.java');bal(mon,'MonitorService.java')
checks={
 'radar/manual selector':'V9546C_BATCH_RADAR_MANUAL_SELECTOR' in main,
 'latest radar':'V9538MarketRadarEngine.latestJson(this)' in main,
 'manual field':'MANUEL COİN GİRİŞİ' in main and 'final EditText manual' in main,
 'dedupe':'java.util.LinkedHashSet<String> chosen' in main,
 '2-8 limit':'chosen.size()<2||chosen.size()>8' in main,
 'old plans not auto selected':'Eski analizli coinler otomatik seçilmez' in main,
 'batch engine retained':'V9545_BATCH_FIELDS' in ana and 'v9545BatchInternalKick' in ana,
 'delete shortcut retained':'V9546_ANALYSIS_DELETE_SHORTCUT' in main and 'V9546A_PRECISE_DELETE_TARGET' in main,
 'signal persistence retained':'v9543b_strict_ticket_' in main,
 'quick order retained':'V9543C_SINGLE_TAP_APPROVAL' in main,
 'late entry retained':'V9543C_EXECUTION_DRIFT_RECHECK' in main and 'dv>0.50' in main,
 'version unchanged':'v9.5.46' in main and 'versionCode 26091310' in bf and "versionName '9.5.46'" in bf,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.46d sanity failed: '+', '.join(bad))
print('v9.5.46d OK: radar/manual batch selector compiles and existing trading safety remains intact.')
