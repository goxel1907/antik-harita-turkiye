from pathlib import Path
import re
APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MON=APP/'app/src/main/java/com/futuresalarm/app/MonitorService.java'
BUILD=APP/'app/build.gradle'
if not MON.exists() or not BUILD.exists(): raise SystemExit('v9.5.18b required file missing')
m=MON.read_text()
m=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.18',m)
m=m.replace('Flow destek puanı','Akış destek puanı').replace('flow filtresi','akış filtresi').replace('reclaim/rejection','geri kazanım/ret')

live='        double v953LivePrice = (set.current != null ? set.current.close : closed.close);'
if 'v9518_live_' not in m:
    if live not in m: raise SystemExit('v9.5.18b live price anchor missing')
    m=m.replace(live,live+'\n        prefs.edit().putString("v9518_live_" + p.symbol, Double.toString(v953LivePrice)).apply();\n        v9518UpdateSignalResult(p.symbol, v953LivePrice);',1)

anchor='        prefs.edit().putBoolean(v953LockKey, true).apply();'
if 'v9518RecordSignal(symbol' not in m:
    if anchor not in m: raise SystemExit('v9.5.18b urgent anchor missing')
    m=m.replace(anchor,anchor+r'''
        String v9518RawDirection = direction;
        v9518RecordSignal(symbol, v9518RawDirection, detail);
        direction = v9518TurkishDirection(v9518RawDirection);
        detail = "SİNYAL NEDENİ: " + v9518Reason(v9518RawDirection) + "\n\n" + v9518TurkishText(detail);''',1)

helper=r'''

    private String v9518TurkishDirection(String d) {
        String u=d==null?"":d.toUpperCase(java.util.Locale.ROOT);
        if(u.contains("PULLBACK")) return "LONG SİNYALİ - GERİ ÇEKİLME TEYİDİ";
        if(u.contains("BREAKOUT")) return "LONG SİNYALİ - YUKARI KIRILIM TEYİDİ";
        if(u.contains("DİRENÇ")||u.contains("DIRENC")||u.contains("RESISTANCE")) return "SHORT SİNYALİ - DİRENÇ REDDİ TEYİDİ";
        if(u.contains("BREAKDOWN")) return "SHORT SİNYALİ - AŞAĞI KIRILIM TEYİDİ";
        return u.startsWith("SHORT")?"SHORT SİNYALİ":"LONG SİNYALİ";
    }

    private String v9518Reason(String d) {
        String u=d==null?"":d.toUpperCase(java.util.Locale.ROOT);
        if(u.contains("PULLBACK")) return "Geri çekilme bölgesine temas sonrası tamamlanmış 15 dakikalık yükseliş mumu bölgenin üst sınırını geri kazandı; fiyat giriş alanında kaldı ve canlı akış iki ardışık kontrolde uygun bulundu.";
        if(u.contains("BREAKOUT")) return "Tamamlanmış 15 dakikalık mum yukarı kırılım seviyesinin üzerinde kapandı; fiyat giriş veya yeniden test alanında kaldı ve canlı akış iki ardışık kontrolde uygun bulundu.";
        if(u.contains("DİRENÇ")||u.contains("DIRENC")||u.contains("RESISTANCE")) return "Direnç bölgesine temas sonrası tamamlanmış 15 dakikalık düşüş mumu bölgenin alt sınırının altında kapandı; fiyat giriş alanında kaldı ve canlı akış iki ardışık kontrolde uygun bulundu.";
        if(u.contains("BREAKDOWN")) return "Tamamlanmış 15 dakikalık mum aşağı kırılım seviyesinin altında kapandı; fiyat giriş veya yeniden test alanında kaldı ve canlı akış iki ardışık kontrolde uygun bulundu.";
        return "Tamamlanmış 15 dakikalık mum teyidi, geçerli giriş alanı ve iki ardışık uygun canlı akış kontrolü birlikte sağlandı.";
    }

    private String v9518ShortReason(String d) {
        String u=d==null?"":d.toUpperCase(java.util.Locale.ROOT);
        if(u.contains("PULLBACK")) return "geri çekilme teyidi";
        if(u.contains("BREAKOUT")) return "yukarı kırılım teyidi";
        if(u.contains("DİRENÇ")||u.contains("DIRENC")||u.contains("RESISTANCE")) return "direnç reddi teyidi";
        if(u.contains("BREAKDOWN")) return "aşağı kırılım teyidi";
        return "giriş teyidi";
    }

    private String v9518TurkishText(String x) {
        if(x==null) return "";
        return x.replace("LONG PULLBACK","LONG GERİ ÇEKİLME").replace("LONG BREAKOUT","LONG YUKARI KIRILIM")
                .replace("SHORT BREAKDOWN","SHORT AŞAĞI KIRILIM").replace("PULLBACK","GERİ ÇEKİLME")
                .replace("BREAKOUT","YUKARI KIRILIM").replace("BREAKDOWN","AŞAĞI KIRILIM")
                .replace("flow","akış").replace("Flow","Akış").replace("retest/reclaim","yeniden test/geri kazanım")
                .replace("retest/rejection","yeniden test/ret").replace("retest","yeniden test")
                .replace("reclaim","geri kazanım").replace("rejection","ret")
                .replace("bullish","yükseliş").replace("bearish","düşüş");
    }

    private double v9518Num(String text,String label) {
        try { java.util.regex.Matcher x=java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(label)+"\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text==null?"":text); if(x.find()) return Double.parseDouble(x.group(1)); }
        catch(Throwable ignored){} return Double.NaN;
    }
    private double v9518D(String key) { try{return Double.parseDouble(prefs.getString(key,"NaN"));}catch(Throwable ignored){return Double.NaN;} }
    private String v9518Time(long ts) { try{return new java.text.SimpleDateFormat("dd.MM.yyyy HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts));}catch(Throwable ignored){return Long.toString(ts);} }

    private void v9518RecordSignal(String symbol,String raw,String detail) {
        long now=System.currentTimeMillis(); String side=raw!=null&&raw.toUpperCase(java.util.Locale.ROOT).startsWith("SHORT")?"SHORT":"LONG";
        double live=v9518D("v9518_live_"+symbol); if(Double.isNaN(live)) live=v9518Num(detail,"Kapanış");
        double stop=v9518Num(detail,"STOP"),t1=v9518Num(detail,"TP1"),t2=v9518Num(detail,"TP2"),t3=v9518Num(detail,"TP3");
        android.content.SharedPreferences.Editor e=prefs.edit().putLong("v9518_signal_time_"+symbol,now).putLong("v9518_signal_end_"+symbol,0L)
                .putString("v9518_signal_side_"+symbol,side).putString("v9518_signal_reason_"+symbol,v9518Reason(raw))
                .putString("v9518_signal_reason_short_"+symbol,v9518ShortReason(raw)).putString("v9518_signal_state_"+symbol,"AÇIK - HEDEF/STOP TAKİBİNDE")
                .putInt("v9518_signal_best_"+symbol,0).putBoolean("v9518_signal_active_"+symbol,true).remove("v9518_signal_pct_"+symbol);
        if(!Double.isNaN(live)) e.putString("v9518_signal_price_"+symbol,Double.toString(live)); else e.remove("v9518_signal_price_"+symbol);
        if(!Double.isNaN(stop)) e.putString("v9518_signal_stop_"+symbol,Double.toString(stop)); else e.remove("v9518_signal_stop_"+symbol);
        if(!Double.isNaN(t1)) e.putString("v9518_signal_tp1_"+symbol,Double.toString(t1)); else e.remove("v9518_signal_tp1_"+symbol);
        if(!Double.isNaN(t2)) e.putString("v9518_signal_tp2_"+symbol,Double.toString(t2)); else e.remove("v9518_signal_tp2_"+symbol);
        if(!Double.isNaN(t3)) e.putString("v9518_signal_tp3_"+symbol,Double.toString(t3)); else e.remove("v9518_signal_tp3_"+symbol); e.apply();
    }

    private void v9518UpdateSignalResult(String symbol,double price) {
        if(!prefs.getBoolean("v9518_signal_active_"+symbol,false)||Double.isNaN(price)||price<=0) return;
        String side=prefs.getString("v9518_signal_side_"+symbol,"LONG"); boolean lng="LONG".equals(side);
        double stop=v9518D("v9518_signal_stop_"+symbol),t1=v9518D("v9518_signal_tp1_"+symbol),t2=v9518D("v9518_signal_tp2_"+symbol),t3=v9518D("v9518_signal_tp3_"+symbol);
        if(Double.isNaN(stop)||Double.isNaN(t3)) return;
        if((lng&&price<=stop)||(!lng&&price>=stop)){v9518Finish(symbol,stop,"ZARAR İLE KAPANDI - STOP");return;}
        if((lng&&price>=t3)||(!lng&&price<=t3)){v9518Finish(symbol,t3,"KÂR İLE KAPANDI - TP3");return;}
        int best=prefs.getInt("v9518_signal_best_"+symbol,0),next=best;
        if(!Double.isNaN(t2)&&((lng&&price>=t2)||(!lng&&price<=t2))) next=Math.max(next,2);
        else if(!Double.isNaN(t1)&&((lng&&price>=t1)||(!lng&&price<=t1))) next=Math.max(next,1);
        if(next!=best) prefs.edit().putInt("v9518_signal_best_"+symbol,next).putString("v9518_signal_state_"+symbol,next>=2?"AÇIK - TP2 GÖRÜLDÜ, TP3/STOP TAKİBİNDE":"AÇIK - TP1 GÖRÜLDÜ, TP2/TP3/STOP TAKİBİNDE").apply();
    }

    private void v9518Finish(String symbol,double exit,String state) {
        if(!prefs.getBoolean("v9518_signal_active_"+symbol,false)) return;
        long end=System.currentTimeMillis(); String side=prefs.getString("v9518_signal_side_"+symbol,"LONG"); double entry=v9518D("v9518_signal_price_"+symbol),pct=Double.NaN;
        if(!Double.isNaN(entry)&&entry>0) pct="SHORT".equals(side)?(entry-exit)/entry*100.0:(exit-entry)/entry*100.0;
        android.content.SharedPreferences.Editor e=prefs.edit().putBoolean("v9518_signal_active_"+symbol,false).putLong("v9518_signal_end_"+symbol,end).putString("v9518_signal_state_"+symbol,state);
        if(!Double.isNaN(pct)) e.putString("v9518_signal_pct_"+symbol,Double.toString(pct)); e.apply();
        String row=v9518Time(end)+" • "+side+" • "+prefs.getString("v9518_signal_reason_short_"+symbol,"giriş teyidi")+" • "+state;
        if(!Double.isNaN(pct)) row+=" • "+String.format(java.util.Locale.US,"%+.2f%%",pct);
        String old=prefs.getString("v9518_history_"+symbol,""); String[] rows=(row+(old==null||old.trim().isEmpty()?"":"\n"+old)).split("\\n");
        StringBuilder keep=new StringBuilder(); for(int i=0;i<rows.length&&i<8;i++){if(rows[i]==null||rows[i].trim().isEmpty())continue;if(keep.length()>0)keep.append("\n");keep.append(rows[i].trim());}
        prefs.edit().putString("v9518_history_"+symbol,keep.toString()).apply();
    }
'''
if 'private String v9518TurkishDirection(' not in m:
    p=m.rfind('}')
    if p<0: raise SystemExit('v9.5.18b closing brace missing')
    m=m[:p]+helper+'\n'+m[p:]
MON.write_text(m)
b=BUILD.read_text(); b=re.sub(r'versionCode\s+\d+','versionCode 32',b,count=1); b=re.sub(r"versionName\s+'[^']+'","versionName '9.5.18'",b,count=1); BUILD.write_text(b)
mon=MON.read_text(); bf=BUILD.read_text()
for ok,msg in [
    ('v9518RecordSignal(symbol' in mon,'record'),('v9518UpdateSignalResult' in mon,'tracking'),
    ('KÂR İLE KAPANDI - TP3' in mon and 'ZARAR İLE KAPANDI - STOP' in mon,'result states'),
    ('SİNYAL NEDENİ:' in mon and 'canlı akış iki ardışık kontrolde uygun bulundu' in mon,'Turkish reason'),
    ('versionCode 32' in bf and "versionName '9.5.18'" in bf,'version')]:
    if not ok: raise SystemExit('v9.5.18b failed: '+msg)
print('v9.5.18b OK: signal time/reason/levels + TP milestones + profit/loss closure + history.')
