from pathlib import Path
import os, re, shutil

app = Path('/tmp/futures15m-build/Futures15mAlarm')
java_dir = app / 'app/src/main/java/com/futuresalarm/app'
srcroot = Path(os.environ['CM_BUILD_DIR']) / 'futures15m_alarm'
main = java_dir / 'MainActivity.java'
manifest = app / 'app/src/main/AndroidManifest.xml'
build = app / 'app/build.gradle'

# Add the self-contained analysis package screen.
shutil.copy2(srcroot / 'v94_AnalysisPackActivity.java', java_dir / 'AnalysisPackActivity.java')

s = main.read_text()
s = s.replace('15m Futures Alarm PRO v9.3', '15m Futures Alarm PRO v9.4')
s = s.replace('15m Futures Alarm PRO v9.2', '15m Futures Alarm PRO v9.4')

helper = r'''

    private int v94dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void v94InstallAnalysisPackButton() {
        try {
            android.view.ViewGroup content = findViewById(android.R.id.content);
            if (content == null || content.findViewById(940401) != null) return;
            android.widget.Button b = new android.widget.Button(this);
            b.setId(940401);
            b.setText("📊 ANALİZ PAKETİ");
            b.setTextSize(12f);
            b.setTextColor(android.graphics.Color.WHITE);
            b.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            b.setBackgroundColor(android.graphics.Color.rgb(111, 34, 226));
            b.setOnClickListener(v -> startActivity(new android.content.Intent(this, AnalysisPackActivity.class)));
            android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(v94dp(158), v94dp(54));
            lp.gravity = android.view.Gravity.END | android.view.Gravity.BOTTOM;
            lp.setMargins(v94dp(12), v94dp(12), v94dp(14), v94dp(18));
            content.addView(b, lp);
        } catch (Throwable ignored) {}
    }
'''

post = r'''

    @Override
    protected void onPostCreate(android.os.Bundle savedInstanceState) {
        super.onPostCreate(savedInstanceState);
        v94InstallAnalysisPackButton();
    }
'''

if 'v94InstallAnalysisPackButton' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('MainActivity closing brace not found')
    s = s[:pos] + helper + post + '\n' + s[pos:]
else:
    print('v9.4 analysis button already present')
main.write_text(s)

m = manifest.read_text()
if 'AnalysisPackActivity' not in m:
    activity = '        <activity android:name=".AnalysisPackActivity" android:exported="false" />\n'
    if '</application>' not in m:
        raise SystemExit('Manifest application closing tag not found')
    m = m.replace('</application>', activity + '    </application>')
manifest.write_text(m)

b = build.read_text()
# Accept either the expected v9.3 version or an already partly-updated file.
b = re.sub(r'versionCode\s+12\b', 'versionCode 13', b)
b = re.sub(r"versionName\s+'9\.3\.0'", "versionName '9.4.0'", b)
if 'versionCode 13' not in b:
    b = re.sub(r'versionCode\s+\d+', 'versionCode 13', b, count=1)
if "versionName '9.4.0'" not in b:
    b = re.sub(r"versionName\s+'[^']+'", "versionName '9.4.0'", b, count=1)
build.write_text(b)

print('v9.4 analysis package integrated: 4x100 completed candles + volume/RSI + live metrics + ChatGPT share.')
