package com.futuresalarm.app;

import android.content.SharedPreferences;
import org.json.JSONObject;
import org.json.JSONArray;

/** Read-only decision telemetry; never starts analysis or grants an order. */
public final class AutoDecisionCard {
    private AutoDecisionCard() {}
    private static JSONObject json(String raw) { try { return new JSONObject(raw); } catch(Exception e) { return new JSONObject(); } }
    private static String val(JSONObject j,String key,String fallback) {
        String s=j==null?"":j.optString(key,"");return s.isEmpty()||"null".equals(s)?fallback:s;
    }
    private static void line(StringBuilder b,String label,JSONObject j,String key) {
        String s=val(j,key,"");if(!s.isEmpty())b.append("\n").append(label).append(s);
    }
    public static String render(SharedPreferences sp,long now,boolean detailed) {
        long ts=sp.getLong("v9582_pc_probe_ts",0);
        boolean fresh=ts>0&&now>=ts&&now-ts<=15000&&sp.getBoolean("v9582_pc_probe_ok",false);
        StringBuilder b=new StringBuilder("OTO KARAR MERKEZİ • LONG / SHORT");
        if(!fresh){
            b.append("\nPC BAĞLANTISI YOK / GÜNCEL DEĞİL");
            b.append("\nVision, komite ve Jev'in güncel kararı doğrulanamıyor.");
            b.append("\nTelefon taraması model onayı değildir.");
            b.append("\nTailscale: aynı hesapta Bağlı olmalı. Ardından PC bağlantısını yenileyin.");
            String error=sp.getString("v9582_pc_probe_error","");if(!error.isEmpty())b.append("\nBağlantı hatası: ").append(error);
            if(ts>0)b.append("\nSon kontrol: ").append(new java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts)));
            return b.toString();
        }
        b.append("\nPC bağlı • LIVE ").append(sp.getBoolean("v9582_pc_armed",false)?"AÇIK":"KAPALI");
        b.append("\nSon bağlantı kontrolü: ").append(new java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts)));
        JSONObject progress=json(sp.getString("v9598_progress","{}"));
        String stage=val(progress,"stage","Henüz bildirilmedi");
        b.append("\nVision son bildirimi: ").append(stage);
        b.append("\nBu bildirim genel model işidir; aşağıdaki adayla aynı iş olduğu varsayılmaz.");
        line(b,"Bildirim zamanı: ",progress,"updatedAt");
        line(b,"Model: ",progress,"model");
        line(b,"Model hatası: ",progress,"error");
        JSONObject jev=json(sp.getString("v9598_jev","{}"));
        b.append("\nJev: ").append(jev.optBoolean("configured")?"yapılandırılmış":"kullanılamıyor / yapılandırılmamış");
        line(b,"Jev modeli: ",jev,"model");
        JSONObject budget=jev.optJSONObject("budget");
        if(budget!=null){
            double spent=budget.optDouble("spentUsd",0), soft=budget.optDouble("softBudgetUsd",0.25), hard=budget.optDouble("dailyCapUsd",2.0);
            b.append(String.format(java.util.Locale.US,"\nBugün %d çağrı • $%.4f • uyarı $%.2f • hard $%.2f",budget.optInt("calls"),spent,soft,hard));
            if(budget.optBoolean("softLimitReached",false)&&!budget.optBoolean("hardLimitReached",false))b.append("\nJev bütçe uyarı eşiği aşıldı; Jev çalışmaya devam eder.");
            if(budget.optBoolean("hardLimitReached",false))b.append("\nJev hard günlük bütçe sınırında; bypass edilmez, QUALIFIED fail-closed bekler.");
        }
        b.append("\nJev yalnız QUALIFIED planın ek veto denetimidir.");
        JSONObject diag=json(sp.getString("v9593_pc_auto_diagnostics","{}"));
        line(b,"Aday turu: ",diag,"generatedAt");
        b.append("\nSon PC turu: ").append(sp.getString("v9592_pc_auto_last_tick_at","Henüz yok"));
        b.append("\nYürütme: ").append(sp.getString("v9588_pc_auto_last_execution","Henüz yok"));
        String reasons=sp.getString("v9592_pc_auto_last_reasons","");if(!reasons.isEmpty())b.append("\nYürütme nedeni: ").append(reasons);
        JSONArray rows=diag.optJSONArray("candidates");
        if(rows==null||rows.length()==0){b.append("\nHenüz aday karar kaydı yok; model onayı verilmiş sayılmaz.");return b.toString();}
        JSONArray ordered=new JSONArray();
        for(int i=0;i<rows.length();i++){JSONObject r=rows.optJSONObject(i);if(r!=null&&r.optBoolean("selected"))ordered.put(r);}
        for(int i=0;i<rows.length();i++){JSONObject r=rows.optJSONObject(i);if(r!=null&&!r.optBoolean("selected"))ordered.put(r);}
        rows=ordered;
        int count=detailed?rows.length():Math.min(rows.length(),1);
        for(int i=0;i<count;i++){
            JSONObject r=rows.optJSONObject(i);if(r==null)continue;
            b.append("\n\n").append(val(r,"symbol","? ")).append(" • ").append(val(r,"side","Yön yok"));
            b.append("\nAşama: ").append(val(r,"stageTr",val(r,"stage","Bildirilmedi")));
            String plan=val(r,"planStatus","Henüz plan yok");b.append("\nPlan: ").append(plan);
            JSONObject committee=r.optJSONObject("committee");
            if(committee==null)b.append("\nKomite: bu adayda yanıt kaydı yok");
            else {
                b.append("\nKomite: ").append(committee.optBoolean("ok")?"yanıt alındı":"tamamlanamadı");
                line(b,"Karar modeli: ",committee,"model");
                b.append("\nAlınan analist yanıtı: ").append(committee.optInt("receivedAnalystReplies",0));
                line(b,"Denenen modeller: ",committee,"attemptedModels");
                line(b,"Komite hatası: ",committee,"error");
                if(detailed){line(b,"Model hataları: ",committee,"failed");line(b,"Detay: ",committee,"detail");}
            }
            JSONObject v=r.optJSONObject("vision");if(v!=null)b.append("\nGrafik gönderimi: ").append(v.optInt("attached")).append("/").append(v.optInt("required",9)).append(" (tek başına model onayı değildir)");
            JSONObject decision=r.optJSONObject("jevDecision");
            if(decision==null)b.append("\nJev: bu aday için karar kaydı yok");
            else {
                b.append("\nJev: ").append(!decision.optBoolean("called")?"ÇAĞRILMADI":!decision.optBoolean("ok")?"HATA":decision.optBoolean("veto")?"BEKLET / VETO":"EK VETO YOK");
                line(b,"Jev açıklaması: ",decision,"summaryTr");line(b,"Jev nedeni: ",decision,"reason");
                if(detailed){line(b,"Jev konu olasılıkları: ",decision,"probabilities");line(b,"Jev TF çelişkileri: ",decision,"timeframeConflicts");}
            }
            line(b,"Neden: ",r,"planWhy");line(b,"Beklenen: ",r,"waitFor");line(b,"Risk: ",r,"planRisk");
            line(b,"Aday açıklaması: ",r,"explanationTr");
            if(detailed){line(b,"Destek TF: ",r,"supportTFs");line(b,"Veto TF: ",r,"vetoTFs");line(b,"TF kararları: ",r,"timeframeDiagnostics");}
            b.append("\nPlan veya Jev onayı, emir gönderildi demek değildir.");
        }
        if(!detailed)b.append("\n\nTüm adaylar ve karar ayrıntıları için dokun.");
        return b.toString();
    }
}
