"""Reuse the existing manual chart/plan-code flow for selected AUTO candidates."""
from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
main_path = JAVA / 'MainActivity.java'
analysis_path = JAVA / 'AnalysisPackActivity.java'
main = main_path.read_text()
analysis = analysis_path.read_text()

brain_client_path = JAVA / 'BrainHubClient.java'
if not brain_client_path.exists():
    raise SystemExit('v9.5.97 BrainHubClient missing after v9577 source preparation')
brain_client = brain_client_path.read_text()
required_client_markers = [
    'optJSONObject("timeframes")',
    '"ema20"','"ema50"','"atrPct"','"swingStructure"','"smcContext"','"liquidity"','"opportunity"',
    'marketGeneratedAt'
]
missing_client_markers = [m for m in required_client_markers if m not in brain_client]
if missing_client_markers:
    raise SystemExit('v9.5.97 AUTO review BrainHub context contract mismatch: ' + ','.join(missing_client_markers))

anchor = '        String detailedAuto=v9594SelectedLeaderDetail(sp);'
if main.count(anchor) != 1:
    raise SystemExit('v9.5.97 AUTO review anchor missing/ambiguous')
main = main.replace(anchor, r'''
        // V9597_AUTO_CHAT_REVIEW: user-selected analysis only, no order side effect.
        android.widget.Button extraReview=new android.widget.Button(this);
        extraReview.setAllCaps(false);
        extraReview.setText("OTO ADAYI • EK ANALİZ PAKETİ");
        extraReview.setOnClickListener(v -> v9597ChooseAutoReview());
        box.addView(extraReview,new android.widget.LinearLayout.LayoutParams(-1,dp(48)));
''' + anchor, 1)

methods = r'''
    private void v9597ChooseAutoReview() {
        android.content.SharedPreferences sp=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE);
        java.util.LinkedHashSet<String> unique=new java.util.LinkedHashSet<>();
        try {
            org.json.JSONObject diagnostics=new org.json.JSONObject(sp.getString("v9593_pc_auto_diagnostics","{}"));
            org.json.JSONArray candidates=diagnostics.optJSONArray("candidates");
            if(candidates!=null)for(int i=0;i<candidates.length();i++){
                org.json.JSONObject row=candidates.optJSONObject(i); if(row==null)continue;
                String sym=row.optString("symbol","").toUpperCase(java.util.Locale.US);
                if(sym.matches("[A-Z0-9]{1,28}USDT"))unique.add(sym);
            }
            org.json.JSONObject lifecycle=new org.json.JSONObject(sp.getString("v9594_pc_analysis_lifecycle","{}"));
            org.json.JSONArray rows=lifecycle.optJSONArray("rows");
            if(rows!=null)for(int i=0;i<rows.length();i++){
                org.json.JSONObject row=rows.optJSONObject(i); if(row==null)continue;
                String sym=row.optString("symbol","").toUpperCase(java.util.Locale.US);
                if(sym.matches("[A-Z0-9]{1,28}USDT"))unique.add(sym);
            }
        } catch(Exception ignored) {}
        if(unique.isEmpty()){
            Toast.makeText(this,"Henüz PC adayı yok; manuel coin seçimi açılıyor.",Toast.LENGTH_LONG).show();
            startActivity(new android.content.Intent(this,AnalysisPackActivity.class).putExtra("v9597_auto_review",true));
            return;
        }
        String[] symbols=unique.toArray(new String[0]);
        boolean[] checked=new boolean[symbols.length];
        android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(this)
            .setTitle("Ek analiz için 1-8 OTO adayı seç")
            .setMultiChoiceItems(symbols,checked,(d,which,on)->checked[which]=on)
            .setNegativeButton("Vazgeç",null).setPositiveButton("Grafik paketini hazırla",null).create();
        dialog.setOnShowListener(d -> dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            java.util.ArrayList<String> selected=new java.util.ArrayList<>();
            for(int i=0;i<symbols.length;i++)if(checked[i])selected.add(symbols[i]);
            if(selected.isEmpty()||selected.size()>8){Toast.makeText(this,"1-8 coin seçmelisiniz.",Toast.LENGTH_SHORT).show();return;}
            android.content.Intent intent=new android.content.Intent(this,AnalysisPackActivity.class);
            intent.putExtra("v9597_auto_review",true);
            if(selected.size()==1){intent.putExtra("v9538_symbol",selected.get(0));intent.putExtra("v9538_autobuild",true);}
            else intent.putStringArrayListExtra("v9545_batch_symbols",selected);
            dialog.dismiss();startActivity(intent);
        }));
        dialog.show();
    }
'''
pos=main.rfind('}')
main=main[:pos]+methods+'\n'+main[pos:]

anchor='                String prompt = buildPrompt(symbol, candles, forming, metrics, now);'
if analysis.count(anchor)!=1:
    raise SystemExit('v9.5.97 manual buildPrompt anchor missing/ambiguous')
analysis=analysis.replace(anchor,anchor+'\n                prompt = v9597WithAutoEvidence(symbol,prompt,now);',1)
chart_anchor='                Bitmap image = renderPack(symbol, candles, forming, metrics, now);'
if analysis.count(chart_anchor)!=1:
    raise SystemExit('v9.5.97 chart render anchor missing/ambiguous')
analysis=analysis.replace(chart_anchor,'''                boolean autoReview=getIntent()!=null&&getIntent().getBooleanExtra("v9597_auto_review",false);
                Bitmap image = autoReview ? BrainHubClient.reviewCharts(this,symbol) : renderPack(symbol, candles, forming, metrics, now);''',1)
success_anchor='                    // V9545_BATCH_SUCCESS_HOOK'
if analysis.count(success_anchor)!=1:
    raise SystemExit('v9.5.97 package success hook missing/ambiguous')
analysis=analysis.replace(success_anchor,'''                    if(autoReview)status.setText("OTO ek analiz paketi hazır: 1D/4h/1h/45m/30m/15m/5m/3m/1m • 9 PC grafiği. Mevcut sohbet düğmesi promptu panoya, grafikleri Galeri'ye hazırlar; gönderimi siz yaparsınız.");
'''+success_anchor,1)
review_method=r'''
    private String v9597WithAutoEvidence(String symbol,String prompt,long packageTime) {
        if(getIntent()==null||!getIntent().getBooleanExtra("v9597_auto_review",false))return prompt;
        StringBuilder note=new StringBuilder("OTO ADAYI EK İNCELEME • ").append(symbol)
            .append("\nBu pakette manuel analiz motorunun güncel grafikleri, verileri ve mevcut kaynak/kuralları kullanılır.")
            .append("\nEkli PC grafik ızgarası, soldan sağa satır sırasıyla: 1D/4h/1h, 45m/30m/15m, 5m/3m/1m. Her grafik 128 mum içerir; 45m sentetiktir. Manuel metindeki eski altı-grafik yerleşimi yerine bu 9TF yerleşimini kullan.")
            .append("\nAşağıdaki PC kaydı önceki analizin bağlamıdır; güncel teyit veya bağımsız oy değildir. Çelişkileri mevcut grafik/veriyle yeniden değerlendir.")
            .append("\nForming mum teyit değildir. Eksik veriyi uydurma. Mevcut plan kodu sözleşmesini koru; yanıt emir yetkisi vermez.")
            .append("\nPaket zamanı(ms): ").append(packageTime);
        try {
            if(!BrainHubClient.configured(this))throw new Exception("PC yapılandırılmamış");
            note.append("\nPC_9TF_MARKET_CONTEXT_JSON:\n").append(BrainHubClient.reviewContext(this,symbol).toString());
            org.json.JSONObject status=BrainHubClient.liveStatus(this);
            org.json.JSONObject auto=status.optJSONObject("leaderAuto");
            org.json.JSONObject diagnostics=auto==null?null:auto.optJSONObject("diagnostics");
            org.json.JSONArray candidates=diagnostics==null?null:diagnostics.optJSONArray("candidates");
            org.json.JSONObject row=null;
            if(candidates!=null)for(int i=0;i<candidates.length();i++){
                org.json.JSONObject candidate=candidates.optJSONObject(i);
                if(candidate!=null&&symbol.equals(candidate.optString("symbol",""))){row=candidate;break;}
            }
            note.append("\nPC son tur: ").append(auto==null?"bilinmiyor":auto.optString("lastTickAt","bilinmiyor"));
            org.json.JSONObject safe=new org.json.JSONObject();
            if(row!=null){
                String[] fields={"symbol","side","stage","reasons","explanationTr","vision","timeframeEvidence","lifecycle"};
                for(String field:fields)if(row.has(field))safe.put(field,row.get(field));
                org.json.JSONObject committee=row.optJSONObject("committee");
                if(committee!=null)safe.put("model",committee.optString("model","bilinmiyor"));
                note.append("\nPC_ADVISORY_CONTEXT_JSON:\n").append(safe.toString());
            }else note.append("\nBu coin için PC kısa listesinde kayıt yok; paket yine güncel manuel grafiklerle değerlendirilmelidir.");
        } catch(Exception ex) {
            note.append("\nPC bağlamı alınamadı; yalnız bu paketin güncel manuel verileri kullanılmalıdır.");
        }
        // Prefix keeps existing batch protocol deduplication and plan-code output intact.
        return note.toString()+"\n\n"+prompt;
    }
'''
pos=analysis.rfind('}')
analysis=analysis[:pos]+review_method+'\n'+analysis[pos:]
main_path.write_text(main)
analysis_path.write_text(analysis)
# Read-only, separate AUTO decision card. It uses the existing status poll;
# opening details never starts models, changes risk settings, or places orders.
card_source=Path(__file__).resolve().parent/'AutoDecisionCard.java'
(JAVA/'AutoDecisionCard.java').write_text(card_source.read_text(encoding='utf-8'),encoding='utf-8')
card_anchor='        String detailedAuto=v9594SelectedLeaderDetail(sp);'
assert main.count(card_anchor)==1
main=main.replace(card_anchor,r'''
        android.widget.TextView decisionCard=text(AutoDecisionCard.render(sp,now,false),12.0f,android.graphics.Color.WHITE,false);
        decisionCard.setPadding(dp(12),dp(12),dp(12),dp(12));
        decisionCard.setBackgroundColor(pcFresh?android.graphics.Color.rgb(19,45,70):android.graphics.Color.rgb(100,45,20));
        decisionCard.setOnClickListener(v->{
            android.widget.ScrollView scroll=new android.widget.ScrollView(this);
            android.widget.TextView body=text(AutoDecisionCard.render(v9522Prefs(),System.currentTimeMillis(),true),13.0f,android.graphics.Color.WHITE,false);
            body.setPadding(dp(14),dp(14),dp(14),dp(14));body.setTextIsSelectable(true);scroll.addView(body);
            new android.app.AlertDialog.Builder(this).setTitle("OTO • Model ve karar ayrıntıları").setView(scroll).setPositiveButton("Kapat",null).show();
        });
        box.addView(decisionCard,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        android.widget.Button openRouterCredit=new android.widget.Button(this);
        openRouterCredit.setAllCaps(false);
        openRouterCredit.setText("💳 OPENROUTER KREDİ / OTOMATİK YÜKLEME");
        openRouterCredit.setOnClickListener(v->{
            try{startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,android.net.Uri.parse("https://openrouter.ai/credits")));}
            catch(Exception e){Toast.makeText(this,"OpenRouter kredi sayfası açılamadı.",Toast.LENGTH_SHORT).show();}
        });
        box.addView(openRouterCredit,new android.widget.LinearLayout.LayoutParams(-1,dp(48)));
''' + card_anchor,1)
# Final user-facing Turkish sanitizer for legacy status panels.
ui_tr_methods=r'''
    private String v9599UiTr(String raw) {
        if(raw==null)return "";
        String s=raw;
        s=s.replace("REQUESTED_LEVERAGE_EXCEEDS_PC_CAP","İstenen kaldıraç PC güvenlik tavanını aşıyor");
        s=s.replace("REQUESTED_MAX_OPEN_POSITIONS_EXCEEDS_PC_CAP","İstenen eşzamanlı pozisyon sayısı PC güvenlik tavanını aşıyor");
        s=s.replace("LEADER_AUTO_BLOCKED","OTO İŞLEM GÜVENLİK NEDENİYLE DURDU");
        s=s.replace("LEADER_AUTO_DISABLED","OTO İŞLEM KAPALI");
        s=s.replace("LEADER_AUTO_WAIT","OTO İŞLEM UYGUN FIRSAT BEKLİYOR");
        s=s.replace("LEADER_AUTO_TICK_FAILED","OTO İŞLEM TARAMASI TEKNİK HATA VERDİ");
        s=s.replace("LEADER_AUTO_CONFIG_INVALID","OTO İŞLEM AYARLARI GEÇERSİZ");
        s=s.replace("LEADER_PLAN_NOT_QUALIFIED","9 zaman dilimli plan henüz işlem adayı değil");
        s=s.replace("PLAN_NOT_QUALIFIED","plan henüz işlem adayı değil");
        s=s.replace("QUALIFIED_WAIT_REQUIRED","işlem için beklenen koşul henüz tamamlanmadı");
        s=s.replace("QUALIFIED_ORIGIN_OWNER_VETO","başlangıç veya sahip zaman dilimi işlemi engelliyor");
        s=s.replace("JEV_NOT_NEEDED_FOR_NON_QUALIFIED","plan henüz işlem adayı olmadığı için Jev çağrılmadı");
        s=s.replace("FAMILY_EXPOSURE_CAP_EXCEEDED","toplam maruziyet tavanı işlemi engelledi");
        s=s.replace("REQUESTED_SIDE_NO_LONGER_EXECUTION_ELIGIBLE","aday yönü canlı ön kontrolde değişti");
        s=s.replace("LEADER_APPROVAL_STALE","9TF/Jev onayı canlı yürütmeye ulaşmadan eskidi");
        s=s.replace("LEADER_APPROVAL_NOT_QUALIFIED","canlı yürütmeye taşınan plan işlem adayı değil");
        s=s.replace("LEADER_APPROVAL_ORDER_MISMATCH","onaylı plan ile emir uyuşmuyor");
        s=s.replace("LEADER_APPROVAL_FRESH_SCAN_MISMATCH","taze tarama sembol/yön onayıyla uyuşmuyor");
        s=s.replace("SCALP_COST_EDGE_NOT_VIABLE","kısa vadeli hedef işlem maliyetine göre yetersiz");
        s=s.replace("LIVE_PRICE_DEVIATION_TOO_HIGH","canlı fiyat onaylı girişten fazla uzaklaştı");
        s=s.replace("DETAIL_RUN_COMPLETE","9 zaman dilimi analizi tamamlandı");
        s=s.replace("FINALIZE_SEMANTIC_REPAIR","karar çelişkisi düzeltiliyor");
        s=s.replace("FINALIZE_NARRATIVE","genel karar açıklaması hazırlanıyor");
        s=s.replace("FINALIZE_CORE","ana karar hazırlanıyor");
        s=s.replace("TOP3_APPROACH","ilk 3'e yaklaşıyor").replace("TOP5_CONFIRMED","ilk 5 teyitli").replace("CURRENT_ATTACK_TOP10","anlık atak ilk 10");
        s=s.replace("degraded_single","tek analist modu").replace("TEK ANALIST/DEGRADED","tek analist modu");
        s=s.replace("REVIEW_REQUIRED","yeniden inceleme gerekli").replace("QUALIFIED","işlem adayı").replace("WATCH","izle / bekle");
        s=s.replace("SUPPORT","destek").replace("VETO","engel").replace("NEUTRAL","nötr");
        s=s.replace("TF_SCHEMA_REPAIR=","zaman dilimi şeması düzeltiliyor: ")
             .replace("PIXEL_TF=","görsel taşıma kontrolü: ")
             .replace("VISUAL_TF=","görsel zaman dilimi: ")
             .replace("DETAIL_RUN_START","9 zaman dilimi analizi başladı")
             .replace("DETAIL_RUN_ERROR","9 zaman dilimi analizi hata verdi")
             .replace("PIXEL_RUN_START","görsel taşıma kontrolü başladı")
             .replace("PIXEL_RUN_ERROR","görsel taşıma kontrolü hata verdi")
             .replace("_DONE"," • tamamlandı").replace("_ERROR"," • hata")
             .replace("INSIDE_BAR","iç bar").replace("NONE","yok").replace("annotated","işaretlenmiş grafik");
        s=s.replace("bullish confirmation","yükseliş teyidi").replace("trend support","trend desteği");
        s=s.replace("inside bar not confirmed","iç bar teyit edilmedi").replace("forming","oluşan");
        s=s.replace("continuity","süreklilik").replace("tradeQuality","işlem kalitesi").replace("longScore","LONG puanı").replace("shortScore","SHORT puanı");
        s=s.replace("origin→owner","başlangıç→sahip");
        s=s.replace('[',' ').replace(']',' ').replace('"',' ');
        return s;
    }
'''
pos=main.rfind('}')
main=main[:pos]+ui_tr_methods+'\n'+main[pos:]
main=main.replace('else if(pcBlocked) state=(blockedCount>=3?"🔴":"🟠")+" PC LEADER AUTO BLOCKED • "+(lastPcReasons==null||lastPcReasons.trim().isEmpty()?lastPcExecution:lastPcReasons);',
                  'else if(pcBlocked) state=(blockedCount>=3?"🔴":"🟠")+" PC OTO İŞLEM GÜVENLİK NEDENİYLE DURDU • "+v9599UiTr(lastPcReasons==null||lastPcReasons.trim().isEmpty()?lastPcExecution:lastPcReasons);')
main=main.replace('else if("LEADER_AUTO_WAIT".equals(lastPcExecution)) state="🟢 PC LEADER AUTO TARIYOR • UYGUN/QUALIFIED FIRSAT BEKLİYOR";',
                  'else if("LEADER_AUTO_WAIT".equals(lastPcExecution)) state="🟢 PC OTO TARIYOR • UYGUN İŞLEM ADAYI BEKLİYOR";')
main=main.replace('else if(inflight) state="🔵 SİNYAL İŞLENİYOR • RİSK / LINEAGE / GRANT KONTROLÜ";',
                  'else if(inflight) state="🔵 SİNYAL İŞLENİYOR • RİSK / İŞLEM KİMLİĞİ / YETKİ KONTROLÜ";')
main=main.replace('st.append("\\nPC LIVE: ").append(armed?"ARMED":"KAPALI");',
                  'st.append("\\nPC CANLI İŞLEM: ").append(armed?"AÇIK":"KAPALI");')
main=main.replace('st.append("\\nPC LEADER AUTO: ").append(pcAutoEnabled&&pcAutoConfigured?"AKTİF":"KAPALI/SENKRON");',
                  'st.append("\\nPC OTO İŞLEM: ").append(pcAutoEnabled&&pcAutoConfigured?"AKTİF":"KAPALI/SENKRON");')
main=main.replace('if(lex!=null&&!lex.trim().isEmpty())st.append(" • son ").append(lex.trim());',
                  'if(lex!=null&&!lex.trim().isEmpty())st.append(" • son ").append(v9599UiTr(lex.trim()));')
main=main.replace('if(lastPcReasons!=null&&!lastPcReasons.trim().isEmpty())st.append("\\nNeden: ").append(lastPcReasons.trim());',
                  'if(lastPcReasons!=null&&!lastPcReasons.trim().isEmpty())st.append("\\nNeden: ").append(v9599UiTr(lastPcReasons.trim()));')
main=main.replace('st.append("\\n").append(v9593LeaderDiagnosticsSummary(sp));',
                  'st.append("\\n").append(v9599UiTr(v9593LeaderDiagnosticsSummary(sp)));')
main=main.replace('android.widget.TextView detail=text(detailedAuto,11.15f,android.graphics.Color.WHITE,false);',
                  'android.widget.TextView detail=text(v9599UiTr(detailedAuto),11.15f,android.graphics.Color.WHITE,false);')
main=main.replace('android.widget.TextView life=text(lifecycleText,10.9f,android.graphics.Color.WHITE,false);',
                  'android.widget.TextView life=text(v9599UiTr(lifecycleText),10.9f,android.graphics.Color.WHITE,false);')
main_path.write_text(main)
analysis=analysis.replace('ChatGPT ANALİZ PAKETİ • v9.5.76','ChatGPT ANALİZ PAKETİ • v9.5.107')
analysis_path.write_text(analysis)
build=APP/'app/build.gradle'
text=build.read_text()
text=re.sub(r'versionCode\s+\d+','versionCode 26092102',text)
text=re.sub(r'versionName\s+[\"\'][^\"\']+[\"\']',"versionName '9.5.107'",text)
build.write_text(text)
assert "versionName '9.5.107'" in text
assert 'versionCode 26092102' in text
assert 'v9597ChooseAutoReview' in main
assert 'v9597WithAutoEvidence(symbol,prompt,now)' in analysis
assert 'v9545_batch_symbols' in methods and 'v9538_autobuild' in methods
print('v9.5.107 AUTO candidate review + read-only Turkish decision + position manager card reuse manual chart/source/plan-code flow; user opens chat; no order action added.')
