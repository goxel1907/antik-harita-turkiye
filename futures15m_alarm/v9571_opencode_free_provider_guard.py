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
    if not p.exists(): raise SystemExit('v9.5.71 missing required file: '+str(p))

def method_bounds(src, sig):
    a=src.find(sig)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    depth=1;i=b+1;state='code';esc=False
    while i<len(src) and depth:
        c=src[i]; n=src[i+1] if i+1<len(src) else ''
        if state=='line':
            if c=='\n': state='code'
            i+=1; continue
        if state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
            i+=1; continue
        if state=='string':
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': state='code'
            i+=1; continue
        if state=='char':
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": state='code'
            i+=1; continue
        if c=='/' and n=='/': state='line'; i+=2; continue
        if c=='/' and n=='*': state='block'; i+=2; continue
        if c=='"': state='string'
        elif c=="'": state='char'
        elif c=='{': depth+=1
        elif c=='}': depth-=1
        i+=1
    return None if depth else (a,b,i)

def replace_method(src,sig,repl):
    x=method_bounds(src,sig)
    if not x: raise SystemExit('v9.5.71 method missing: '+sig)
    a,_,e=x
    return src[:a]+repl+src[e:]

agent=AGENT.read_text(); main=MAIN.read_text(); mon=MON.read_text(); ana=ANA.read_text(); brain=BRAIN.read_text(); bf=BUILD.read_text()
if 'V9570_9ROUTER_SSE_RESPONSE' not in agent: raise SystemExit('v9.5.71 requires SSE fix')
if 'V9569_BRAIN_CORE' not in brain: raise SystemExit('v9.5.71 requires Brain Core')

# /v1/models is a catalog and may contain free-looking models for providers without credentials.
# The user's verified zero-auth provider is OpenCode Free. Restrict automatic routing to oc/*
# so the agent never selects Kilo Gateway or another unconfigured provider by mistake.
discover = r'''    // V9571_OPENCODE_FREE_PROVIDER_GUARD
    private ArrayList<String> discoverFreeModels() throws Exception {
        String raw = request("GET", baseUrl() + "/models", null, true);
        JSONArray data = new JSONObject(raw).optJSONArray("data");
        ArrayList<String> out = new ArrayList<>();
        if (data != null) {
            for (int i=0;i<data.length();i++) {
                String id = data.getJSONObject(i).optString("id","");
                if (isFreeModel(id)) out.add(id);
            }
        }
        Collections.sort(out, Comparator.comparingInt(this::freeScore).reversed());
        return out;
    }'''
agent=replace_method(agent,'    private ArrayList<String> discoverFreeModels() throws Exception',discover)

isfree = r'''    private boolean isFreeModel(String id) {
        if (id == null) return false;
        String x = id.toLowerCase(Locale.US).trim();
        return x.startsWith("oc/");
    }'''
agent=replace_method(agent,'    private boolean isFreeModel(String id)',isfree)

score = r'''    private int freeScore(String id) {
        String x=id==null?"":id.toLowerCase(Locale.US); int s=1000;
        if(x.contains("1.3")) s+=30;
        if(x.contains("1.2")) s+=20;
        if(x.contains("contributor-free")) s+=10;
        return s;
    }'''
agent=replace_method(agent,'    private int freeScore(String id)',score)

agent=agent.replace('9Router ücretsiz model döndürmedi. AYAR bölümünden endpoint/API anahtarını kontrol et.','OpenCode Free modeli bulunamadı. 9Router > Sağlayıcılar > OpenCode Free durumunu kontrol et.')
agent=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.71',agent)
main=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.71',main)
main=re.sub(r'v9\.5(?:\.\d+)+','v9.5.71',main)
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.71',mon)
ana=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.71',ana)
ana=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.71',ana)
brain=brain.replace('BRAIN_CORE=v9.5.69','BRAIN_CORE=v9.5.71').replace('BRAIN_CORE=v9.5.70','BRAIN_CORE=v9.5.71')
brain=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.71',brain)
bf=re.sub(r'versionCode\s+\d+','versionCode 26091511',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.71'",bf,count=1)
AGENT.write_text(agent); MAIN.write_text(main); MON.write_text(mon); ANA.write_text(ana); BRAIN.write_text(brain); BUILD.write_text(bf)

checks={
 'provider guard':'V9571_OPENCODE_FREE_PROVIDER_GUARD' in AGENT.read_text(),
 'only oc':'return x.startsWith("oc/");' in AGENT.read_text(),
 'no kilo auto':'x.contains(":free")' not in AGENT.read_text(),
 'sse retained':'V9570_9ROUTER_SSE_RESPONSE' in AGENT.read_text() and 'decodeChatResponse' in AGENT.read_text(),
 'brain retained':'V9569_BRAIN_CORE' in BRAIN.read_text(),
 'same chat retained':'V9567_CLIPBOARD_GALLERY_SAME_CHAT' in ANA.read_text(),
 'version':"versionName '9.5.71'" in BUILD.read_text() and 'versionCode 26091511' in BUILD.read_text(),
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.71 sanity failed: '+', '.join(bad))
print('v9.5.71 OK: automatic free routing is pinned to verified OpenCode Free oc/* models; Kilo Gateway/unconfigured free-looking catalog models are excluded. SSE + Brain flows retained.')
