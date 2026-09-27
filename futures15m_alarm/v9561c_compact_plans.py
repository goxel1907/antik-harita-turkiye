from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists(): raise SystemExit('v9.5.61c MainActivity missing')


def bounds(src,fragment):
    a=src.find(fragment)
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
# Stored historical plans are not the current Radar/manual watch selection.
s=s.replace('🧭 ANALİZLERE HIZLI GEÇİŞ  •  " + symbols.size() + " coin','🧭 KAYITLI PLANLAR  •  " + symbols.size() + " coin')
s=s.replace('Dokun: analize git • basılı tut: analizi sil','Dokun: kartı aç/kapat • basılı tut: analizi sil')
s=s.replace('Coine dokun → uygulama doğrudan o analiz kartına iner','Dokun: kartı aç/kapat • basılı tut: analizi sil')
s=s.replace('t.contains("İZLENEN PLANLAR") || t.contains("IZLENEN PLANLAR")',
            't.contains("İZLENEN PLANLAR") || t.contains("IZLENEN PLANLAR") || t.contains("KAYITLI PLANLAR")')
# Exact-symbol fallback: never allow TUSDT substring-matching THEUSDT.
s=s.replace('return text.toUpperCase(java.util.Locale.US).contains(symbol.toUpperCase(java.util.Locale.US));',
            'return false; // v9.5.61 exact-symbol defense')
s=s.replace('b.setOnClickListener(v -> v9544ScrollToCoin(sym));','b.setOnClickListener(v -> v9561ToggleStoredPlan(sym));',1)

b=bounds(s,'    private void v9544ScrollToCoin(String symbol)')
if not b: raise SystemExit('v9.5.61c scroll method missing')
a,_,e=b
x=s[a:e]
if 'V9561_REVEAL_BEFORE_SCROLL' not in x:
    p=x.find('{')+1
    x=x[:p]+'''\n        // V9561_REVEAL_BEFORE_SCROLL\n        try { v9561RevealStoredPlan(symbol); } catch (Throwable ignored) {}\n'''+x[p:]
    s=s[:a]+x+s[e:]

b=bounds(s,'    private void v9544InstallCoinNavigator()')
if not b: raise SystemExit('v9.5.61c nav installer missing')
a,_,e=b
x=s[a:e]
if 'V9561_COLLAPSE_STORED_PLANS' not in x:
    p=x.rfind('}')
    x=x[:p]+'''        // V9561_COLLAPSE_STORED_PLANS\n        try { v9561ApplyStoredPlanVisibility(); } catch (Throwable ignored) {}\n'''+x[p:]
    s=s[:a]+x+s[e:]

if 'V9561_COMPACT_STORED_PLANS' not in s:
    pos=s.rfind('}')
    helper=r'''

    // V9561_COMPACT_STORED_PLANS — UI only; no plan is deleted or deactivated.
    private String v9561ExpandedPlanSymbol="";
    private boolean v9561PlanLike(android.view.View v) {
        if(v==null)return false;String t=v9544FlatText(v).toUpperCase(java.util.Locale.ROOT);
        if(!t.matches("(?s).*\\b[A-Z0-9]{2,20}USDT\\b.*"))return false;
        return t.contains("CANLI TEYİT")||t.contains("CANLI TEYIT")||t.contains("SİNYAL TAKİBİ")||t.contains("SINYAL TAKIBI")
                ||t.contains("GÜNLÜK PLAN")||t.contains("GUNLUK PLAN")
                ||(t.contains("STOP")&&t.contains("TP1")&&(t.contains("GİRİŞ")||t.contains("GIRIS")));
    }
    private String v9561PlanSymbol(android.view.View v) {
        try{java.util.regex.Matcher m=java.util.regex.Pattern.compile("(?<![A-Z0-9])([A-Z0-9]{2,20}USDT)(?![A-Z0-9])")
                .matcher(v9544FlatText(v).toUpperCase(java.util.Locale.US));return m.find()?m.group(1):"";}catch(Throwable ignored){return "";}
    }
    private int v9561StoredHeader(android.widget.LinearLayout root) {
        if(root==null)return -1;for(int i=0;i<root.getChildCount();i++){
            String t=v9544FlatText(root.getChildAt(i));
            if(t.contains("İZLENEN PLANLAR")||t.contains("IZLENEN PLANLAR")||t.contains("KAYITLI PLANLAR"))return i;
        }return -1;
    }
    private void v9561RenameHeader(android.view.View v) {
        if(v==null)return;if(v instanceof android.widget.TextView){
            android.widget.TextView t=(android.widget.TextView)v;String q=t.getText()==null?"":t.getText().toString();
            if(q.contains("İZLENEN PLANLAR")||q.contains("IZLENEN PLANLAR"))
                t.setText(q.replace("İZLENEN PLANLAR","KAYITLI PLANLAR • kartlar kapalı").replace("IZLENEN PLANLAR","KAYITLI PLANLAR • kartlar kapalı"));
        }
        if(v instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)v;for(int i=0;i<g.getChildCount();i++)v9561RenameHeader(g.getChildAt(i));}
    }
    private void v9561ApplyStoredPlanVisibility() {
        android.widget.LinearLayout root=v9544MainRoot();if(root==null)return;int h=v9561StoredHeader(root);if(h<0)return;
        v9561RenameHeader(root.getChildAt(h));
        for(int i=h+1;i<root.getChildCount();i++){
            android.view.View c=root.getChildAt(i);if(!v9561PlanLike(c))continue;String sym=v9561PlanSymbol(c);
            boolean show=!v9561ExpandedPlanSymbol.isEmpty()&&v9561SameSymbol(sym,v9561ExpandedPlanSymbol);
            c.setVisibility(show?android.view.View.VISIBLE:android.view.View.GONE);
        }
    }
    private void v9561RevealStoredPlan(String symbol) {
        String sym=v9561NormSymbol(symbol);if(sym.isEmpty())return;v9561ExpandedPlanSymbol=sym;v9561ApplyStoredPlanVisibility();
    }
    private void v9561ToggleStoredPlan(String symbol) {
        String sym=v9561NormSymbol(symbol);if(sym.isEmpty())return;
        if(v9561SameSymbol(sym,v9561ExpandedPlanSymbol)){v9561ExpandedPlanSymbol="";v9561ApplyStoredPlanVisibility();return;}
        v9561RevealStoredPlan(sym);android.view.View content=findViewById(android.R.id.content);
        if(content!=null)content.postDelayed(() -> {try{v9544ScrollToCoin(sym);}catch(Throwable ignored){}},80L);
    }
'''
    s=s[:pos]+helper+'\n'+s[pos:]

MAIN.write_text(s)
out=MAIN.read_text()
checks={
 'compact helper':'V9561_COMPACT_STORED_PLANS' in out and 'v9561ToggleStoredPlan' in out,
 'honest label':'KAYITLI PLANLAR' in out,
 'exact fallback':'return false; // v9.5.61 exact-symbol defense' in out,
 'delete flow retained':'V9546_ANALYSIS_DELETE_SHORTCUT' in out,
 'current selector retained':'V9547_SHARED_BATCH_SELECTOR' in out or 'v9545ShowBatchAnalysisDialog' in out,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.61c failed: '+', '.join(bad))
print('v9.5.61c OK: stored plans are collapsed and explicitly separated from current watch/radar selection; exact symbol fallback prevents T/THE substring collisions.')
