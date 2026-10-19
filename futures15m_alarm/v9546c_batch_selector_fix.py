from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists(): raise SystemExit('v9.5.46c MainActivity missing')


def method_bounds(src, signature_fragment):
    a=src.find(signature_fragment)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    d=1;i=b+1;qs=qc=esc=lc=bc=False
    while i<len(src) and d:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if lc:
            if c=='\n':lc=False
        elif bc:
            if c=='*' and n=='/':bc=False;i+=1
        elif qs:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':qs=False
        elif qc:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":qc=False
        else:
            if c=='/' and n=='/':lc=True;i+=1
            elif c=='/' and n=='*':bc=True;i+=1
            elif c=='"':qs=True
            elif c=="'":qc=True
            elif c=='{':d+=1
            elif c=='}':d-=1
        i+=1
    return None if d else (a,b,i)

s=MAIN.read_text()
for marker in ('V9545_BATCH_ANALYSIS','V9546_ANALYSIS_DELETE_SHORTCUT','V9546A_PRECISE_DELETE_TARGET'):
    if marker not in s: raise SystemExit('v9.5.46c prerequisite missing: '+marker)

# Button now states what the selector actually supports.
s=s.replace('📦 TOPLU ANALİZ • 2–8 COİN','📦 TOPLU ANALİZ • RADAR / MANUEL',1)
s=s.replace('İki ile sekiz analizli coini tek ChatGPT paketinde hazırla',
            'Radar listesinden seç veya 2–8 coini elle yaz; tek ChatGPT paketinde hazırla',1)

b=method_bounds(s,'    private void v9545ShowBatchAnalysisDialog()')
if not b: raise SystemExit('v9.5.46c batch dialog missing')
a,_,e=b
method=r'''    // V9546C_BATCH_RADAR_MANUAL_SELECTOR
    private void v9545ShowBatchAnalysisDialog() {
        final java.util.ArrayList<String> radarSymbols=new java.util.ArrayList<>();
        final java.util.ArrayList<String> radarLabels=new java.util.ArrayList<>();
        try {
            String raw=V9538MarketRadarEngine.latestJson(this);
            org.json.JSONObject root=(raw==null||raw.trim().isEmpty())?null:new org.json.JSONObject(raw);
            org.json.JSONArray rows=root==null?null:root.optJSONArray("rows");
            if(rows!=null){
                for(int i=0;i<rows.length()&&radarSymbols.size()<8;i++){
                    org.json.JSONObject r=rows.optJSONObject(i);if(r==null)continue;
                    String sym=v9546cNormalizeBatchSymbol(r.optString("symbol",""));
                    if(sym.isEmpty()||radarSymbols.contains(sym))continue;
                    radarSymbols.add(sym);
                    String role=r.optString("role","ADAY"),stage=r.optString("stage","");int rank=r.optInt("rank",-1);
                    StringBuilder lab=new StringBuilder(sym);
                    if(rank>0)lab.append("  •  #").append(rank);
                    if(role!=null&&!role.trim().isEmpty())lab.append("  •  ").append(role);
                    if(stage!=null&&!stage.trim().isEmpty())lab.append("  •  ").append(stage);
                    radarLabels.add(lab.toString());
                }
            }
        }catch(Throwable ignored){}

        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(18),dp(6),dp(18),dp(4));
        TextView info=text("Coin seçimi:\n1) Güncel RADAR listesinden işaretle.\n2) İstediğin coinleri MANUEL alana yaz.\nToplam 2–8 coin olmalı. Eski analizli coinler otomatik seçilmez.",13f,Color.rgb(226,232,240),false);
        info.setLineSpacing(0,1.08f);body.addView(info,new LinearLayout.LayoutParams(-1,ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView rt=text("📡 GÜNCEL FUTURES RADAR • seçim önerisi, sinyal değil",12.5f,Color.rgb(96,165,250),true);
        LinearLayout.LayoutParams rtlp=new LinearLayout.LayoutParams(-1,ViewGroup.LayoutParams.WRAP_CONTENT);rtlp.setMargins(0,dp(12),0,dp(4));body.addView(rt,rtlp);

        final java.util.ArrayList<android.widget.CheckBox> checks=new java.util.ArrayList<>();
        android.widget.ScrollView rs=new android.widget.ScrollView(this);LinearLayout rb=new LinearLayout(this);rb.setOrientation(LinearLayout.VERTICAL);rs.addView(rb,new android.widget.ScrollView.LayoutParams(-1,-2));
        if(radarSymbols.isEmpty()){
            rb.addView(text("Radar henüz hazır değil. MANUEL COİN alanını kullanabilirsin.",12f,Color.rgb(251,191,36),false));
        }else{
            for(int i=0;i<radarSymbols.size();i++){
                android.widget.CheckBox cb=new android.widget.CheckBox(this);cb.setText(radarLabels.get(i));cb.setTextColor(Color.WHITE);cb.setTextSize(13f);cb.setChecked(false);cb.setPadding(dp(2),dp(3),dp(2),dp(3));rb.addView(cb,new LinearLayout.LayoutParams(-1,dp(42)));checks.add(cb);
            }
        }
        body.addView(rs,new LinearLayout.LayoutParams(-1,dp(230)));

        TextView mt=text("✍ MANUEL COİN GİRİŞİ",12.5f,Color.rgb(52,211,153),true);LinearLayout.LayoutParams mtlp=new LinearLayout.LayoutParams(-1,ViewGroup.LayoutParams.WRAP_CONTENT);mtlp.setMargins(0,dp(10),0,dp(4));body.addView(mt,mtlp);
        final EditText manual=new EditText(this);manual.setHint("Örn: BTC, ETH, CVC, FIL\nveya BTCUSDT ETHUSDT ...");manual.setHintTextColor(Color.rgb(125,138,160));manual.setTextColor(Color.WHITE);manual.setTextSize(14f);manual.setMinLines(2);manual.setMaxLines(4);manual.setSingleLine(false);manual.setPadding(dp(12),dp(9),dp(12),dp(9));manual.setBackgroundColor(Color.rgb(18,29,48));body.addView(manual,new LinearLayout.LayoutParams(-1,dp(86)));
        TextView hint=text("Radar + manuel seçimler birleştirilir; tekrar eden coinler tek sayılır.",11.5f,Color.rgb(148,163,184),false);LinearLayout.LayoutParams hlp=new LinearLayout.LayoutParams(-1,ViewGroup.LayoutParams.WRAP_CONTENT);hlp.setMargins(0,dp(5),0,0);body.addView(hint,hlp);

        final android.app.AlertDialog dlg=new android.app.AlertDialog.Builder(this).setTitle("📦 TOPLU ANALİZ • RADAR / MANUEL").setView(body).setNegativeButton("İPTAL",null).setPositiveButton("PAKETLERİ HAZIRLA",null).create();
        dlg.setOnShowListener(x->dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            java.util.LinkedHashSet<String> chosen=new java.util.LinkedHashSet<>();
            for(int i=0;i<checks.size()&&i<radarSymbols.size();i++)if(checks.get(i).isChecked())chosen.add(radarSymbols.get(i));
            String typed=manual.getText()==null?"":manual.getText().toString().trim();
            if(!typed.isEmpty())for(String part:typed.split("[\\s,;]+",-1)){String sym=v9546cNormalizeBatchSymbol(part);if(!sym.isEmpty())chosen.add(sym);}
            if(chosen.size()<2||chosen.size()>8){Toast.makeText(this,"Toplam 2–8 coin seçmelisin. Şu an: "+chosen.size(),Toast.LENGTH_LONG).show();return;}
            java.util.ArrayList<String> selected=new java.util.ArrayList<>(chosen);android.content.Intent in=new android.content.Intent(this,AnalysisPackActivity.class);in.putStringArrayListExtra("v9545_batch_symbols",selected);startActivity(in);dlg.dismiss();
        }));
        dlg.show();
    }'''
s=s[:a]+method+s[e:]

if 'private String v9546cNormalizeBatchSymbol(' not in s:
    p=s.rfind('}')
    helper=r'''

    private String v9546cNormalizeBatchSymbol(String raw){
        if(raw==null)return "";String x=raw.toUpperCase(java.util.Locale.US).trim();if(x.isEmpty())return "";
        x=x.replace("PERPETUAL","").replace("PERP","").replaceAll("[^A-Z0-9]","");
        if(x.isEmpty()||"USDT".equals(x))return "";if(!x.endsWith("USDT"))x+="USDT";if(x.length()<5||x.length()>28)return "";return x;
    }
'''
    s=s[:p]+helper+'\n'+s[p:]
MAIN.write_text(s)
out=MAIN.read_text()
checks={
 'selector':'V9546C_BATCH_RADAR_MANUAL_SELECTOR' in out,
 'radar source':'V9538MarketRadarEngine.latestJson(this)' in out,
 'manual field':'MANUEL COİN GİRİŞİ' in out and 'final EditText manual' in out,
 'not old plans':'Eski analizli coinler otomatik seçilmez' in out and 'cb.setChecked(false)' in out,
 'limit':'chosen.size()<2||chosen.size()>8' in out,
 'handoff':'v9545_batch_symbols' in out,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.46c sanity failed: '+', '.join(bad))
print('v9.5.46c OK: batch picker now uses current radar and/or manual 2-8 symbols; old analyzed plans are not auto-selected.')
