from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
AGENT=APP/'app/src/main/java/com/futuresalarm/app/TradeAgentActivity.java'
if not AGENT.exists():raise SystemExit('v9.5.75b agent missing')
s=AGENT.read_text()
if 'V9575_MULTI_FREE_HEALTH_POOL' not in s:raise SystemExit('v9.5.75b health pool missing')
old='''        for(String id:cand){\n            if(tested>=10)break; tested++;\n            try{ if(probeFreeModel(id))ok.add(id); }catch(Throwable ignored){}\n        }'''
new='''        for(String id:cand){\n            // V9575B_FREE_PROBE_LATENCY_GUARD: known-good OpenCode entries are ranked first.\n            // Probe only a bounded sample so one dead free provider cannot stall the agent for minutes.\n            if(tested>=6 || ok.size()>=4)break; tested++;\n            try{ if(probeFreeModel(id))ok.add(id); }catch(Throwable ignored){}\n        }'''
if old not in s:raise SystemExit('v9.5.75b loop anchor missing')
s=s.replace(old,new,1)
AGENT.write_text(s)
if 'tested>=6 || ok.size()>=4' not in AGENT.read_text():raise SystemExit('v9.5.75b guard missing')
print('v9.5.75b OK: free-model health discovery is bounded to <=6 probes and stops after 4 healthy FREE models.')
