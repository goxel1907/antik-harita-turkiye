from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.20 required file missing: ' + str(p))

# ------------------------------------------------------------------
# MAIN UI: remove decorative/ambiguous glyphs, make every action self-explaining,
# tighten the visual hierarchy and keep only meaningful status symbols.
# ------------------------------------------------------------------
m = MAIN.read_text()
m = m.replace('v9.5.19', 'v9.5.20')
m = re.sub(r'15m Futures Alarm PRO\s*[•-]?\s*v9\.5(?:\.\d+)*',
           '15m Futures Alarm PRO v9.5.20', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
           'v9.5.20  •  MANUEL PRO', m)

# Header copy: less promotional, more operational and easier to scan.
m = m.replace(
    'TAMAMEN ÜCRETSİZ • ChatGPT analiz planı + Binance public veri • 15 sn takip • 15m kapanış teyidi',
    'MANUEL KARAR DESTEĞİ • ChatGPT planı • Binance public veri\n15 sn izleme • tamamlanmış 15 dk teyidi • otomatik emir yok')

# Remove ornamental square/star/circle glyphs that can render inconsistently on Android.
# Keep function names explicit and use a second line as the action explanation.
button_map = {
    '▶  İZLEMEYİ BAŞLAT': 'İZLEMEYİ BAŞLAT\\n15 sn aralıkla canlı takip',
    '■  DURDUR': 'DURDUR\\nTakibi güvenli kapat',
    '▣  CHATGPT PLAN KODU  •  YAPIŞTIR / GÜNCELLE': 'PLAN KODU\\nYapıştır veya güncelle',
    '◉  SESSİZ TAKİP  •  BİLDİRİM YOK': 'SESSİZ TAKİP\\nBildirim göndermeden izle',
    '⚠  TEST KRİTİK ALARM': 'ALARM TESTİ\\nSes ve titreşimi kontrol et',
    '⚙  PİL / ARKA PLAN AYARLARI': 'PİL / ARKA PLAN\\nKesintisiz takip ayarları',
    '✦  MASTER ANALİZ PROMPTUNU KOPYALA': 'MASTER PROMPT\\nPanoya kopyala',
    '▤  ANALİZ PAKETİ  •  4×100 MUM': 'ANALİZ PAKETİ\\n4 zaman dilimi • güncel mumlar',
}
for old, new in button_map.items():
    m = m.replace(old, new)

m = m.replace('İzlenen coinler  •  MANUEL PRO ANALİZ PLANLARI', 'İZLENEN PLANLAR  •  MANUEL PRO')
m = m.replace('İzlenen coinler • MANUEL PRO ANALİZ PLANLARI', 'İZLENEN PLANLAR  •  MANUEL PRO')

# Footer wording: direct, operational, and no decorative lock emoji.
m = m.replace(
    '🔒 Plan seviyeleri ChatGPT manuel planından gelir; uygulama kendiliğinden değiştirmez.\\nKritik bildirim yalnız gerçek giriş teyidinde üretilir • otomatik emir YOK.',
    'Planlar yalnız yapıştırdığınız ChatGPT analiz kodundan gelir.\\nKritik alarm: tamamlanmış 15 dk teyidi + geçerli giriş + canlı akış • otomatik emir yok.')

# Expand the existing Turkish UI post-processor so user-facing structure text is
# understandable without English prose. Standard trading abbreviations stay intact.
needle = '                .replace("bullish", "yükseliş").replace("bearish", "düşüş")'
if needle in m and 'YÜKSELİŞ KIRICI BLOK' not in m:
    extra = '''                .replace("bullish", "yükseliş").replace("bearish", "düşüş")
                .replace("BULL BREAKER", "YÜKSELİŞ KIRICI BLOK")
                .replace("BEAR BREAKER", "DÜŞÜŞ KIRICI BLOK")
                .replace("BULL ", "YÜKSELİŞ ").replace("BEAR ", "DÜŞÜŞ ")
                .replace("TRANSITION/MIXED", "GEÇİŞ/KARIŞIK")
                .replace("RANGE/MIXED", "YATAY/KARIŞIK")
                .replace("NONE_CONFIRMED", "TEYİT YOK")
                .replace("NONE_DETECTED", "TESPİT YOK")
                .replace("ACTIVE", "AKTİF").replace("FILLED", "DOLDU")
                .replace("INVALIDATED", "GEÇERSİZ")
                .replace("MITIGATED/TOUCHED", "AZALTILDI/TEMAS EDİLDİ")
                .replace("Order Block", "Emir Bloğu")
                .replace("Breaker/Mitigation", "Kırıcı/Azaltım")
                .replace("Premium/Discount", "Prim/İskonto")
                .replace("PREMIUM", "PRİM BÖLGESİ").replace("DISCOUNT", "İSKONTO BÖLGESİ")'''
    m = m.replace(needle, extra, 1)

# Replace the button helper with a two-line professional action style.
btn = re.search(r'    private Button button\(String label, int color\) \{.*?\n    \}', m, re.S)
if not btn:
    raise SystemExit('v9.5.20 button helper missing')
new_btn = '''    private Button button(String label, int color) {
        Button b = new Button(this);
        b.setTextColor(Color.WHITE);
        b.setTextSize(12.3f);
        b.setAllCaps(false);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(10), dp(6), dp(10), dp(6));
        b.setMinHeight(0); b.setMinimumHeight(0);
        b.setMaxLines(2); b.setLineSpacing(0f, 1.06f);
        b.setBackground(v955Panel(color, Color.argb(80,255,255,255), 13));
        if (android.os.Build.VERSION.SDK_INT >= 21) {
            b.setStateListAnimator(null);
            b.setLetterSpacing(0.01f);
        }
        int nl = label == null ? -1 : label.indexOf('\\n');
        if (nl > 0 && nl < label.length() - 1) {
            android.text.SpannableString sp = new android.text.SpannableString(label);
            sp.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD),
                    0, nl, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sp.setSpan(new android.text.style.RelativeSizeSpan(0.78f),
                    nl + 1, label.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sp.setSpan(new android.text.style.ForegroundColorSpan(Color.rgb(226,232,240)),
                    nl + 1, label.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            b.setTypeface(Typeface.DEFAULT);
            b.setText(sp);
        } else {
            b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            b.setText(label);
        }
        return b;
    }'''
m = m[:btn.start()] + new_btn + m[btn.end():]

# Slightly more refined surfaces while preserving the existing layout structure.
m = m.replace('scroll.setBackgroundColor(Color.rgb(5, 10, 18));',
              'scroll.setBackgroundColor(Color.rgb(4, 9, 16));')
m = m.replace('v955Panel(Color.rgb(15, 28, 46), Color.rgb(46, 65, 92), 14)',
              'v955Panel(Color.rgb(12, 24, 40), Color.rgb(40, 63, 91), 14)')
m = m.replace('v955Panel(Color.rgb(9, 18, 31), Color.rgb(30, 58, 90), 16)',
              'v955Panel(Color.rgb(8, 17, 29), Color.rgb(27, 55, 86), 16)')

if 'V9520_MAIN_PRO_UI' not in m:
    pos = m.find('\n', m.find('public class '))
    if pos < 0: pos = 0
    m = m[:pos+1] + '    // V9520_MAIN_PRO_UI v9.5.20\n' + m[pos+1:]

MAIN.write_text(m)

# ------------------------------------------------------------------
# PROMPT: fix the remaining decision-quality ambiguity and remove English prose.
# ------------------------------------------------------------------
a = ANALYSIS.read_text()
a = a.replace('v9.5.19', 'v9.5.20')
a = re.sub(r'ChatGPT ANALİZ PAKETİ\s*[•-]?\s*v9\.5(?:\.\d+)*',
           'ChatGPT ANALİZ PAKETİ • v9.5.20', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.20', a)

# 15m confirms the trade trigger; closed HTF candles confirm higher-timeframe structure/direction.
a = a.replace(
    'Kritik giriş, breakout/breakdown ve yön teyidi yalnız TAMAMLANMIŞ 15m kapanışından gelebilir. Açık 1H/4H/1D mum kapanmadan HTF BOS/CHoCH teyidi verme.',
    'Gerçek işlem tetik teyidi yalnız TAMAMLANMIŞ 15m mum kapanışından gelebilir. TAMAMLANMIŞ 1H/4H/1D mumları üst zaman dilimi yön ve yapı teyidinde kullan. Açık 1H/4H/1D mum kapanmadan üst zaman dilimi BOS/CHoCH teyidi verme.')

# Turkish prose while retaining only standard abbreviations/code labels.
repls = {
    'TREND UP / TREND DOWN / RANGE / HIGH VOLATILITY / TRANSITION':
        'YÜKSELEN TREND / DÜŞEN TREND / YATAY / YÜKSEK OYNAKLIK / GEÇİŞ',
    'swingler': 'salınımlar',
    'bullish/bearish OB': 'yükseliş/düşüş OB',
    'breaker/mitigation': 'kırıcı/azaltım bloğu',
    'INVALIDATED/FILLED': 'GEÇERSİZ/DOLDU',
    'mark fiyat': 'işaret fiyatı',
    'taker, order book, funding': 'agresif alım/satım oranı, emir defteri, fonlama',
    'short kapanışı': 'SHORT pozisyon kapanışı',
    'long kapanışı': 'LONG pozisyon kapanışı',
    'market maker niyeti': 'piyasa yapıcı niyeti',
    'Top20 order book': 'İlk 20 emir defteri',
    'extrapole etme': 'eksik süreyi varsayımla tamamlama',
    'setup': 'senaryo',
    'premium/üst likidite': 'prim bölgesi/üst likidite',
    'discount/geri çekilme': 'iskonto bölgesi/geri çekilme',
    'breakout-retest': 'yukarı kırılım-yeniden test',
    'swing, FVG, OB': 'salınım, FVG, OB',
    'kırılım/retest': 'kırılım/yeniden test',
    'confluence': 'yapısal uyum',
    'stop-hunt': 'stop avı',
}
for old, new in repls.items():
    a = a.replace(old, new)

# Local 15m premium/discount must not overrule higher-timeframe location.
pd_anchor = ('Fibonacci yalnız son anlamlı ve görsel olarak seçilebilir impuls bacağından üretilecek. '
             'Hangi impulsun esas olduğu belirsizse FIB=NONE kullan; seviye uydurma.')
pd_rule = (pd_anchor + ' 15m prim/iskonto konumu yalnız yerel giriş zamanlamasıdır; '
           '1H/4H konumu ile çelişiyorsa tek başına işlem yönü belirlemez.')
if pd_anchor in a and '15m prim/iskonto konumu yalnız yerel giriş zamanlamasıdır' not in a:
    a = a.replace(pd_anchor, pd_rule, 1)

# Translate deterministic structure-scan prose only at presentation time. Do not
# change the engine's calculations or machine keys.
old_scan = 'sb.append(StructureEngine.analyzeAll(data)).append("\\n\\n");'
if old_scan in a and 'v9520YapiMetni' not in a:
    a = a.replace(old_scan,
                  'sb.append(v9520YapiMetni(StructureEngine.analyzeAll(data))).append("\\n\\n");', 1)

if 'private String v9520YapiMetni(String text)' not in a:
    p = a.rfind('}')
    if p < 0: raise SystemExit('v9.5.20 Analysis closing brace missing')
    helper = r'''

    private String v9520YapiMetni(String text) {
        if (text == null) return "";
        return text.replace("BULL BREAKER", "YÜKSELİŞ KIRICI BLOK")
                .replace("BEAR BREAKER", "DÜŞÜŞ KIRICI BLOK")
                .replace("BULL ", "YÜKSELİŞ ").replace("BEAR ", "DÜŞÜŞ ")
                .replace("TRANSITION/MIXED", "GEÇİŞ/KARIŞIK")
                .replace("RANGE/MIXED", "YATAY/KARIŞIK")
                .replace("NONE_CONFIRMED", "TEYİT YOK")
                .replace("NONE_DETECTED", "TESPİT YOK")
                .replace("ACTIVE", "AKTİF").replace("FILLED", "DOLDU")
                .replace("INVALIDATED", "GEÇERSİZ")
                .replace("MITIGATED/TOUCHED", "AZALTILDI/TEMAS EDİLDİ")
                .replace("Order Block", "Emir Bloğu")
                .replace("Breaker/Mitigation", "Kırıcı/Azaltım")
                .replace("Premium/Discount", "Prim/İskonto")
                .replace("PREMIUM", "PRİM BÖLGESİ").replace("DISCOUNT", "İSKONTO BÖLGESİ")
                .replace("UP ", "YUKARI ").replace("DOWN ", "AŞAĞI ")
                .replace("Stop/Likidite Av Haritası", "Stop/Likidite Av Haritası");
    }
'''
    a = a[:p] + helper + '\n' + a[p:]

if 'V9520_PROMPT_PRECISION' not in a:
    pos = a.find('\n', a.find('public class '))
    if pos < 0: pos = 0
    a = a[:pos+1] + '    // V9520_PROMPT_PRECISION v9.5.20\n' + a[pos+1:]

ANALYSIS.write_text(a)

# Build version.
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 34', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.20'", b, count=1)
BUILD.write_text(b)

# Defensive sanity checks: fail in preparation instead of producing a misleading APK.
main = MAIN.read_text(); ana = ANALYSIS.read_text(); build = BUILD.read_text()
checks = [
    ('V9520_MAIN_PRO_UI' in main and 'v9.5.20' in main, 'main version/pro UI marker'),
    ('PLAN KODU\\nYapıştır veya güncelle' in main, 'detailed plan action'),
    ('ANALİZ PAKETİ\\n4 zaman dilimi • güncel mumlar' in main, 'detailed analysis action'),
    ('android.text.style.RelativeSizeSpan' in main, 'two-line button typography'),
    ('V9520_PROMPT_PRECISION' in ana and 'v9.5.20' in ana, 'prompt version marker'),
    ('Gerçek işlem tetik teyidi yalnız TAMAMLANMIŞ 15m mum kapanışından gelebilir' in ana, '15m trigger clarification'),
    ('15m prim/iskonto konumu yalnız yerel giriş zamanlamasıdır' in ana, '15m PD weighting rule'),
    ('CVD için etikette yazan 5m/15m adına değil GERÇEK ÖRNEKLEM KAPSAMASINA bak' in ana, 'CVD coverage rule retained'),
    ('v9520YapiMetni(StructureEngine.analyzeAll(data))' in ana, 'Turkish structure presentation'),
    ('versionCode 34' in build and "versionName '9.5.20'" in build, 'build version'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok: raise SystemExit('v9.5.20 sanity failed: ' + name)

print('v9.5.20 OK: professional action UI + prompt precision + Turkish user-facing structure text.')
