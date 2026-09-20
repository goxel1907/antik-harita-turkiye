package com.futuresalarm.app;

import android.content.SharedPreferences;
import org.json.JSONObject;
import org.json.JSONArray;

/** Read-only decision telemetry; never starts analysis or grants an order. */
public final class AutoDecisionCard {
    private static String trPlan(String x){
        String s=x==null?"":x.trim().toUpperCase(java.util.Locale.US);
        if("QUALIFIED".equals(s))return "İŞLEM ADAYI";
        if("WATCH".equals(s))return "İZLE / BEKLE";
        if("REJECT".equals(s))return "RED";
        if("REVIEW_REQUIRED".equals(s))return "YENİDEN İNCELEME GEREKLİ";
        return s.isEmpty()?"Henüz plan yok":"Teknik durum";
    }
    private static String trReason(String x){
        if(x==null||x.trim().isEmpty())return "";
        String s=x.trim();
        java.util.HashMap<String,String> m=new java.util.HashMap<>();
        m.put("JEV_STRUCTURAL_VETO","Jev yapısal çelişki gördü");
        m.put("JEV_FORMING_CONFIRMATION_DEPENDENCY","Açık mum teyit gibi kullanılmış");
        m.put("JEV_DATA_QUALITY_INSUFFICIENT","Veri kalitesi yetersiz");
        m.put("JEV_DIRECTION_CONFLICT","Yön ile yapı arasında çelişki var");
        m.put("JEV_PACKAGE_INTEGRITY","Coin/grafik paketi uyuşmuyor");
        m.put("JEV_CONTINUITY_CONFLICT","Başlangıç-sahip zaman dilimi sürekliliği bozuk");
        m.put("JEV_TF_CONFLICT","Zaman dilimleri arasında önemli çelişki var");
        m.put("JEV_SMC_LIQUIDITY_CONFLICT","SMC/likidite yapısı planla çelişiyor");
        m.put("JEV_MICROSTRUCTURE_UNRELIABLE","Mikro yapı kanıtı güvenilir değil");
        m.put("JEV_CLOSED_CONFIRMATION_MISSING","Gerekli kapanmış mum teyidi eksik");
        m.put("JEV_VISUAL_DATA_CONFLICT","Grafik ile sayısal veri çelişiyor");
        m.put("JEV_WAIT_REQUIRED","Beklenen koşul henüz tamamlanmadı");
        m.put("QUALIFIED_WAIT_REQUIRED","İşlem için beklenen koşul henüz tamamlanmadı");
        m.put("QUALIFIED_ORIGIN_OWNER_VETO","Başlangıç veya sahip zaman dilimi işlemi engelliyor");
        m.put("JEV_NOT_NEEDED_FOR_NON_QUALIFIED","Plan henüz işlem adayı olmadığı için Jev çağrılmadı");
        m.put("JEV_DAILY_BUDGET_EXHAUSTED","Jev günlük güvenlik bütçesi doldu");
        m.put("JEV_KEY_UNAVAILABLE","Jev anahtarı kullanılamıyor");
        m.put("JEV_JUDGE_EXCEPTION","Jev değerlendirmesinde teknik hata oluştu");
        String v=m.get(s);return v!=null?v:"Teknik karar kodu: "+s.replace('_',' ');
    }
    private static String trText(String x){
        if(x==null)return "";
        String s=x;
        // Uzun karar kodlarını önce çevir. Aksi halde QUALIFIED gibi alt parçalar
        // ham kodun ortasında çevrilip LEADER_PLAN_NOT_İŞLEM ADAYI benzeri metin üretir.
        s=s.replace("LEADER_PLAN_NOT_QUALIFIED","9 ZAMAN DİLİMLİ PLAN HENÜZ İŞLEM ADAYI DEĞİL");
        s=s.replace("PLAN_NOT_QUALIFIED","PLAN HENÜZ İŞLEM ADAYI DEĞİL");
        s=s.replace("QUALIFIED_WAIT_REQUIRED","İŞLEM İÇİN BEKLENEN KOŞUL HENÜZ TAMAMLANMADI");
        s=s.replace("QUALIFIED_ORIGIN_OWNER_VETO","BAŞLANGIÇ VEYA SAHİP ZAMAN DİLİMİ İŞLEMİ ENGELLİYOR");
        s=s.replace("JEV_NOT_NEEDED_FOR_NON_QUALIFIED","PLAN HENÜZ İŞLEM ADAYI OLMADIĞI İÇİN JEV ÇAĞRILMADI");
        s=s.replace("QUALIFIED","İŞLEM ADAYI").replace("REVIEW_REQUIRED","YENİDEN İNCELEME GEREKLİ").replace("WATCH","İZLE / BEKLE").replace("REJECT","RED");
        s=s.replace("SUPPORT","DESTEK").replace("VETO","ENGEL").replace("NEUTRAL","NÖTR");
        s=s.replace("FORMING","OLUŞUYOR").replace("CONFIRMED","TEYİTLİ").replace("FAILED","BAŞARISIZ").replace("INVALIDATED","GEÇERSİZ");
        s=s.replace("THREE_BLACK_CROWS","ÜÇ KARA KARGA").replace("THREE_WHITE_SOLDIERS","ÜÇ BEYAZ ASKER");
        s=s.replace("DOUBLE_TOP","ÇİFT TEPE").replace("DOUBLE_BOTTOM","ÇİFT DİP").replace("SYMMETRICAL_TRIANGLE","SİMETRİK ÜÇGEN");
        s=s.replace("ASCENDING_TRIANGLE","YÜKSELEN ÜÇGEN").replace("DESCENDING_TRIANGLE","ALÇALAN ÜÇGEN");
        s=s.replace("RISING_WEDGE","YÜKSELEN TAKOZ").replace("FALLING_WEDGE","ALÇALAN TAKOZ");
        s=s.replace("HEAD_AND_SHOULDERS","OMUZ BAŞ OMUZ").replace("INVERSE_HEAD_AND_SHOULDERS","TERS OMUZ BAŞ OMUZ");
        s=s.replace("SELL_SIDE_SWEEP_RECLAIM","SATIŞ TARAFI SÜPÜRME SONRASI GERİ KAZANIM").replace("BUY_SIDE_SWEEP_REJECT","ALIŞ TARAFI SÜPÜRME SONRASI RET");
        s=s.replace("SUPPORT_FLIP_ACCEPTANCE","DESTEK KIRILIM KABULÜ").replace("RESISTANCE_FLIP_ACCEPTANCE","DİRENÇ KIRILIM KABULÜ");
        s=s.replace("FAILED_BREAKOUT","BAŞARISIZ KIRILIM").replace("VOLATILITY_COMPRESSION","VOLATİLİTE SIKIŞMASI").replace("DISPLACEMENT","GÜÇLÜ YÖNLÜ HAREKET");
        s=s.replace("DETAIL_RUN_COMPLETE","9 ZAMAN DİLİMİ ANALİZİ TAMAMLANDI")
             .replace("DETAIL_RUN_START","9 ZAMAN DİLİMİ ANALİZİ BAŞLADI")
             .replace("DETAIL_RUN_ERROR","9 ZAMAN DİLİMİ ANALİZİ HATA VERDİ")
             .replace("PIXEL_RUN_COMPLETE","GÖRSEL TAŞIMA KONTROLÜ TAMAMLANDI")
             .replace("PIXEL_RUN_START","GÖRSEL TAŞIMA KONTROLÜ BAŞLADI")
             .replace("PIXEL_RUN_ERROR","GÖRSEL TAŞIMA KONTROLÜ HATA VERDİ");
        s=s.replace("FINALIZE_NARRATIVE_REPAIR","GENEL AÇIKLAMA DÜZELTİLİYOR").replace("FINALIZE_NARRATIVE","GENEL KARAR AÇIKLAMASI HAZIRLANIYOR");
        s=s.replace("FINALIZE_SEMANTIC_REPAIR","KARAR ÇELİŞKİSİ DÜZELTİLİYOR").replace("FINALIZE_CORE_REPAIR","ANA KARAR DÜZELTİLİYOR").replace("FINALIZE_CORE","ANA KARAR HAZIRLANIYOR");
        s=s.replace("LEADER_AUTO_BLOCKED","OTO İŞLEM GÜVENLİK NEDENİYLE DURDU").replace("LEADER_AUTO_WAIT","OTO İŞLEM UYGUN FIRSAT BEKLİYOR").replace("LEADER_AUTO_DISABLED","OTO İŞLEM KAPALI");
        s=s.replace("REQUESTED_LEVERAGE_EXCEEDS_PC_CAP","İSTENEN KALDIRAÇ PC GÜVENLİK TAVANINI AŞIYOR");
        s=s.replace("TOP3_APPROACH","İLK 3'E YAKLAŞIYOR").replace("TOP5_CONFIRMED","İLK 5 TEYİTLİ").replace("CURRENT_ATTACK_TOP10","ANLIK ATAK İLK 10");
        s=s.replace("degraded_single","TEK ANALİST MODU").replace("annotated","işaretlenmiş grafik");
        s=s.replace("inside bar not confirmed","iç bar teyit edilmedi").replace("bullish confirmation","yükseliş teyidi").replace("trend support","trend desteği");
        s=s.replace("continuity","süreklilik").replace("tradeQuality","işlem kalitesi").replace("longScore","LONG puanı").replace("shortScore","SHORT puanı");
        s=s.replace("PIPELINE_SELECTED","DERİN ANALİZ İÇİN SEÇİLDİ").replace("PIPELINE_ERROR","DERİN ANALİZ HATASI");
        s=s.replace("PLAN_NOT_READY","PLAN HAZIR DEĞİL").replace("INTENT_NOT_READY","EMİR NİYETİ HAZIR DEĞİL").replace("INTENT_READY","EMİR NİYETİ HAZIR");
        s=s.replace("ORDER_PLACED","CANLI EMİR GÖNDERİLDİ").replace("EXECUTION_RESULT","YÜRÜTME SONUCU");
        s=s.replace("TF_SCHEMA_REPAIR=","ZAMAN DİLİMİ ŞEMASI DÜZELTİLİYOR: ")
             .replace("PIXEL_TF=","GÖRSEL TAŞIMA KONTROLÜ: ")
             .replace("VISUAL_TF=","GÖRSEL ZAMAN DİLİMİ: ")
             .replace("_DONE"," • TAMAMLANDI").replace("_ERROR"," • HATA")
             .replace("INSIDE_BAR","İÇ BAR").replace("NONE","YOK");
        s=s.replace("UP","YÜKSELİŞ").replace("DOWN","DÜŞÜŞ").replace("MIXED","KARMA");
        return s;
    }
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
        StringBuilder b=new StringBuilder("OTO KARAR MERKEZİ • LONG (YÜKSELİŞ) / SHORT (DÜŞÜŞ)");
        if(!fresh){
            b.append("\nPC BAĞLANTISI YOK / GÜNCEL DEĞİL");
            b.append("\nVision, komite ve Jev'in güncel kararı doğrulanamıyor.");
            b.append("\nTelefon taraması model onayı değildir.");
            b.append("\nTailscale: aynı hesapta Bağlı olmalı. Ardından PC bağlantısını yenileyin.");
            String error=sp.getString("v9582_pc_probe_error","");if(!error.isEmpty())b.append("\nBağlantı hatası: ").append(error);
            if(ts>0)b.append("\nSon kontrol: ").append(new java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts)));
            return b.toString();
        }
        b.append("\nPC bağlı • CANLI İŞLEM ").append(sp.getBoolean("v9582_pc_armed",false)?"AÇIK":"KAPALI");
        b.append("\nSon bağlantı kontrolü: ").append(new java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts)));
        JSONObject progress=json(sp.getString("v9598_progress","{}"));
        String stage=val(progress,"stage","Henüz bildirilmedi");
        b.append("\nGörsel analiz son durumu: ").append(trText(stage));
        b.append("\nBu bildirim genel model işidir; aşağıdaki adayla aynı iş olduğu varsayılmaz.");
        line(b,"Bildirim zamanı: ",progress,"updatedAt");
        line(b,"Model: ",progress,"model");
        if(progress.has("error")&&!progress.isNull("error")&&!progress.optString("error").isEmpty())b.append("\nModel hatası: teknik hata oluştu; ayrıntı PC günlüğünde.");
        JSONObject jev=json(sp.getString("v9598_jev","{}"));
        b.append("\nJev: ").append(jev.optBoolean("configured")?"yapılandırılmış":"kullanılamıyor / yapılandırılmamış");
        line(b,"Jev modeli: ",jev,"model");
        JSONObject budget=jev.optJSONObject("budget");
        if(budget!=null){
            double spent=budget.optDouble("spentUsd",0), soft=budget.optDouble("softBudgetUsd",0.25), hard=budget.optDouble("dailyCapUsd",2.0);
            b.append(String.format(java.util.Locale.US,"\nBugün %d çağrı • $%.4f • uyarı $%.2f • kesin tavan $%.2f",budget.optInt("calls"),spent,soft,hard));
            if(budget.optBoolean("softLimitReached",false)&&!budget.optBoolean("hardLimitReached",false))b.append("\nJev bütçe uyarı eşiği aşıldı; Jev çalışmaya devam eder.");
            if(budget.optBoolean("hardLimitReached",false))b.append("\nJev kesin günlük bütçe sınırında; atlanmaz, işlem adayı plan güvenli biçimde bekler.");
        }
        JSONObject billing=json(sp.getString("v9598_openrouter_billing","{}"));
        JSONObject account=billing.optJSONObject("accountCredits");
        JSONObject keyInfo=billing.optJSONObject("key");
        if(account!=null&&account.optBoolean("available")){
            double remain=account.optDouble("remainingCredits",0), total=account.optDouble("totalCredits",0), used=account.optDouble("totalUsage",0);
            b.append(String.format(java.util.Locale.US,"\nOpenRouter gerçek bakiye: $%.4f • alınan $%.4f • kullanılan $%.4f",remain,total,used));
            if(remain<=1.0)b.append("\n⚠ OpenRouter kredisi azalıyor; kesinti olmadan kredi ekleyin / otomatik bakiye yükleme kontrol edin.");
        }else{
            b.append("\nOpenRouter gerçek bakiye: henüz bağlı değil");
            b.append("\nTam bakiye için PC'de OpenRouter yönetim anahtarı bir kez bağlanmalı.");
        }
        if(keyInfo!=null&&keyInfo.optBoolean("available")&&!keyInfo.isNull("limit_remaining")){
            b.append(String.format(java.util.Locale.US,"\nBrainHub-JEV erişim anahtarının kalan limiti: $%.4f",keyInfo.optDouble("limit_remaining",0)));
        }
        b.append("\nJev yalnız işlem adayı planın ek güvenlik denetimidir.");
        JSONObject pm=json(sp.getString("v9599_position_manager","{}"));
        JSONObject pr=pm.optJSONObject("lastReview");
        b.append("\n\nAÇIK POZİSYON YÖNETİCİSİ");
        if(pr==null)b.append("\nHenüz açık pozisyon değerlendirmesi yok.");
        else{
            String actionTr=val(pr,"actionTr","TUT");
            if(!"AÇIK POZİSYON YOK".equals(actionTr))b.append("\n").append(val(pr,"symbol","?")).append(" • ").append(val(pr,"side","?"));
            b.append("\nKarar: ").append(actionTr);
            line(b,"Gerekçe: ",pr,"reasonTr");
            line(b,"Başlangıç TF: ",pr,"originTF");line(b,"Sahip TF: ",pr,"ownerTF");
            if(pr.has("pnlPct")&&!pr.isNull("pnlPct"))b.append(String.format(java.util.Locale.US,"\nAnlık fiyat değişimi: %+.3f%%",pr.optDouble("pnlPct")));
            line(b,"Jev pozisyon özeti: ",pr,"jevSummaryTr");
            b.append("\nKural: küçük zaman dilimi gürültüsü tek başına çıkış kararı vermez; sahip TF ve büyük resim doğrulaması gerekir.");
        }
        JSONObject learning=json(sp.getString("v9599_learning","{}"));
        org.json.JSONArray recent=learning.optJSONArray("recent"),stats=learning.optJSONArray("stats");
        b.append("\n\nBEYİN ÖĞRENME HAFIZASI");
        b.append("\nEkranda gösterilen son karar/işlem örneği: ").append(recent==null?0:recent.length()).append(" (geçmiş veritabanında tutulur)");
        b.append("\nSonuç istatistiği grubu: ").append(stats==null?0:stats.length());
        b.append("\nÖğrenme stop/risk güvenlik kurallarını otomatik gevşetmez.");

        JSONObject health=json(sp.getString("v95104_pc_auto_health","{}"));
        b.append("\n\nOTO SAĞLIK / FIRSAT AKIŞI");
        if(health.length()==0)b.append("\nHenüz sağlık telemetrisi birikmedi.");
        else{
            b.append(String.format(java.util.Locale.US,"\nGözlenen pencere: %.1f dk / son 60 dk",health.optDouble("observedMinutes",0)));
            b.append("\nTarama turu: ").append(health.optInt("scanRuns",0));
            b.append("\nDerin 9TF analizi: ").append(health.optInt("deepAnalyses",0))
             .append(" • farklı coin ").append(health.optInt("uniqueAnalyzedSymbols",0));
            b.append("\nSonuç: işlem adayı ").append(health.optInt("qualified",0))
             .append(" • izle/bekle ").append(health.optInt("watch",0))
             .append(" • yeniden incele ").append(health.optInt("reviewRequired",0))
             .append(" • red ").append(health.optInt("reject",0));
            b.append("\nVision/komite erişim kesintisi: ").append(health.optInt("visionUnavailable",0));
            b.append("\nYoğunluk nedeniyle atlanan tur: ").append(health.optInt("skippedBusy",0))
             .append(" • pipeline yoğun ").append(health.optInt("skippedPipelineBusy",0));
            long avg=health.optLong("avgAnalysisMs",-1L);
            if(avg>=0)b.append(String.format(java.util.Locale.US,"\nOrtalama derin analiz: %.1f sn",avg/1000.0));
            b.append("\nAçılan canlı emir: ").append(health.optInt("ordersPlaced",0));
            JSONArray top=health.optJSONArray("topReasons");
            if(top!=null&&top.length()>0){
                b.append("\nEn sık bekleme/engel nedenleri:");
                for(int i=0;i<Math.min(5,top.length());i++){
                    JSONObject x=top.optJSONObject(i);if(x==null)continue;
                    b.append("\n• ").append(trReason(x.optString("reason","?"))).append(" ×").append(x.optInt("count",0));
                }
            }
        }
        JSONObject diag=json(sp.getString("v9593_pc_auto_diagnostics","{}"));
        line(b,"Aday turu: ",diag,"generatedAt");
        b.append("\nSon PC turu: ").append(sp.getString("v9592_pc_auto_last_tick_at","Henüz yok"));
        b.append("\nYürütme: ").append(trText(sp.getString("v9588_pc_auto_last_execution","Henüz yok")));
        String reasons=sp.getString("v9592_pc_auto_last_reasons","");if(!reasons.isEmpty())b.append("\nYürütme nedeni: ").append(trText(reasons));
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
            String stageTr=val(r,"stageTr","");
            b.append("\nAşama: ").append(stageTr.isEmpty()?"Teknik aşama tamamlanmayı bekliyor":stageTr);
            String plan=val(r,"planStatus","Henüz plan yok");b.append("\nPlan: ").append(trPlan(plan));
            JSONObject committee=r.optJSONObject("committee");
            if(committee==null)b.append("\nKomite: bu adayda yanıt kaydı yok");
            else {
                b.append("\nKomite: ").append(committee.optBoolean("ok")?"yanıt alındı":"tamamlanamadı");
                line(b,"Karar modeli: ",committee,"model");
                b.append("\nAlınan analist yanıtı: ").append(committee.optInt("receivedAnalystReplies",0));
                line(b,"Denenen modeller: ",committee,"attemptedModels");
                if(committee.has("error")&&!committee.isNull("error"))b.append("\nKomite hatası: teknik hata oluştu; ayrıntı PC günlüğünde.");
                if(detailed&&committee.has("failed"))b.append("\nModel erişimi: bazı denemeler tamamlanamadı; ayrıntı PC günlüğünde.");
            }
            JSONObject v=r.optJSONObject("vision");if(v!=null)b.append("\nGrafik gönderimi: ").append(v.optInt("attached")).append("/").append(v.optInt("required",9)).append(" (tek başına model onayı değildir)");
            JSONObject decision=r.optJSONObject("jevDecision");
            if(decision==null)b.append("\nJev: bu aday için karar kaydı yok");
            else {
                b.append("\nJev: ").append(!decision.optBoolean("called")?"ÇAĞRILMADI":!decision.optBoolean("ok")?"HATA":decision.optBoolean("veto")?"BEKLET / VETO":"EK VETO YOK");
                line(b,"Jev açıklaması: ",decision,"summaryTr");
                if(decision.has("reason")&&!decision.isNull("reason"))b.append("\nJev nedeni: ").append(trReason(decision.optString("reason")));
                if(detailed&&decision.has("conflictingTFs"))b.append("\nJev'in önemli gördüğü zaman dilimleri: ").append(trText(String.valueOf(decision.opt("conflictingTFs"))));
            }
            if(r.has("planWhy"))b.append("\nNeden: ").append(trText(r.optString("planWhy")));
            if(r.has("waitFor"))b.append("\nBeklenen: ").append(trText(r.optString("waitFor")));
            if(r.has("planRisk"))b.append("\nRisk: ").append(trText(r.optString("planRisk")));
            if(r.has("explanationTr"))b.append("\nAday açıklaması: ").append(trText(r.optString("explanationTr")));
            if(detailed){
                if(r.has("supportTFs"))b.append("\nDestek zaman dilimleri: ").append(trText(String.valueOf(r.opt("supportTFs"))));
                if(r.has("vetoTFs"))b.append("\nEngel zaman dilimleri: ").append(trText(String.valueOf(r.opt("vetoTFs"))));
                JSONObject td=r.optJSONObject("timeframeDiagnostics");
                if(td!=null){
                    String[] tfs={"1m","3m","5m","15m","30m","45m","1h","4h","1d"};
                    for(String tf:tfs){
                        JSONObject x=td.optJSONObject(tf);if(x==null)continue;
                        b.append("\n").append(tf).append(" • ");
                        String role=x.optString("role","");
                        b.append("SUPPORT".equals(role)?"DESTEK":"VETO".equals(role)?"ENGEL":"NÖTR");
                        if(x.has("summary"))b.append(" • ").append(trText(x.optString("summary")));
                        if(x.has("why"))b.append("\n  Neden: ").append(trText(x.optString("why")));
                        if(x.has("waitFor"))b.append("\n  Beklenen: ").append(trText(x.optString("waitFor")));
                        if(x.has("risk"))b.append("\n  Risk: ").append(trText(x.optString("risk")));
                    }
                }
            }
            b.append("\nPlan veya Jev onayı, emir gönderildi demek değildir.");
        }
        if(!detailed)b.append("\n\nTüm adaylar ve karar ayrıntıları için dokun.");
        return b.toString();
    }
}
