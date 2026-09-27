from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
AGENT = JAVA / 'TradeAgentActivity.java'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANA = JAVA / 'AnalysisPackActivity.java'
BRAIN = JAVA / 'BrainCore.java'
BUILD = APP / 'app/build.gradle'
for p in (AGENT, MAIN, MON, ANA, BRAIN, BUILD):
    if not p.exists(): raise SystemExit('v9.5.70c identity file missing: '+str(p))

agent=AGENT.read_text(); main=MAIN.read_text(); mon=MON.read_text(); ana=ANA.read_text(); brain=BRAIN.read_text(); bf=BUILD.read_text()
if 'V9570_9ROUTER_SSE_RESPONSE' not in agent:
    raise SystemExit('v9.5.70c SSE fix missing')

# Codemagic artifact is still v9.5.69. Keep final installed identity aligned for this hotfix.
# The internal V9570 marker remains, so the SSE fix is still verifiable.
agent=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',agent)
main=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.69',main)
main=re.sub(r'v9\.5(?:\.\d+)+','v9.5.69',main)
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.69',mon)
ana=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.69',ana)
ana=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',ana)
brain=brain.replace('BRAIN_CORE=v9.5.70','BRAIN_CORE=v9.5.69')
brain=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',brain)
bf=re.sub(r'versionCode\s+\d+','versionCode 26091509',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.69'",bf,count=1)
AGENT.write_text(agent); MAIN.write_text(main); MON.write_text(mon); ANA.write_text(ana); BRAIN.write_text(brain); BUILD.write_text(bf)

checks=[
    'V9570_9ROUTER_SSE_RESPONSE' in AGENT.read_text(),
    'decodeChatResponse' in AGENT.read_text(),
    'choice.optJSONObject("delta")' in AGENT.read_text(),
    'V9569_BRAIN_CORE' in BRAIN.read_text(),
    "versionName '9.5.69'" in BUILD.read_text(),
    'versionCode 26091509' in BUILD.read_text(),
]
if not all(checks): raise SystemExit('v9.5.70c release identity alignment failed')
print('v9.5.70c OK: SSE hotfix retained; final installed/artifact identity remains aligned with Codemagic v9.5.69.')
