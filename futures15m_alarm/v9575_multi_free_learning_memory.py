from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
AGENT=JAVA/'TradeAgentActivity.java'
MON=JAVA/'MonitorService.java'
BRAIN=JAVA/'BrainCore.java'
LEARN=JAVA/'BrainLearning.java'
BUILD=APP/'app/build.gradle'
for p in (AGENT,MON,BRAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.75 missing '+str(p))


def bounds(src,sig):
    a=src.find(sig)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    d=1;i=b+1;state='code';esc=False
    while i<len(src) and d:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if state=='line':
            if c=='\n':state='code'
        elif state=='block':
            if c=='*' and n=='/':state='code';i+=1
        elif state=='str':
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':state='code'
        elif state=='chr':
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":state='code'
        else:
            if c=='/' and n=='/':state='line';i+=1
            elif c=='/' and n=='*':state='block';i+=1
            elif c=='"':state='str'
            elif c=="'":state='chr'
            elif c=='{':d+=1
            elif c=='}':d-=1
        i+=1
    return None if d else (a,i)

def replace_method(src,sig,repl):
    x=bounds(src,sig)
    if not x: raise SystemExit('v9.5.75 method missing: '+sig)
    return src[:x[0]]+repl+src[x[1]:]

agent=AGENT.read_text(); mon=MON.read_text(); brain=BRAIN.read_text(); bf=BUILD.read_text()
for marker in ('V9574_OPENCODE_DEFAULT_REQUEST_RETRY','V9571_OPENCODE_FREE_PROVIDER_GUARD'):
    if marker not in agent: raise SystemExit('v9.5.75 prerequisite missing '+marker)
if 'V9569_BRAIN_CORE' not in brain: raise SystemExit('v9.5.75 BrainCore missing')

# Keep substantially more conversational history. BrainLearning is separate and survives chat clear.
agent=agent.replace('private static final int MAX_HISTORY = 18;','private static final int MAX_HISTORY = 40;',1)

# /models is a catalog, not proof that a model is usable. Broaden the FREE-only candidate
# filter, then actively probe candidates. Only models that really return text enter the pool.
discover=r'''    // V9575_MULTI_FREE_HEALTH_POOL
    private ArrayList<String> discoverFreeModels() throws Exception {
        SharedPreferences sp=getSharedPreferences(PREF,MODE_PRIVATE);
        long now=System.currentTimeMillis();
        String cached=sp.getString("v9575_healthy_free","");
        long ts=sp.getLong("v9575_healthy_free_ts",0L);
        if(cached!=null&&!cached.trim().isEmpty()&&now-ts<10L*60L*1000L){
            ArrayList<String> hit=new ArrayList<>();
            for(String x:cached.split("\\n"))if(x!=null&&!x.trim().isEmpty())hit.add(x.trim());
            if(!hit.isEmpty())return hit;
        }
        String raw=request("GET",baseUrl()+"/models",null,true);
        JSONArray data=new JSONObject(raw).optJSONArray("data");
        ArrayList<String> cand=new ArrayList<>();
        if(data!=null){
            for(int i=0;i<data.length();i++){
                JSONObject o=data.optJSONObject(i); if(o==null)continue;
                String id=o.optString("id",""); if(isFreeModel(id))cand.add(id);
            }
        }
        Collections.sort(cand,Comparator.comparingInt(this::freeScore).reversed());
        ArrayList<String> ok=new ArrayList<>();
        int tested=0;
        for(String id:cand){
            if(tested>=10)break; tested++;
            try{ if(probeFreeModel(id))ok.add(id); }catch(Throwable ignored){}
        }
        if(ok.isEmpty()){
            // Last-resort compatibility: keep OpenCode catalog entries. Existing per-call fallback
            // will still reject a broken provider; no paid-looking id is admitted here.
            for(String id:cand)if(id.toLowerCase(Locale.US).startsWith("oc/")){ok.add(id);if(ok.size()>=3)break;}
        }
        StringBuilder save=new StringBuilder();for(String x:ok){if(save.length()>0)save.append('\n');save.append(x);}
        sp.edit().putString("v9575_healthy_free",save.toString()).putLong("v9575_healthy_free_ts",now).apply();
        return ok;
    }'''
agent=replace_method(agent,'    private ArrayList<String> discoverFreeModels() throws Exception',discover)

isfree=r'''    private boolean isFreeModel(String id) {
        if(id==null)return false;
        String x=id.toLowerCase(Locale.US).trim();
        // FREE-ONLY guard: never include generic paid catalog entries merely because they exist.
        return x.startsWith("oc/") || x.startsWith("free/") || x.startsWith("kr/")
                || x.contains(":free") || x.contains("-free") || x.contains("/free")
                || x.contains("contributor-free");
    }'''
agent=replace_method(agent,'    private boolean isFreeModel(String id)',isfree)

score=r'''    private int freeScore(String id) {
        String x=id==null?"":id.toLowerCase(Locale.US);int s=0;
        if(x.startsWith("oc/"))s+=600;
        if(x.contains("contributor-free"))s+=200;
        if(x.contains(":free")||x.contains("-free")||x.startsWith("free/"))s+=150;
        if(x.contains("1.3"))s+=45;else if(x.contains("1.2"))s+=35;
        return s;
    }'''
agent=replace_method(agent,'    private int freeScore(String id)',score)

probe=r'''
    private boolean probeFreeModel(String model) throws Exception {
        JSONObject b=new JSONObject();b.put("model",model);
        JSONArray m=new JSONArray();m.put(new JSONObject().put("role","user").put("content","Yalnız OK yaz."));
        b.put("messages",m);
        String raw=request("POST",baseUrl()+"/chat/completions",b.toString(),true);
        String out=decodeChatResponse(raw);
        return out!=null&&!out.trim().isEmpty();
    }
'''
anchor='    private ArrayList<String> diverse(ArrayList<String> models, int max)'
if 'private boolean probeFreeModel(' not in agent:
    k=agent.find(anchor)
    if k<0: raise SystemExit('v9.5.75 diverse anchor missing')
    agent=agent[:k]+probe+'\n'+agent[k:]

system=r'''    private String systemPrompt(String market, String app) {
        return "Sen Futures15m Alarm içindeki disiplinli trade araştırma ajanısın. "
                + "Kendini kusursuz veya piyasadan üstün ilan etme. Amaç; sayısal veriyi, çoklu zaman dilimini, akış verisini ve risk mantığını sentezleyerek tutarlı karar desteği vermektir. "
                + "Veri yoksa ASLA uydurma. Kesinlik dili kullanma. Uygulamanın hard-veto, stop, RR, geç giriş ve risk kuralları AI görüşünden üstündür. "
                + "Canlı emir yetkisi AI'da değildir; otomatik işlem motoru yalnız uygulamanın deterministik ve kullanıcı tarafından etkinleştirilmiş sinyallerini işler. "
                + "Trade fikri sorulursa şu sırayı kullan: KARAR (LONG ADAY/SHORT ADAY/BEKLE), GÜVEN 0-100, VERİ KALİTESİ, ANA GEREKÇE, TETİK, INVALIDATION, STOP MANTIĞI, HEDEFLER/RR, KARŞI SENARYO, NEYİ BEKLİYORUZ. "
                + "Kullanıcı sohbet etmek isterse doğal Türkçe konuş.\n\nCANLI SAYISAL BAĞLAM:\n"+market
                + "\n\nUYGULAMA BAĞLAMI:\n"+app
                + "\n\nÖĞRENİM HAFIZASI (geçmiş sinyal/sonuç + önceki ajan konuşmaları):\n"+BrainLearning.summary(this);
    }'''
agent=replace_method(agent,'    private String systemPrompt(String market, String app)',system)

needle='                final String modelInfo = deepMode && models.size() >= 2 ? "DERİN ücretsiz komite" : models.get(0);'
if needle not in agent: raise SystemExit('v9.5.75 modelInfo anchor missing')
agent=agent.replace(needle,needle+'\n                BrainLearning.recordChat(this,q,answer,modelInfo);',1)

learn_java=r'''package com.futuresalarm.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Locale;
import java.text.SimpleDateFormat;
import java.util.Date;

// V9575_BRAIN_LEARNING_MEMORY
// Bounded learning journal. It records evidence/results and summarizes measured history.
// It does not self-modify hard risk rules and never places orders.
public final class BrainLearning {
    private static final String PREF="v9575_brain_learning";
    private static final int MAX_TRADES=120,MAX_CHAT=36;
    private BrainLearning(){}
    private static SharedPreferences p(Context c){return c.getSharedPreferences(PREF,Context.MODE_PRIVATE);}
    private static SharedPreferences app(Context c){return c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);}
    private static double d(SharedPreferences s,String k){try{return Double.parseDouble(s.getString(k,"NaN"));}catch(Throwable e){return Double.NaN;}}
    private static String clip(String x,int n){if(x==null)return "";x=x.replace('\n',' ').trim();return x.length()<=n?x:x.substring(0,n)+"…";}
    private static JSONArray arr(String s){try{return new JSONArray(s==null||s.isEmpty()?"[]":s);}catch(Throwable e){return new JSONArray();}}
    private static JSONArray prepend(JSONArray old,JSONObject x,int max){JSONArray n=new JSONArray();n.put(x);for(int i=0;i<old.length()&&i<max-1;i++)n.put(old.opt(i));return n;}

    public static synchronized void recordSignal(Context c,String symbol){
        try{
            SharedPreferences a=app(c),sp=p(c);JSONObject o=new JSONObject();long ts=a.getLong("v9518_signal_time_"+symbol,System.currentTimeMillis());
            o.put("symbol",symbol).put("ts",ts).put("side",a.getString("v9518_signal_side_"+symbol,"?"))
             .put("reason",a.getString("v9518_signal_reason_short_"+symbol,"?"));
            double e=d(a,"v9518_signal_price_"+symbol),st=d(a,"v9518_signal_stop_"+symbol),t1=d(a,"v9518_signal_tp1_"+symbol),t2=d(a,"v9518_signal_tp2_"+symbol),t3=d(a,"v9518_signal_tp3_"+symbol);
            if(!Double.isNaN(e))o.put("entry",e);if(!Double.isNaN(st))o.put("stop",st);if(!Double.isNaN(t1))o.put("tp1",t1);if(!Double.isNaN(t2))o.put("tp2",t2);if(!Double.isNaN(t3))o.put("tp3",t3);
            sp.edit().putString("trades",prepend(arr(sp.getString("trades","[]")),o,MAX_TRADES).toString()).apply();
        }catch(Throwable ignored){}
    }

    public static synchronized void recordOutcome(Context c,String symbol,double pct,String state){
        try{
            SharedPreferences sp=p(c);JSONArray a=arr(sp.getString("trades","[]"));JSONObject target=null;
            for(int i=0;i<a.length();i++){JSONObject o=a.optJSONObject(i);if(o!=null&&symbol.equals(o.optString("symbol"))&&!o.has("end")){target=o;break;}}
            if(target==null){target=new JSONObject().put("symbol",symbol);a=prepend(a,target,MAX_TRADES);}
            target.put("end",System.currentTimeMillis()).put("state",state==null?"":state);if(!Double.isNaN(pct))target.put("pct",pct);
            String bucket=(target.optString("side","?")+"|"+target.optString("reason","?")).toLowerCase(Locale.US);
            int n=sp.getInt("n_"+bucket,0)+1,w=sp.getInt("w_"+bucket,0);double sum=Double.longBitsToDouble(sp.getLong("sum_"+bucket,Double.doubleToRawLongBits(0d)));
            if(!Double.isNaN(pct)){sum+=pct;if(pct>0)w++;}
            sp.edit().putString("trades",a.toString()).putInt("n_"+bucket,n).putInt("w_"+bucket,w).putLong("sum_"+bucket,Double.doubleToRawLongBits(sum)).apply();
        }catch(Throwable ignored){}
    }

    public static synchronized void recordChat(Context c,String q,String a,String model){
        try{SharedPreferences sp=p(c);JSONObject o=new JSONObject().put("ts",System.currentTimeMillis()).put("q",clip(q,180)).put("a",clip(a,320)).put("model",model==null?"":model);sp.edit().putString("chat",prepend(arr(sp.getString("chat","[]")),o,MAX_CHAT).toString()).apply();}catch(Throwable ignored){}
    }

    public static synchronized void recordExecution(Context c,String symbol,String status){
        p(c).edit().putString("exec_"+symbol,(status==null?"":status)).putLong("exec_ts_"+symbol,System.currentTimeMillis()).apply();
    }

    public static String summary(Context c){
        try{
            SharedPreferences sp=p(c);JSONArray t=arr(sp.getString("trades","[]")),ch=arr(sp.getString("chat","[]"));int closed=0,w=0;double sum=0;StringBuilder recent=new StringBuilder();
            for(int i=0;i<t.length();i++){JSONObject o=t.optJSONObject(i);if(o==null)continue;if(o.has("pct")){double x=o.optDouble("pct",Double.NaN);if(!Double.isNaN(x)){closed++;sum+=x;if(x>0)w++;}}if(i<6){if(recent.length()>0)recent.append(" | ");recent.append(o.optString("symbol","?")).append(' ').append(o.optString("side","?")).append(' ').append(o.optString("state","AÇIK"));if(o.has("pct"))recent.append(String.format(Locale.US," %+.2f%%",o.optDouble("pct")));}}
            StringBuilder qs=new StringBuilder();for(int i=0;i<ch.length()&&i<5;i++){JSONObject o=ch.optJSONObject(i);if(o==null)continue;if(qs.length()>0)qs.append(" | ");qs.append(clip(o.optString("q",""),80));}
            return "LEARNING_V=1 CLOSED="+closed+" WINS="+w+" WINRATE="+(closed>0?String.format(Locale.US,"%.1f%%",100.0*w/closed):"NA")+" AVG_SIGNAL_PCT="+(closed>0?String.format(Locale.US,"%+.3f%%",sum/closed):"NA")+"\nRECENT_TRADES="+(recent.length()>0?recent:"yok")+"\nRECENT_CHAT_TOPICS="+(qs.length()>0?qs:"yok")+"\nRULE=Geçmiş performans bağlamdır; hard risk kurallarını otomatik gevşetmez.";
        }catch(Throwable e){return "LEARNING=UNAVAILABLE";}
    }
}
'''
LEARN.write_text(learn_java)

# Feed every real signal and terminal outcome into the learning journal.
needle='        v9518RecordSignal(symbol, v9518RawDirection, detail);'
if needle not in mon: raise SystemExit('v9.5.75 signal hook anchor missing')
mon=mon.replace(needle,needle+'\n        BrainLearning.recordSignal(this, symbol);',1)
needle2='        prefs.edit().putString("v9518_history_"+symbol,keep.toString()).apply();'
if needle2 not in mon: raise SystemExit('v9.5.75 finish hook anchor missing')
mon=mon.replace(needle2,needle2+'\n        BrainLearning.recordOutcome(this, symbol, pct, state);',1)

# Final identity for this patch; next auto-execution patch will advance it again.
agent=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.75',agent)
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.75',mon)
brain=brain.replace('BRAIN_CORE=v9.5.71','BRAIN_CORE=v9.5.75').replace('BRAIN_CORE=v9.5.69','BRAIN_CORE=v9.5.75')
bf=re.sub(r'versionCode\s+\d+','versionCode 26091515',bf,count=1);bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.75'",bf,count=1)
AGENT.write_text(agent);MON.write_text(mon);BRAIN.write_text(brain);BUILD.write_text(bf)

checks={
 'multi-free health pool':'V9575_MULTI_FREE_HEALTH_POOL' in AGENT.read_text() and 'probeFreeModel' in AGENT.read_text(),
 'free-only guard':'contributor-free' in AGENT.read_text() and 'isFreeModel' in AGENT.read_text(),
 'history 40':'MAX_HISTORY = 40' in AGENT.read_text(),
 'learning class':'V9575_BRAIN_LEARNING_MEMORY' in LEARN.read_text(),
 'chat memory':'BrainLearning.recordChat' in AGENT.read_text() and 'BrainLearning.summary(this)' in AGENT.read_text(),
 'signal outcome hooks':'BrainLearning.recordSignal' in MON.read_text() and 'BrainLearning.recordOutcome' in MON.read_text(),
 'brain retained':'V9569_BRAIN_CORE' in BRAIN.read_text(),
 'request fix retained':'V9574_OPENCODE_DEFAULT_REQUEST_RETRY' in AGENT.read_text(),
 'version':"versionName '9.5.75'" in BUILD.read_text(),
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.75 sanity failed: '+', '.join(bad))
print('v9.5.75 OK: healthy FREE-only multi-model pool + persistent brain learning journal + prior chat memory in agent context.')
