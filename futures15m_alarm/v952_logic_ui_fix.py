from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
BUILD = APP / 'app/build.gradle'

if not MAIN.exists() or not BUILD.exists():
    raise SystemExit('v9.5.2: required files missing')

s = MAIN.read_text()

# ------------------------------------------------------------------
# 1) Professional META panel: make ChatGPT structure human-readable.
# ------------------------------------------------------------------
if 'String pretty = raw.replace(";", "\\n• ");' in s:
    s = s.replace('String pretty = raw.replace(";", "\\n• ");',
                  'String pretty = v952PrettyMeta(raw);', 1)
elif 'v952PrettyMeta(raw)' not in s:
    raise SystemExit('v9.5.2: META pretty anchor not found')

helper = r'''

    private String v952PrettyMeta(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "";
        StringBuilder out = new StringBuilder();
        String[] parts = raw.trim().split(";");
        for (String part : parts) {
            if (part == null) continue;
            part = part.trim();
            if (part.isEmpty()) continue;
            int eq = part.indexOf('=');
            String key = eq > 0 ? part.substring(0, eq).trim() : part;
            String value = eq > 0 ? part.substring(eq + 1).trim() : "";
            String label;
            switch (key) {
                case "ANA_KARAR": label = "ANA KARAR"; break;
                case "GUVEN": label = "GÜVEN"; break;
                case "REGIME": label = "REJİM"; break;
                case "STRUCT": label = "PİYASA YAPISI"; break;
                case "BOS": label = "BOS"; break;
                case "CHOCH": label = "CHoCH"; break;
                case "FVG": label = "FVG"; break;
                case "OB": label = "ORDER BLOCK"; break;
                case "BREAKER": label = "BREAKER / MITIGATION"; break;
                case "FIB": label = "FIBONACCI"; break;
                case "PD": label = "PREMIUM / DISCOUNT"; break;
                case "LIQ": label = "LİKİDİTE"; break;
                case "WAIT": label = "BEKLENEN TEYİT"; break;
                default: label = key.replace('_', ' '); break;
            }
            if ("FIB".equals(key) || "LIQ".equals(key)) value = value.replace(",", " • ");
            if ("WAIT".equals(key) || "ANA_KARAR".equals(key) || "REGIME".equals(key)) value = value.replace('_', ' ');
            if ("GUVEN".equals(key) && !value.contains("/")) value = value + "/100";
            if (out.length() > 0) out.append("\n• ");
            out.append(label).append(": ").append(value);
        }
        return out.toString();
    }

    private double v952NumberAfter(String text, String label) {
        try {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile(java.util.regex.Pattern.quote(label) + "\\s*([0-9]+(?:\\.[0-9]+)?)")
                    .matcher(text == null ? "" : text);
            if (m.find()) return Double.parseDouble(m.group(1));
        } catch (Throwable ignored) {}
        return Double.NaN;
    }

    private String v952PostProcessLivePanel(String text, TradePlan p) {
        if (text == null || p == null) return text;
        double now = v952NumberAfter(text, "Anlık:");
        double close15 = v952NumberAfter(text, "Son 15m kapanış:");
        if (Double.isNaN(now) || Double.isNaN(close15)) return text;

        String replacement = null;
        if (text.contains("SHORT BREAKDOWN") && close15 < p.breakdown) {
            boolean missed = now < p.breakdown * 0.9970;
            if (missed) {
                replacement = "✅ SHORT BREAKDOWN TETİKLENDİ — GİRİŞ KAÇTI • Son 15m kapanış "
                        + String.format(java.util.Locale.US, "% .8f", close15).trim()
                        + " < " + String.format(java.util.Locale.US, "% .8f", p.breakdown).trim()
                        + " • AŞAĞIDAN SHORT KOVALAMA • retest/rejection veya yeni plan bekle";
            } else {
                replacement = "✅ SHORT BREAKDOWN TETİKLENDİ • tamamlanmış 15m kapanış şartı sağlandı • giriş bölgesi/retest teyidini izle";
            }
        } else if (text.contains("LONG BREAKOUT") && close15 > p.breakout) {
            boolean missed = now > p.breakout * 1.0030;
            if (missed) {
                replacement = "✅ LONG BREAKOUT TETİKLENDİ — GİRİŞ KAÇTI • Son 15m kapanış "
                        + String.format(java.util.Locale.US, "% .8f", close15).trim()
                        + " > " + String.format(java.util.Locale.US, "% .8f", p.breakout).trim()
                        + " • YUKARIDAN LONG KOVALAMA • retest/reclaim veya yeni plan bekle";
            } else {
                replacement = "✅ LONG BREAKOUT TETİKLENDİ • tamamlanmış 15m kapanış şartı sağlandı • giriş bölgesi/retest teyidini izle";
            }
        }

        if (replacement == null) return text;
        return text.replaceFirst("(?m)^.*SİNYAL İÇİN BEKLENEN:.*$",
                java.util.regex.Matcher.quoteReplacement("🎯 DURUM: " + replacement));
    }
'''

if 'private String v952PrettyMeta(' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.2: MainActivity closing brace not found')
    s = s[:pos] + helper + '\n' + s[pos:]

# ------------------------------------------------------------------
# 2) Live confirmation panel: if a completed candle already crossed the
#    breakout/breakdown level, do not keep saying "waiting for close".
#    Wrap the String-returning method that contains CANLI TEYİT PANELİ.
# ------------------------------------------------------------------
if 'v952PostProcessLivePanel(' not in s.replace('private String v952PostProcessLivePanel', ''):
    anchor_pos = s.find('CANLI TEYİT PANELİ')
    if anchor_pos < 0:
        raise SystemExit('v9.5.2: live panel anchor not found')

    # Locate the nearest method declaration above the anchor.
    declarations = list(re.finditer(r'(?m)^\s*private\s+String\s+(\w+)\s*\(([^)]*)\)\s*\{', s[:anchor_pos]))
    if not declarations:
        raise SystemExit('v9.5.2: String live-panel method not found')
    dm = declarations[-1]
    method_start = dm.start()
    signature_end = dm.end()
    params = dm.group(2)
    pm = re.search(r'TradePlan\s+(\w+)', params)
    if not pm:
        raise SystemExit('v9.5.2: TradePlan parameter not found in live-panel method')
    pvar = pm.group(1)

    # Find the Java method's closing brace with a lightweight brace scanner.
    depth = 1
    i = signature_end
    in_str = False
    esc = False
    while i < len(s) and depth > 0:
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
        i += 1
    if depth != 0:
        raise SystemExit('v9.5.2: live-panel method boundary not found')
    method_end = i
    method = s[method_start:method_end]

    # Wrap return expressions, but not returns already using our helper.
    def wrap_return(m):
        expr = m.group(1).strip()
        if 'v952PostProcessLivePanel' in expr:
            return m.group(0)
        return 'return v952PostProcessLivePanel(' + expr + ', ' + pvar + ');'

    method2, count = re.subn(r'return\s+([^;]+);', wrap_return, method)
    if count < 1:
        raise SystemExit('v9.5.2: no return expression found in live-panel method')
    s = s[:method_start] + method2 + s[method_end:]

s = s.replace('15m Futures Alarm PRO v9.5.1', '15m Futures Alarm PRO v9.5.2')
MAIN.write_text(s)

# ------------------------------------------------------------------
# 3) Version bump.
# ------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+15\b', 'versionCode 16', b)
b = re.sub(r"versionName\s+'9\.5\.1'", "versionName '9.5.2'", b)
if 'versionCode 16' not in b:
    b = re.sub(r'versionCode\s+\d+', 'versionCode 16', b, count=1)
if "versionName '9.5.2'" not in b:
    b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.2'", b, count=1)
BUILD.write_text(b)

final = MAIN.read_text()
checks = [
    ('15m Futures Alarm PRO v9.5.2' in final, 'title missing'),
    ('v952PrettyMeta(raw)' in final, 'META formatter not wired'),
    ('ANA KARAR' in final and 'BEKLENEN TEYİT' in final, 'Turkish META labels missing'),
    ('v952PostProcessLivePanel' in final, 'live-panel post processor missing'),
    ('GİRİŞ KAÇTI' in final, 'missed-entry state missing'),
    ('AŞAĞIDAN SHORT KOVALAMA' in final, 'short chase protection missing'),
    ('YUKARIDAN LONG KOVALAMA' in final, 'long chase protection missing'),
    ('versionCode 16' in BUILD.read_text(), 'versionCode 16 missing'),
    ("versionName '9.5.2'" in BUILD.read_text(), 'versionName 9.5.2 missing'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.2 check failed: ' + msg)

print('v9.5.2 OK: confirmed trigger vs missed-entry state + readable professional META panel.')
