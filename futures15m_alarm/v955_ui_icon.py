from pathlib import Path
import base64, re, os

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
BUILD=APP/'app/build.gradle'
MANIFEST=APP/'app/src/main/AndroidManifest.xml'
SRCROOT=Path(os.environ['CM_BUILD_DIR'])/'futures15m_alarm'
for p in (MAIN,BUILD,MANIFEST):
    if not p.exists(): raise SystemExit('v9.5.5 missing '+str(p))

s=MAIN.read_text()
s=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.5',s)
s=s.replace('15m Futures Alarm PRO v9.4','15m Futures Alarm PRO v9.5.5').replace('15m Futures Alarm PRO v9.3','15m Futures Alarm PRO v9.5.5')

# Main background / spacing / hierarchy.
s=s.replace('scroll.setBackgroundColor(Color.rgb(11, 15, 20));','scroll.setBackgroundColor(Color.rgb(5, 10, 18));')
s=s.replace('root.setPadding(dp(18), dp(18), dp(18), dp(28));','root.setPadding(dp(14), dp(16), dp(14), dp(28));')
s=re.sub(r'root\.addView\(text\("15m Futures Alarm PRO v9\.5\.5 • MANUEL PRO", 28, Color\.WHITE, true\)\);',
'''root.addView(text("15m Futures Alarm PRO", 27, Color.WHITE, true));
        TextView v955Version = text("v9.5.5  •  MANUEL PRO", 14, Color.rgb(74, 222, 128), true);
        v955Version.setPadding(0, dp(2), 0, dp(4));
        root.addView(v955Version);''',s)
s=s.replace('statusView.setBackgroundColor(Color.rgb(30, 41, 59));','statusView.setBackground(v955Panel(Color.rgb(15, 28, 46), Color.rgb(46, 65, 92), 14));')

# Cleaner button copy + palette.
s=s.replace('button("İZLEMEYİ BAŞLAT", Color.rgb(34, 197, 94))','button("▶  İZLEMEYİ BAŞLAT", Color.rgb(5, 116, 78))')
s=s.replace('button("DURDUR", Color.rgb(239, 68, 68))','button("■  DURDUR", Color.rgb(127, 29, 29))')
s=s.replace('button("CHATGPT PLAN KODU YAPIŞTIR / TOPLU GÜNCELLE", Color.rgb(8, 145, 178))','button("▣  CHATGPT PLAN KODU  •  YAPIŞTIR / GÜNCELLE", Color.rgb(7, 89, 133))')
s=s.replace('button("SESSİZ TAKİP • BİLDİRİM YOK", Color.rgb(245, 158, 11))','button("◉  SESSİZ TAKİP  •  BİLDİRİM YOK", Color.rgb(146, 96, 8))')
s=s.replace('button("TEST KRİTİK ALARM", Color.rgb(220, 38, 38))','button("⚠  TEST KRİTİK ALARM", Color.rgb(153, 27, 27))')
s=s.replace('button("PİL OPTİMİZASYONU AYARLARI", Color.rgb(71, 85, 105))','button("⚙  PİL / ARKA PLAN AYARLARI", Color.rgb(51, 65, 85))')
s=s.replace('button("MASTER ANALİZ PROMPTUNU KOPYALA • GRAFİKLERLE GÖNDER", Color.rgb(109, 40, 217))','button("✦  MASTER ANALİZ PROMPTUNU KOPYALA", Color.rgb(79, 46, 165))')

# Put Analysis Package into normal flow; remove the floating overlay.
anchor='        root.addView(promptBtn, promptLp);'
if 'V955_EMBEDDED_ANALYSIS_BUTTON' not in s:
    if anchor not in s: raise SystemExit('v9.5.5 prompt button anchor missing')
    s=s.replace(anchor,anchor+'''\n\n        // V955_EMBEDDED_ANALYSIS_BUTTON
        Button analysisPack = button("▤  ANALİZ PAKETİ  •  4×100 MUM", Color.rgb(76, 29, 149));
        analysisPack.setOnClickListener(v -> startActivity(new Intent(this, AnalysisPackActivity.class)));
        LinearLayout.LayoutParams analysisLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        analysisLp.setMargins(0, 0, 0, dp(18));
        root.addView(analysisPack, analysisLp);''',1)
s=s.replace('        v94InstallAnalysisPackButton();','        // v9.5.5: floating analiz butonu kaldırıldı; ana akışta gösteriliyor.')

# Coin cards / live panels / professional META panels.
s=s.replace('card.setPadding(dp(14), dp(12), dp(14), dp(12));','card.setPadding(dp(12), dp(12), dp(12), dp(12));')
s=s.replace('card.setBackgroundColor(Color.rgb(17, 24, 39));','card.setBackground(v955Panel(Color.rgb(9, 18, 31), Color.rgb(30, 58, 90), 16));')
s=s.replace('TextView symbolTitle = text(p.symbol + "   ↗ BINANCE FUTURES", 20, Color.rgb(34, 197, 94), true);','TextView symbolTitle = text(p.symbol + "   ↗ BINANCE FUTURES", 20, Color.rgb(74, 222, 128), true);')
s=s.replace('livePanel.setBackgroundColor(Color.rgb(15, 23, 42));','livePanel.setBackground(v955Panel(Color.rgb(7, 22, 34), Color.rgb(20, 83, 104), 12));')
s=s.replace('meta.setBackgroundColor(Color.rgb(30, 41, 59));','meta.setBackground(v955Panel(Color.rgb(17, 30, 48), Color.rgb(51, 65, 85), 12));')
s=s.replace('t.setBackgroundColor(Color.rgb(15, 23, 42));','t.setBackground(v955Panel(Color.rgb(15, 23, 42), Color.rgb(51, 65, 85), 12));')

# Compact footer instead of the long technical paragraph.
start=s.find('        TextView note = text(')
if start>=0:
    end=s.find('        root.addView(note);',start)
    if end>=0:
        end+=len('        root.addView(note);')
        compact='''        TextView note = text("🔒 Plan seviyeleri ChatGPT manuel planından gelir; uygulama kendiliğinden değiştirmez.\\nKritik bildirim yalnız gerçek giriş teyidinde üretilir • otomatik emir YOK.", 11.5f, Color.rgb(100, 116, 139), false);
        note.setGravity(Gravity.CENTER_HORIZONTAL);
        note.setPadding(dp(8), dp(10), dp(8), 0);
        root.addView(note);'''
        s=s[:start]+compact+s[end:]

# Rounded button helper.
old=re.search(r'    private Button button\(String label, int color\) \{.*?\n    \}',s,re.S)
if not old: raise SystemExit('v9.5.5 button helper missing')
new='''    private Button button(String label, int color) {
        Button b = new Button(this);
        b.setText(label); b.setTextColor(Color.WHITE); b.setTextSize(12.2f);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD); b.setAllCaps(false); b.setGravity(Gravity.CENTER);
        b.setPadding(dp(8), dp(4), dp(8), dp(4)); b.setMinHeight(0); b.setMinimumHeight(0);
        b.setBackground(v955Panel(color, Color.argb(72,255,255,255), 12));
        return b;
    }'''
s=s[:old.start()]+new+s[old.end():]

if 'private android.graphics.drawable.GradientDrawable v955Panel(' not in s:
    pos=s.rfind('}')
    helper='''\n    private android.graphics.drawable.GradientDrawable v955Panel(int fill, int stroke, int radiusDp) {
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE); g.setColor(fill);
        g.setCornerRadius(dp(radiusDp)); if (stroke != Color.TRANSPARENT) g.setStroke(dp(1), stroke); return g;
    }\n'''
    s=s[:pos]+helper+s[pos:]
MAIN.write_text(s)

# Launcher icon added directly to APK resources.
payload=SRCROOT/'v955_launcher_icon.b64'
if not payload.exists(): raise SystemExit('v9.5.5 icon payload missing')
out=APP/'app/src/main/res/drawable-nodpi'; out.mkdir(parents=True,exist_ok=True)
(out/'ic_launcher_pro.png').write_bytes(base64.b64decode(payload.read_text().strip()))
m=MANIFEST.read_text(); mt=re.search(r'<application\b[^>]*>',m,re.S)
if not mt: raise SystemExit('v9.5.5 application tag missing')
tag=mt.group(0); tag=re.sub(r'\s+android:(?:roundIcon|icon)="[^"]*"','',tag)
tag=tag[:-1]+'\n        android:icon="@drawable/ic_launcher_pro"\n        android:roundIcon="@drawable/ic_launcher_pro">'
MANIFEST.write_text(m[:mt.start()]+tag+m[mt.end():])

b=BUILD.read_text(); b=re.sub(r'versionCode\s+\d+','versionCode 19',b,1); b=re.sub(r"versionName\s+'[^']+'","versionName '9.5.5'",b,1); BUILD.write_text(b)

f=MAIN.read_text()
for ok,msg in [
 ('v9.5.5' in f,'version'),('V955_EMBEDDED_ANALYSIS_BUTTON' in f,'analysis button'),('v95AddMetaPanel' in f,'META'),
 ('v953AddDecisionGate' in f,'decision gate'),('v953ScenarioLabel' in f,'scenario labels'),('v955Panel' in f,'rounded UI'),
 ('@drawable/ic_launcher_pro' in MANIFEST.read_text(),'icon'),("versionName '9.5.5'" in BUILD.read_text(),'build version')]:
    if not ok: raise SystemExit('v9.5.5 check failed: '+msg)
print('v9.5.5 OK: professional UI + embedded analysis package + launcher icon.')
