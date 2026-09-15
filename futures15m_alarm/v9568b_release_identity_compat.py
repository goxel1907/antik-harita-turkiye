from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANA = JAVA / 'AnalysisPackActivity.java'
AGENT = JAVA / 'TradeAgentActivity.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, MON, ANA, AGENT, BUILD):
    if not p.exists(): raise SystemExit('v9.5.68b identity file missing: '+str(p))

# Codemagic workflow/artifact is still named v9.5.67. Keep the installed APK's
# visible/versionCode identity consistent instead of shipping a mismatched label.
main=MAIN.read_text(); mon=MON.read_text(); ana=ANA.read_text(); agent=AGENT.read_text(); bf=BUILD.read_text()
main=re.sub(r'v9\.5(?:\.\d+)+','v9.5.67',main)
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.67',mon)
ana=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.67',ana)
ana=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.67',ana)
agent=agent.replace('Futures15mAlarmPRO/9.5.68','Futures15mAlarmPRO/9.5.67')
bf=re.sub(r'versionCode\s+\d+','versionCode 26091507',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.67'",bf,count=1)
MAIN.write_text(main); MON.write_text(mon); ANA.write_text(ana); AGENT.write_text(agent); BUILD.write_text(bf)

checks=[
    'V9568_FREE_FIRST_TRADE_AGENT' in AGENT.read_text(),
    'V9568_TRADE_AGENT_LAUNCH' in MAIN.read_text(),
    'v9.5.67' in MAIN.read_text(),
    "versionName '9.5.67'" in BUILD.read_text(),
    'versionCode 26091507' in BUILD.read_text(),
]
if not all(checks): raise SystemExit('v9.5.68b release identity alignment failed')
print('v9.5.68b OK: free trade agent retained; installed/build identity remains aligned with Codemagic v9.5.67 artifact.')
