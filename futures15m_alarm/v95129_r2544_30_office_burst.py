"""R2544.30: bounded PC position sync, accurate decision labels and BURST details.
Android remains a PC control/telemetry client; no order initiation.
"""
from pathlib import Path
import re

APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
def replace(text, old, new):
    if old not in text:
        raise SystemExit("V95129 missing anchor: " + old[:100])
    return text.replace(old, new, 1)

client = (JAVA / "BrainHubClient.java").read_text(encoding="utf-8")
if "V95128_R2544_29_BURST_443" not in client:
    raise SystemExit("V95129 requires V95128")
client = replace(client, 'return get(c, "/live/positions");',
                 'return get(c, "/live/positions?limit=5&compact=1");')
client = replace(client, 'body = raw.trim().isEmpty() ? new JSONObject() : new JSONObject(raw);',
                 'if (!raw.trim().isEmpty() && !raw.trim().startsWith("{")) throw new Exception("PC JSON yerine sayfa döndürdü; bağlantı doğrulanamadı");\n'
                 '                body = raw.trim().isEmpty() ? new JSONObject() : new JSONObject(raw);')

card = (JAVA / "AutoDecisionCard.java").read_text(encoding="utf-8")
card = card.replace("9 zaman dilimli plan henüz işlem adayı değil", "JEV bu aday için giriş onayı vermedi")
card = card.replace("9 ZAMAN DİLİMLİ PLAN HENÜZ İŞLEM ADAYI DEĞİL", "JEV BU ADAY İÇİN GİRİŞ ONAYI VERMEDİ")
card = replace(card, 'trPlan(val(row,"planStatus",""))', 'v95129Plan(row)')
card = replace(card, 'String plan=val(r,"planStatus","Henüz plan yok");b.append("\\nPlan: ").append(trPlan(plan));',
               'b.append("\\nPlan: ").append(v95129Plan(r));')
card = replace(card, '    private static String trPlan(String x){', '''    private static String v95129Plan(JSONObject row){
        String plan=row.optString("planStatus","");
        if (!plan.isEmpty()) return trPlan(plan);
        if (row.optBoolean("orderPlaced",false) || "LIVE_SENT".equals(row.optString("execution","")))
            return "PC emri gönderdi; giriş planı kaydı";
        return "Bu kayıtta plan durumu yayınlanmadı";
    }
    private static String trPlan(String x){''')

truth = (JAVA / "V95113PcTruth.java").read_text(encoding="utf-8")
# Older PC versions ignore compact=1. Prefer their durable all-row performance
# totals to the five-row history sample until the new core is safely deployed.
truth = replace(truth, 'JSONObject sum = src.optJSONObject("summary");',
                '''JSONObject sum = src.optJSONObject("summary");
            JSONObject allPerformance=src.optJSONObject("performance");
            if (allPerformance!=null && allPerformance.optJSONObject("total")!=null) sum=allPerformance.optJSONObject("total");''')
truth = replace(truth, 'JSONArray v95127Desks = src.optJSONArray("deskSummary"), v95127D2 = new JSONArray();',
                'JSONArray v95127Desks = v95129AllDesks(src), v95127D2 = new JSONArray();')
truth = replace(truth, '    static String v95127ExitTr', '''    private static JSONArray v95129AllDesks(JSONObject src) throws Exception {
        JSONArray normal=src.optJSONArray("deskSummary");
        if ("ALL_RECONCILED_CLOSED_TRADES".equals(src.optString("summaryScope",""))) return normal;
        JSONObject p=src.optJSONObject("performance");
        JSONArray desks=p==null?null:p.optJSONArray("desks");
        if(desks==null)return normal;
        JSONArray out=new JSONArray(),opened=src.optJSONArray("open");
        for(int i=0;i<desks.length();i++){
            JSONObject d=desks.optJSONObject(i);if(d==null)continue;
            String name=d.optString("desk","");JSONArray cohorts=d.optJSONArray("cohorts");
            int count=0,wins=0,losses=0,rn=0,open=0;double net=0,rs=0;
            if(cohorts!=null)for(int n=0;n<cohorts.length();n++){
                JSONObject c=cohorts.optJSONObject(n);if(c==null)continue;
                count+=c.optInt("closed",0);wins+=c.optInt("wins",0);losses+=c.optInt("losses",0);net+=c.optDouble("netPnl",0);
                int samples=c.optInt("rSamples",0);double avg=c.optDouble("avgR",Double.NaN);
                if(samples>0&&!Double.isNaN(avg)){rn+=samples;rs+=avg*samples;}
            }
            if(opened!=null)for(int n=0;n<opened.length();n++){
                JSONObject x=opened.optJSONObject(n);if(x!=null&&name.equals(x.optString("lane","")))open++;
            }
            JSONObject row=new JSONObject();row.put("desk",name);row.put("closed",count);row.put("wins",wins);row.put("losses",losses);
            row.put("netPnl",net);row.put("open",open);row.put("winRatePct",count>0?100.0*wins/count:JSONObject.NULL);row.put("avgR",rn>0?rs/rn:JSONObject.NULL);
            out.put(row);
        }
        return out;
    }
    static String v95127ExitTr''')
truth = replace(truth, '.append("\\n  Son kapanışlar ")', '.append("\\n  Tüm kayıtlı kapanışlar ")')
truth = replace(truth, 'String[] keys = {"symbol", "side", "entryPrice", "markPrice", "unrealizedPnl", "unrealizedR", "stopPrice", "runnerPhase", "openedBy"};',
                'String[] keys = {"symbol", "side", "quantity", "leverage", "lane", "originTF", "openedAt", "entryPrice", "markPrice", "unrealizedPnl", "unrealizedR", "stopPrice", "runnerPhase", "openedBy"};')
truth = replace(truth, 'b.append("\\n• ").append(str(x, "symbol")).append(" ").append(str(x, "side")).append(" • JEV koşullu izin");',
                '''b.append("\\n• ").append(str(x, "symbol")).append(" ").append(str(x, "side")).append(" • JEV seçti");
            if (x != null) {
                b.append(" • yetki ").append(Math.max(0L,x.optLong("remainingMs",0L))/1000L).append(" sn");
                JSONObject t=x.optJSONObject("telemetry");
                if (t != null) {
                    String st=t.optString("state","");
                    b.append(" • ").append("TRIGGER_READY".equals(st)?"tetik hazır / güvenlik kontrolü":"DATA_NOT_READY".equals(st)?"veri bekleniyor":"tetik bekleniyor");
                    if (t.has("score") && !t.isNull("score")) b.append(" • güç ").append(Math.round(t.optDouble("score",0)*100)).append("% (olasılık değil)");
                }
            }''')
truth = replace(truth, 'b.append("\\nBURST emirleri yalnız PC/JEV tarafından yürütülür.");',
                '''if (v95128Armed == null || v95128Armed.length()==0) b.append("\\nJEV'in ön-yetki verdiği coin yok.");
        JSONObject review=v95128Burst.optJSONObject("lastArmReview");
        if (review!=null) {
            b.append("\\nSon JEV seçim turu: ").append(review.optString("at","—"));
            JSONArray results=review.optJSONArray("results");
            if (results!=null) for(int i=0;i<Math.min(4,results.length());i++){
                JSONObject x=results.optJSONObject(i);if(x==null)continue;
                b.append("\\n• ").append(x.optString("symbol","")).append(": ").append(x.optBoolean("armed",false)?"JEV seçti":"ön-yetki yok").append(" • ").append(x.optString("reason",x.optString("decision","")));
            }
        }
        b.append("\\nBURST emirleri yalnız PC/JEV tarafından yürütülür.");''')

main = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
# Display-only annotation. Preserve old signal records and execution locks.
main = replace(main, 'String state=sp.getString("v9518_signal_state_"+symbol,"-");',
               'String state=v95129SignalLabel(sp,symbol,sp.getString("v9518_signal_state_"+symbol,"-"));')
main = replace(main, 'String state=sp.getString("v9558_journal_state_"+id,"AÇIK");',
               'String state=v95129SignalLabel(sp,sym,sp.getString("v9558_journal_state_"+id,"AÇIK"));')
main = replace(main, 'append(active?"AKTİF":"SONLANDI/KAYITLI")', 'append(active?"YEREL ALARM KAYDI":"SONLANDI/KAYITLI")')
anchor = '    private String v9518SignalOzet(String symbol) {'
main = replace(main, anchor, '''    private String v95129SignalLabel(android.content.SharedPreferences sp,String symbol,String previous) {
        if (System.currentTimeMillis()-sp.getLong("v95113_pc_positions_ok_ts",0L)>30000L)
            return "YEREL ALARM KAYDI • PC pozisyonu doğrulanmadı";
        try {
            org.json.JSONObject p=new org.json.JSONObject(sp.getString("v95113_pc_positions_json","{}"));
            if (!p.optBoolean("ledgerOk",false)) return "PC defteri doğrulanmadı • yerel alarm kaydı";
            org.json.JSONArray rows=p.optJSONArray("open");
            if (rows!=null) for(int i=0;i<rows.length();i++){
                org.json.JSONObject x=rows.optJSONObject(i);
                if (x!=null && symbol.equals(x.optString("symbol","")))
                    return "PC defterinde bu coin açık • eski alarm kaydı ayrı";
            }
            return "ARŞİV ALARMI • PC defterinde açık pozisyon yok";
        } catch(Throwable ignored){return "YEREL ALARM KAYDI • PC pozisyonu doğrulanmadı";}
    }
''' + anchor)

build = (APP / "app/build.gradle").read_text(encoding="utf-8")
build = re.sub(r"versionCode\s+\d+", "versionCode 26100332", build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.121-r2544.30-office-burst'", build, count=1)
for name, text in [("BrainHubClient.java",client),("AutoDecisionCard.java",card),("V95113PcTruth.java",truth),("MainActivity.java",main)]:
    (JAVA/name).write_text(text+"\n// V95129_R2544_30_OFFICE_BURST\n",encoding="utf-8")
(APP/"app/build.gradle").write_text(build,encoding="utf-8")
if "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" not in client or 'post(c, "/live/execute", intent, true)' in client or 'post(c, "/live/burst"' in client:
    raise SystemExit("V95129 Android PC-only boundary failed")
print("V95129_R2544_30_OFFICE_BURST_OK")
