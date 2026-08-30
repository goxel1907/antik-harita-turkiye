from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MONITOR = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MONITOR, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'Missing v9.5 input: {p}')

# ------------------------------------------------------------------
# Main screen: silent approach tracking + professional structure META.
# ------------------------------------------------------------------
s = MAIN.read_text()
s = s.replace('15m Futures Alarm PRO v9.4', '15m Futures Alarm PRO v9.5')
s = s.replace('15m Futures Alarm PRO v9.3', '15m Futures Alarm PRO v9.5')
s = s.replace('TEST ÖN UYARI', 'SESSİZ TAKİP • BİLDİRİM YOK')
s = s.replace('Ön uyarı: hedef seviyeye yaklaşık %', 'Sessiz takip eşiği: hedef seviyeye yaklaşık %')
s = s.replace('ÖN UYARI •', 'SESSİZ TAKİP •')

# Extend only the bulk-import method. Existing 13-field plans stay valid;
# a 14th META field stores ChatGPT's structural context for the coin card.
imp_start = s.find('    private void openImportDialog() {')
if imp_start < 0:
    raise SystemExit('v9.5: openImportDialog not found')
next_method = re.search(r'\n    private [^\n]+\(', s[imp_start + 10:])
if not next_method:
    raise SystemExit('v9.5: could not find method after openImportDialog')
imp_end = imp_start + 10 + next_method.start()
imp = s[imp_start:imp_end]

imp, n_len = re.subn(r'if\s*\(a\.length\s*!=\s*13\)',
                     'if (a.length != 13 && a.length != 14)', imp, count=1)
if n_len != 1:
    raise SystemExit('v9.5: 13-field parser condition not found')

imp = imp.replace('Sadece 13 alanlı | işaretli plan kodları kabul edilir.',
                  '13 alanlı plan kodu veya profesyonel yapı için 14. META alanı kabul edilir.')
imp = imp.replace('13 alanlı detaylı plan kodu gerekli',
                  '13 veya 14 alanlı detaylı plan kodu gerekli')
imp = imp.replace('13 alanlı | işaretli kod satırını aynen yapıştır.',
                  '13/14 alanlı | işaretli kod satırını aynen yapıştır.')
imp = imp.replace('13 alanlı | işaretli', '13/14 alanlı | işaretli')

meta_store = '''                        String v95Meta = a.length >= 14 ? a[13].trim() : "";
                        if (v95Meta.isEmpty()) {
                            getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                                    .edit().remove("v95_meta_" + sym).apply();
                        } else {
                            getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                                    .edit().putString("v95_meta_" + sym, v95Meta).apply();
                        }
'''
imp, n_success = re.subn(r'(?m)^(\s*)success\+\+;',
                         lambda m: meta_store + m.group(0), imp, count=1)
if n_success != 1:
    raise SystemExit('v9.5: import success marker not found')

s = s[:imp_start] + imp + s[imp_end:]

helper = r'''

    private String v95MetaText(String symbol) {
        String raw = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                .getString("v95_meta_" + symbol, "");
        if (raw == null) return "";
        raw = raw.trim();
        if (raw.startsWith("META=")) raw = raw.substring(5).trim();
        return raw;
    }

    private void v95AddMetaPanel(LinearLayout card, String symbol) {
        String raw = v95MetaText(symbol);
        String body;
        int fg;
        if (raw.isEmpty()) {
            body = "🧠 PROFESYONEL YAPI\n"
                    + "Yeni ANALİZ PAKETİ gönderip 14 alanlı planı yapıştırınca "
                    + "rejim, HH/HL-LH/LL, BOS/CHoCH, FVG, order block, Fibonacci, "
                    + "premium/discount ve likidite bölgeleri burada görünür.";
            fg = Color.rgb(251, 191, 36);
        } else {
            String pretty = raw.replace(";", "\n• ");
            body = "🧠 PROFESYONEL YAPI\n• " + pretty
                    + "\n\n🔕 Yaklaşma bildirimi YOK • alarm yalnız gerçek giriş teyidinde";
            fg = Color.rgb(226, 232, 240);
        }
        TextView meta = text(body, 13, fg, false);
        meta.setLineSpacing(0, 1.12f);
        meta.setPadding(dp(10), dp(9), dp(10), dp(9));
        meta.setBackgroundColor(Color.rgb(30, 41, 59));
        LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mlp.setMargins(0, dp(8), 0, dp(5));
        card.addView(meta, mlp);
    }
'''

if 'private void v95AddMetaPanel' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5: MainActivity closing brace not found')
    s = s[:pos] + helper + '\n' + s[pos:]

# Put professional structure immediately below the symbol title when possible.
if 'v95AddMetaPanel(card, p.symbol);' not in s:
    pc_start = s.find('    private View planCard(TradePlan p)')
    pc_end = s.find('    private ', pc_start + 20) if pc_start >= 0 else -1
    if pc_start < 0 or pc_end < 0:
        raise SystemExit('v9.5: planCard not found')
    pc = s[pc_start:pc_end]
    m_title = re.search(r'(?m)^(\s*)card\.addView\(symbolTitle\);\s*$', pc)
    if m_title:
        insert_at = m_title.end()
        pc = pc[:insert_at] + '\n        v95AddMetaPanel(card, p.symbol);' + pc[insert_at:]
    else:
        # Fallback: insert after the card click listener.
        m_click = re.search(r'(?m)^(\s*)card\.setOnClickListener\([^\n]+\);\s*$', pc)
        if not m_click:
            raise SystemExit('v9.5: no safe insertion point in planCard')
        insert_at = m_click.end()
        pc = pc[:insert_at] + '\n        v95AddMetaPanel(card, p.symbol);' + pc[insert_at:]
    s = s[:pc_start] + pc + s[pc_end:]

# Keep the legacy Master-prompt button self-contained too, in case it is used.
legacy_rule = 'Fake breakout, liquidity sweep, wick/rejection, retest ve trend karşıtı işlem riskini kontrol et.'
legacy_extra = (' Fake breakout, liquidity sweep, wick/rejection, retest ve trend karşıtı işlem riskini kontrol et. '
                'Ayrıca BOS/CHoCH, FVG, bullish/bearish order block, breaker/mitigation block, son anlamlı impuls bacağı, '
                'Fibonacci 0.382/0.5/0.618/0.705/0.786, premium/discount ve buy-side/sell-side likidite havuzlarını kontrol et; '
                'grafikte net değilse NONE yaz, uydurma.')
if legacy_rule in s:
    s = s.replace(legacy_rule, legacy_extra)
s = s.replace('SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB',
              'SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB|META')

MAIN.write_text(s)

# ------------------------------------------------------------------
# Monitor service: approaches remain visible on-screen but never alert.
# Only sendUrgent() is allowed to create a trading alert notification.
# ------------------------------------------------------------------
m = MONITOR.read_text()
m = m.replace('15m Futures Alarm PRO v9.4', '15m Futures Alarm PRO v9.5')
m = m.replace('15m Futures Alarm PRO v9.3', '15m Futures Alarm PRO v9.5')

sa = m.find('    private void sendApproach(')
su = m.find('    private void sendUrgent(', sa + 1)
if sa < 0 or su < 0 or su <= sa:
    raise SystemExit('v9.5: sendApproach/sendUrgent boundary not found')
no_approach = '''    private void sendApproach(String symbol, String title, String detail) {
        // v9.5: yaklaşma/ön uyarı sessizdir. Bilgi coin kartında canlı izlenir.
        // Telefon bildirimi yalnız sendUrgent() ile gerçek giriş teyidinde gönderilir.
    }

'''
m = m[:sa] + no_approach + m[su:]

sta = m.find('    public static void sendTestApproach(')
stu = m.find('    public static void sendTestUrgent(', sta + 1)
if sta >= 0 and stu > sta:
    no_test = '''    public static void sendTestApproach(Context context) {
        android.widget.Toast.makeText(context,
                "Ön uyarı bildirimleri kapalı. Yaklaşmalar coin kartında sessiz izlenir.",
                android.widget.Toast.LENGTH_LONG).show();
    }

'''
    m = m[:sta] + no_test + m[stu:]
else:
    raise SystemExit('v9.5: sendTestApproach boundary not found')

# Label old approach channel clearly; keeping it is harmless and avoids migration issues.
m = m.replace('Ön uyarı: yüksek kalite setup yaklaşıyor', 'Sessiz yaklaşma takibi (bildirim kullanılmıyor)')
MONITOR.write_text(m)

# ------------------------------------------------------------------
# Analysis package prompt: institutional structure + optional META field.
# ------------------------------------------------------------------
a = ANALYSIS.read_text()
a = a.replace('Futures15mAlarmPRO/9.4', 'Futures15mAlarmPRO/9.5')
a = a.replace('15m Futures Alarm PRO v9.4', '15m Futures Alarm PRO v9.5')

base_rule = ('Fake breakout, liquidity sweep, wick/rejection, retest ve trend karşıtı işlem riskini kontrol et.')
pro_rule = (base_rule + ' Ayrıca her zaman diliminde BOS/CHoCH, Fair Value Gap (FVG), bullish/bearish order block, '
            'breaker/mitigation block, equal highs/lows ve buy-side/sell-side likidite havuzlarını kontrol et. '
            'Son anlamlı impuls bacağını seçip Fibonacci 0.382 / 0.5 / 0.618 / 0.705 / 0.786 seviyelerini ve '
            'fiyatın premium/discount konumunu değerlendir. Bu yapılar grafikte objektif olarak seçilemiyorsa NONE yaz; '
            'FVG/OB/Fibonacci seviyesi uydurma.')
if base_rule not in a:
    raise SystemExit('v9.5: base analysis rule not found')
a = a.replace(base_rule, pro_rule, 1)

old_fmt = 'SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB\\n'
new_fmt = 'SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB|META\\n'
if old_fmt not in a:
    raise SystemExit('v9.5: analysis code format string not found')
a = a.replace(old_fmt, new_fmt, 1)

meta_instr = ('        sb.append("META=ANA_KARAR:<LONG/SHORT/ISLEM_YOK>;GUVEN:<0-100>;REGIME:<rejim>;STRUCT:<HH-HL/LH-LL/RANGE>;BOS:<seviye/NONE>;CHOCH:<seviye/NONE>;FVG:<bolge/NONE>;OB:<bolge/NONE>;BREAKER:<bolge/NONE>;FIB:<0.382=...,0.5=...,0.618=...,0.705=...,0.786=.../NONE>;PD:<PREMIUM/DISCOUNT/EQ>;LIQ:<BSL/SSL seviyeleri>;WAIT:<giris icin eksik teyit>\\n\\n");\n'
            '        sb.append("META alanında | karakteri KULLANMA; yalnız ; ve = kullan. Yeni sohbet olsa bile yalnız bu paket ve ekli grafiklerdeki verileri kullan; eksik veriyi varmış gibi yazma.\\n\\n");\n')
anchor = '        sb.append("SB=girisAlt;girisUst;stop;tp1;tp2;tp3\\n\\n");\n'
if anchor not in a:
    raise SystemExit('v9.5: SB format anchor not found')
a = a.replace(anchor, anchor + meta_instr, 1)

# Clarify that the final code line has 14 fields when META is available.
a = a.replace('TEK SATIR plan kodu üret ve kod dışında o satıra açıklama ekleme.',
              'TEK SATIR 14 ALANLI plan kodu üret ve kod dışında o satıra açıklama ekleme.', 1)
ANALYSIS.write_text(a)

# ------------------------------------------------------------------
# Version bump.
# ------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+13\b', 'versionCode 14', b)
b = re.sub(r"versionName\s+'9\.4\.0'", "versionName '9.5.0'", b)
if 'versionCode 14' not in b:
    b = re.sub(r'versionCode\s+\d+', 'versionCode 14', b, count=1)
if "versionName '9.5.0'" not in b:
    b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.0'", b, count=1)
BUILD.write_text(b)

# Final guards: fail the build early if any requested behavior is missing.
main_final = MAIN.read_text()
mon_final = MONITOR.read_text()
ana_final = ANALYSIS.read_text()
checks = [
    ('15m Futures Alarm PRO v9.5' in main_final, 'v9.5 title missing'),
    ('a.length != 13 && a.length != 14' in main_final, '14-field META parser missing'),
    ('PROFESYONEL YAPI' in main_final, 'professional structure panel missing'),
    ('v95_meta_' in main_final, 'META persistence missing'),
    ('yaklaşma/ön uyarı sessizdir' in mon_final, 'silent approach marker missing'),
    ('private void sendUrgent' in mon_final, 'urgent entry alarm missing'),
    ('Fair Value Gap (FVG)' in ana_final, 'FVG prompt rule missing'),
    ('breaker/mitigation block' in ana_final, 'breaker prompt rule missing'),
    ('Fibonacci 0.382 / 0.5 / 0.618 / 0.705 / 0.786' in ana_final, 'Fibonacci prompt rule missing'),
    ('META=ANA_KARAR' in ana_final, 'META output instruction missing'),
    ('versionCode 14' in BUILD.read_text(), 'versionCode 14 missing'),
    ("versionName '9.5.0'" in BUILD.read_text(), 'versionName 9.5.0 missing'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5 check failed: ' + msg)

print('v9.5 patch OK: professional structure on screen; approach alerts silent; only confirmed entry uses urgent notification.')
