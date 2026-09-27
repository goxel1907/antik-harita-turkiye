from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
MON=JAVA/'MonitorService.java'
ANALYSIS=JAVA/'AnalysisPackActivity.java'
RADAR=JAVA/'MarketRadarActivity.java'
ENGINE=JAVA/'V9538MarketRadarEngine.java'
BUILD=APP/'app/build.gradle'
for p in (MAIN,MON,ANALYSIS,RADAR,ENGINE,BUILD):
    if not p.exists(): raise SystemExit('v9.5.57 missing: '+str(p))

m=MAIN.read_text()
for marker in ('V9551_VALIDITY_LIFECYCLE_UI','v9551BuildValidityText','v9518_signal_active_','v9518_signal_state_','v9522_order_sent_signal_','V9556_ADAPTIVE_MOMENTUM_REBASE'):
    if marker not in m and marker not in MON.read_text():
        raise SystemExit('v9.5.57 prerequisite missing: '+marker)

# Make scenario-vs-real-signal distinction explicit in coin detail UI.
m=m.replace('🎯 ANA KARAR:', '🧭 SENARYO / ANA KARAR (GERÇEK SİNYAL DEĞİL):')
m=m.replace('Henüz gerçek giriş sinyali oluşmadı.', 'GERÇEK SİNYAL YOK • ANA KARAR yalnız aday senaryodur; emir oluşturmaz.')

# Enrich the existing validity card instead of adding another long card.
old='''        if (active.isEmpty()) {\n            b.append("Aktif sinyal yok.\\n");\n        } else {'''
new='''        if (active.isEmpty()) {\n            b.append("Aktif GERÇEK sinyal yok. ANA KARAR/LONG-SHORT aday metni gerçek sinyal değildir.\\n");\n            v9557AppendRecentTerminalSignals(b, sp);\n        } else {'''
if old not in m:
    raise SystemExit('v9.5.57 empty-active validity anchor missing')
m=m.replace(old,new,1)

anchor='''                b.append("Emir uygunluğu: gönderim anında %0,50 fiyat sapması + STOP/TP geometrisi yeniden kontrol edilir.\\n");'''
if anchor not in m:
    raise SystemExit('v9.5.57 active-signal order status anchor missing')
replace='''                long sentTs = sp.getLong("v9522_order_sent_signal_" + sym, 0L);\n                if (sentTs == ts && ts > 0L)\n                    b.append("Emir durumu: GÖNDERİLDİ • Binance pozisyon/account sync ayrıca doğrulanır.\\n");\n                else\n                    b.append("Emir durumu: GÖNDERİLMEDİ • kullanıcı onayı bekleniyor.\\n");\n                b.append("Emir uygunluğu: gönderim anında %0,50 fiyat sapması + STOP/TP geometrisi yeniden kontrol edilir.\\n");'''
m=m.replace(anchor,replace,1)

if 'private void v9557AppendRecentTerminalSignals(' not in m:
    pos=m.rfind('}')
    if pos<0: raise SystemExit('v9.5.57 MainActivity close missing')
    helper=r'''

    // ============================================================
    // V9557_SIGNAL_LIFECYCLE_EXPLAIN
    // Read-only explanation layer: scenario != real signal; active signal !=
    // order; terminal signal reason remains visible after the active card ends.
    // No order placement/cancel and no analysis mutation here.
    // ============================================================
    private void v9557AppendRecentTerminalSignals(StringBuilder b, android.content.SharedPreferences sp) {
        try {
            java.util.ArrayList<String> syms=new java.util.ArrayList<>();
            java.util.Map<String,?> all=sp.getAll();
            final String p="v9518_signal_time_";
            for(String k:all.keySet()){
                if(k==null||!k.startsWith(p)) continue;
                String s=k.substring(p.length()).trim().toUpperCase(java.util.Locale.US);
                if(s.isEmpty()||sp.getBoolean("v9518_signal_active_"+s,false)) continue;
                long end=sp.getLong("v9518_signal_end_"+s,0L);
                long term=sp.getLong("v9541_last_terminal_at_"+s,0L);
                if(Math.max(end,term)>0L) syms.add(s);
            }
            java.util.Collections.sort(syms,(x,y)->{
                long ax=Math.max(sp.getLong("v9518_signal_end_"+x,0L),sp.getLong("v9541_last_terminal_at_"+x,0L));
                long ay=Math.max(sp.getLong("v9518_signal_end_"+y,0L),sp.getLong("v9541_last_terminal_at_"+y,0L));
                return java.lang.Long.compare(ay,ax);
            });
            if(syms.isEmpty()) return;
            b.append("SON SONLANAN GERÇEK SİNYALLER\\n");
            int shown=0;
            for(String s:syms){
                if(shown++>=3) break;
                String side=sp.getString("v9518_signal_side_"+s,"");
                String state=sp.getString("v9518_signal_state_"+s,"");
                String terminal=sp.getString("v9541_last_terminal_"+s,"");
                long when=Math.max(sp.getLong("v9518_signal_end_"+s,0L),sp.getLong("v9541_last_terminal_at_"+s,0L));
                String reason=(state!=null&&!state.trim().isEmpty())?state.trim():((terminal!=null&&!terminal.trim().isEmpty())?terminal.trim():"SİNYAL SONLANDI");
                b.append(v9551ShortSymbol(s)).append(' ').append(side==null?"":side.trim().toUpperCase(java.util.Locale.US))
                        .append(" • SONLANDI • neden: ").append(reason);
                if(when>0L) b.append(" • ").append(v9551AgeText(Math.max(0L,System.currentTimeMillis()-when))).append(" önce");
                b.append('\\n');
            }
        } catch(Throwable ignored) {}
    }
'''
    m=m[:pos]+helper+'\n'+m[pos:]

# Visible version bump only; trading/analysis rules remain v9.5.56 semantics.
m=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.57',m)
m=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.57  •  MANUEL PRO',m)
MAIN.write_text(m)
for p in (MON,ANALYSIS,RADAR,ENGINE):
    s=p.read_text()
    s=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.57',s)
    p.write_text(s)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091405',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.57'",bf,count=1)
BUILD.write_text(bf)

out=MAIN.read_text()
checks={
    'scenario label explicit':'GERÇEK SİNYAL DEĞİL' in out,
    'no-real-signal wording':'GERÇEK SİNYAL YOK • ANA KARAR yalnız aday senaryodur' in out,
    'terminal reason helper':'V9557_SIGNAL_LIFECYCLE_EXPLAIN' in out and 'SON SONLANAN GERÇEK SİNYALLER' in out,
    'active order status':'Emir durumu: GÖNDERİLMEDİ' in out and 'v9522_order_sent_signal_' in out,
    'validity card retained':'V9551_VALIDITY_LIFECYCLE_UI' in out and 'PLAN / SİNYAL GEÇERLİLİĞİ' in out,
    'adaptive rebase retained':'V9556_ADAPTIVE_MOMENTUM_REBASE' in MON.read_text(),
    'version main':'v9.5.57' in out,
    'version build':'versionCode 26091405' in BUILD.read_text() and "versionName '9.5.57'" in BUILD.read_text(),
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.57 sanity failed: '+', '.join(bad))
print('v9.5.57 patch applied: scenario vs real signal is explicit; active order status shown; recent terminal signal reason remains visible after the signal card ends. No trading rule changed.')
