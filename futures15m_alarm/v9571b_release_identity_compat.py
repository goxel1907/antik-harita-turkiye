from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
AGENT=JAVA/'TradeAgentActivity.java'; MAIN=JAVA/'MainActivity.java'; MON=JAVA/'MonitorService.java'; ANA=JAVA/'AnalysisPackActivity.java'; BRAIN=JAVA/'BrainCore.java'; BUILD=APP/'app/build.gradle'
for p in (AGENT,MAIN,MON,ANA,BRAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.71b identity file missing: '+str(p))
agent=AGENT.read_text();main=MAIN.read_text();mon=MON.read_text();ana=ANA.read_text();brain=BRAIN.read_text();bf=BUILD.read_text()
if 'V9571_OPENCODE_FREE_PROVIDER_GUARD' not in agent: raise SystemExit('v9.5.71b provider guard missing')
# Current Codemagic artifact remains v9.5.69; keep installed identity aligned while retaining hotfix markers.
agent=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',agent)
main=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.69',main)
main=re.sub(r'v9\.5(?:\.\d+)+','v9.5.69',main)
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.69',mon)
ana=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.69',ana)
ana=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',ana)
brain=brain.replace('BRAIN_CORE=v9.5.71','BRAIN_CORE=v9.5.69')
brain=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',brain)
bf=re.sub(r'versionCode\s+\d+','versionCode 26091509',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.69'",bf,count=1)
AGENT.write_text(agent);MAIN.write_text(main);MON.write_text(mon);ANA.write_text(ana);BRAIN.write_text(brain);BUILD.write_text(bf)
checks=['V9571_OPENCODE_FREE_PROVIDER_GUARD' in AGENT.read_text(),'V9570_9ROUTER_SSE_RESPONSE' in AGENT.read_text(),"versionName '9.5.69'" in BUILD.read_text(),'versionCode 26091509' in BUILD.read_text()]
if not all(checks): raise SystemExit('v9.5.71b release identity alignment failed')
print('v9.5.71b OK: OpenCode provider guard + SSE fix retained; final installed/artifact identity aligned at v9.5.69.')
