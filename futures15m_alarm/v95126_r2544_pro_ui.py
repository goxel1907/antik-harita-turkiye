r"""V95126_R2544_PRO_UI (Claude, Anthropic • Cowork • 2026-09-28): profesyonel ana ekran + yeni ikon.
Yalnız görünüm. Yürütme DEĞİŞMEZ (PC-only / fail-closed; /live/execute POST yok — aşağıda doğrulanır).
- Eski "OTO İŞLEM DURUMU" duvar-yazısı: ana ekranda ilk 5 satır + "▸ N satır ayrıntı"; dokununca tam metin.
- Kartlar: yuvarlatılmış köşe + ince kenarlık (GradientDrawable), satır aralığı.
- İşlem Merkezi kartı: başlıklar kalın/renkli; JEV son karar ALIŞ yeşil / SATIŞ kırmızı / BEKLE sarı;
  karar zamanı + yaşı; 15 dk'dan eski karar "ESKİ KARAR — ŞİMDİKİ PİYASA İLE KARIŞTIRMA" rozeti.
- Yeni adaptive launcher ikonu (ic_launcher_r2544): koyu lacivert zemin, 3 mum + yükselen nabız çizgisi.
"""
from pathlib import Path

app = Path('/tmp/futures15m-build/Futures15mAlarm')
java = app / 'app/src/main/java/com/futuresalarm/app'
res = app / 'app/src/main/res'
main_path, card_path = java / 'MainActivity.java', java / 'AutoDecisionCard.java'
main, card = main_path.read_text(encoding='utf-8'), card_path.read_text(encoding='utf-8')
assert 'V95125_R2544_CLAUDE' in main, 'v95125 must run first'

def rep(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit('V95126 anchor count %d: %s' % (n, label))
    return text.replace(old, new)

# 1) MainActivity yardımcıları
main = rep(main, '    private TextView text(String s, float sp, int color, boolean bold) {',
'''    // V95126_R2544_PRO_UI yardımcıları: yuvarlatılmış kart zemini.
    private android.graphics.drawable.GradientDrawable v95126Card(int fill, int stroke) {
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(14));
        g.setStroke(Math.max(1, dp(1)), stroke);
        return g;
    }
    private static int v95126Lighter(int c) {
        int r = Math.min(255, Color.red(c) + 48), g = Math.min(255, Color.green(c) + 48), b = Math.min(255, Color.blue(c) + 48);
        return Color.rgb(r, g, b);
    }

    private TextView text(String s, float sp, int color, boolean bold) {''', 'text helper')

# 2) Duvar-yazısı durum bloğu → kısa + dokun-aç
main = rep(main,
'''        android.widget.TextView status=text(st.toString(),11.8f,android.graphics.Color.WHITE,false);
        status.setPadding(dp(9),dp(7),dp(9),dp(7));status.setBackgroundColor(stateBg);''',
'''        final String v95126StFull=st.toString();
        String[] v95126Lines=v95126StFull.split("\\n");
        StringBuilder v95126Short=new StringBuilder();
        int v95126Keep=Math.min(5,v95126Lines.length);
        for(int v95126I=0;v95126I<v95126Keep;v95126I++){if(v95126I>0)v95126Short.append("\\n");v95126Short.append(v95126Lines[v95126I]);}
        if(v95126Lines.length>v95126Keep)v95126Short.append("\\n▸ ").append(v95126Lines.length-v95126Keep).append(" satır ayrıntı • dokunun");
        android.widget.TextView status=text(v95126Short.toString(),12.2f,android.graphics.Color.WHITE,false);
        status.setPadding(dp(12),dp(10),dp(12),dp(10));status.setBackground(v95126Card(stateBg,v95126Lighter(stateBg)));
        status.setLineSpacing(0f,1.12f);
        status.setOnClickListener(v->{
            android.widget.ScrollView v95126Scroll=new android.widget.ScrollView(this);
            android.widget.TextView v95126Body=text(v95126StFull,13.0f,android.graphics.Color.WHITE,false);
            v95126Body.setPadding(dp(14),dp(14),dp(14),dp(14));v95126Body.setTextIsSelectable(true);v95126Body.setLineSpacing(0f,1.12f);
            v95126Scroll.addView(v95126Body);
            new android.app.AlertDialog.Builder(this).setTitle("OTO işlem durumu • tüm ayrıntılar").setView(v95126Scroll).setPositiveButton("Kapat",null).show();
        });''', 'status block')

# 3) İşlem Merkezi kartı: biçimli metin + yuvarlak zemin
main = rep(main,
'''        decisionCard.setBackgroundColor(pcFresh?android.graphics.Color.rgb(19,45,70):android.graphics.Color.rgb(100,45,20));''',
'''        decisionCard.setText(AutoDecisionCard.styled(AutoDecisionCard.render(sp,now,false)));
        decisionCard.setLineSpacing(0f,1.14f);
        int v95126DecBg=pcFresh?android.graphics.Color.rgb(15,35,58):android.graphics.Color.rgb(90,40,18);
        decisionCard.setBackground(v95126Card(v95126DecBg,pcFresh?android.graphics.Color.rgb(56,189,248):android.graphics.Color.rgb(251,146,60)));''', 'decision card')
main = rep(main,
'''        box.addView(decisionCard,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));''',
'''        android.widget.LinearLayout.LayoutParams v95126Dlp=new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        v95126Dlp.setMargins(0,dp(8),0,dp(4));
        box.addView(decisionCard,v95126Dlp);''', 'decision card add')

# 4) AutoDecisionCard: karar yaşı + biçimlendirme
card = rep(card,
'''                if(!setup.isEmpty())b.append("\\nSetup: ").append(trText(setup));
            }''',
'''                if(!setup.isEmpty())b.append("\\nSetup: ").append(trText(setup));
            }
            // V95126: karar zamanı/yaşı — eski karar şimdiki piyasa gibi görünmesin.
            long v95126DecAt=v95126IsoMs(val(row,"annotatedAt",""));
            if(v95126DecAt>0){
                long v95126AgeMin=Math.max(0L,(now-v95126DecAt)/60000L);
                b.append("\\nKarar zamanı: ").append(V95113PcTruth.hhmmss(v95126DecAt)).append(" (").append(v95126AgeMin).append(" dk önce)");
                if(v95126AgeMin>=15)b.append("\\nESKİ KARAR — ŞİMDİKİ PİYASA İLE KARIŞTIRMA");
            }''', 'decision age')
card = rep(card, '\n// V95123_PRO_UI_R2542\n}',
'''
    // V95126_R2544_PRO_UI: ISO zaman → epoch ms (API 21 uyumlu).
    private static long v95126IsoMs(String iso){
        if(iso==null||iso.trim().isEmpty())return 0L;
        String s=iso.trim();
        String[] fmts={"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'","yyyy-MM-dd'T'HH:mm:ss'Z'"};
        for(String f:fmts){
            try{java.text.SimpleDateFormat p=new java.text.SimpleDateFormat(f,java.util.Locale.US);p.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));java.util.Date d=p.parse(s);if(d!=null)return d.getTime();}
            catch(Exception ignored){}
        }
        return 0L;
    }
    // V95126_R2544_PRO_UI: başlık/karar satırlarını vurgular (salt görünüm).
    public static CharSequence styled(String raw){
        String text=raw==null?"":raw;
        android.text.SpannableStringBuilder sb=new android.text.SpannableStringBuilder();
        String[] lines=text.split("\\n",-1);
        for(int i=0;i<lines.length;i++){
            String line=lines[i];
            int start=sb.length();
            sb.append(line);
            int end=sb.length();
            if(i<lines.length-1)sb.append("\\n");
            if(end<=start)continue;
            int color=0;boolean bold=false;float size=1f;
            String u=line.toUpperCase(java.util.Locale.ROOT);
            if(i==0){bold=true;size=1.18f;color=android.graphics.Color.rgb(125,211,252);}
            else if(line.startsWith("SON ADAY")){bold=true;size=1.1f;color=android.graphics.Color.rgb(226,232,240);}
            else if(line.startsWith("JEV son karar")){bold=true;size=1.08f;
                color=u.contains("ALIŞ")?android.graphics.Color.rgb(74,222,128):u.contains("SATIŞ")?android.graphics.Color.rgb(248,113,113):android.graphics.Color.rgb(250,204,21);}
            else if(line.startsWith("ESKİ KARAR")){bold=true;color=android.graphics.Color.rgb(251,146,60);}
            else if(line.startsWith("GÜVENLİK")){bold=true;size=0.92f;color=android.graphics.Color.rgb(148,163,184);}
            else if(line.startsWith("LIVE • AÇIK")){bold=true;color=android.graphics.Color.rgb(74,222,128);}
            else if(line.startsWith("LIVE • KAPALI")||line.startsWith("LIVE • BİLİNMİYOR")){bold=true;color=android.graphics.Color.rgb(251,146,60);}
            else if(line.startsWith("Ayrıntılar için")){size=0.88f;color=android.graphics.Color.rgb(148,163,184);}
            if(bold)sb.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD),start,end,android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if(color!=0)sb.setSpan(new android.text.style.ForegroundColorSpan(color),start,end,android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if(size!=1f)sb.setSpan(new android.text.style.RelativeSizeSpan(size),start,end,android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return sb;
    }

// V95123_PRO_UI_R2542
}''', 'card class end')

# 5) Yeni adaptive ikon
(res / 'values' / 'r2544_launcher_colors.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="launcher_bg_r2544">#0B1324</color>
</resources>
''', encoding='utf-8')
(res / 'drawable' / 'ic_launcher_foreground_r2544.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#13233F" android:pathData="M35,30 L73,30 Q78,30 78,35 L78,73 Q78,78 73,78 L35,78 Q30,78 30,73 L30,35 Q30,30 35,30 Z"/>
    <path android:fillColor="#00000000" android:strokeColor="#34D399" android:strokeWidth="2" android:strokeLineCap="round" android:pathData="M38,46 L38,72"/>
    <path android:fillColor="#34D399" android:pathData="M35,52 L41,52 L41,66 L35,66 Z"/>
    <path android:fillColor="#00000000" android:strokeColor="#F87171" android:strokeWidth="2" android:strokeLineCap="round" android:pathData="M51,40 L51,64"/>
    <path android:fillColor="#F87171" android:pathData="M48,45 L54,45 L54,57 L48,57 Z"/>
    <path android:fillColor="#00000000" android:strokeColor="#34D399" android:strokeWidth="2" android:strokeLineCap="round" android:pathData="M64,33 L64,58"/>
    <path android:fillColor="#34D399" android:pathData="M61,37 L67,37 L67,52 L61,52 Z"/>
    <path android:fillColor="#00000000" android:strokeColor="#38BDF8" android:strokeWidth="3.2" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="M33,70 L44,62 L52,66 L62,52 L72,41"/>
    <path android:fillColor="#38BDF8" android:pathData="M76,36 L66,38 L74,46 Z"/>
</vector>
''', encoding='utf-8')
for d in ['mipmap-anydpi-v26', 'mipmap-anydpi']:
    (res / d).mkdir(parents=True, exist_ok=True)
    (res / d / 'ic_launcher_r2544.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/launcher_bg_r2544" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_r2544" />
</adaptive-icon>
''', encoding='utf-8')
manifest_path = app / 'app/src/main/AndroidManifest.xml'
manifest = manifest_path.read_text(encoding='utf-8')
if '@mipmap/ic_launcher_pro_v957' in manifest:
    manifest = manifest.replace('@mipmap/ic_launcher_pro_v957', '@mipmap/ic_launcher_r2544')
else:
    print('V95126 WARNING: launcher icon anchor not found; icon unchanged')
manifest_path.write_text(manifest, encoding='utf-8')

client = (java / 'BrainHubClient.java').read_text(encoding='utf-8')
assert 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client
assert 'post(c, "/live/execute", intent, true)' not in client
main += '\n// V95126_R2544_PRO_UI\n'
card += '\n// V95126_R2544_PRO_UI\n'
main_path.write_text(main, encoding='utf-8')
card_path.write_text(card, encoding='utf-8')
print('V95126_R2544_PRO_UI_OK')
