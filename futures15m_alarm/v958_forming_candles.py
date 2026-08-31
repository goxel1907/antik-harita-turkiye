from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MAIN = JAVA / 'MainActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (ANALYSIS, MAIN, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.8 missing: ' + str(p))

s = ANALYSIS.read_text()

# ------------------------------------------------------------------
# v9.5.8: keep the 100 CLOSED candles for structure/confirmation, but ALSO
# fetch and render the currently forming candle for 15m/1h/4h/1D.
# The forming candle is context only and must never count as a breakout close.
# ------------------------------------------------------------------

old = '''                Map<String, List<Candle>> candles = new LinkedHashMap<>();
                for (String interval : INTERVALS) {
                    candles.put(interval, fetchCompletedCandles(symbol, interval, now));
                }
                List<Candle> m15 = candles.get("15m");'''
new = '''                Map<String, List<Candle>> candles = new LinkedHashMap<>();
                Map<String, Candle> forming = new LinkedHashMap<>();
                for (String interval : INTERVALS) {
                    candles.put(interval, fetchCompletedCandles(symbol, interval, now));
                    forming.put(interval, fetchFormingCandle(symbol, interval, now));
                }
                List<Candle> m15 = candles.get("15m");'''
if old not in s:
    raise SystemExit('v9.5.8 buildPack map anchor missing')
s = s.replace(old, new, 1)

s = s.replace('Bitmap image = renderPack(symbol, candles, metrics, now);',
              'Bitmap image = renderPack(symbol, candles, forming, metrics, now);', 1)
s = s.replace('String prompt = buildPrompt(symbol, candles, metrics, now);',
              'String prompt = buildPrompt(symbol, candles, forming, metrics, now);', 1)
s = s.replace('status.setText("✅ Paket hazır: 15m / 1h / 4h / 1D • 100 tamamlanmış mum + canlı piyasa verileri\\nCHATGPT\'YE GÖNDER\'e bas.");',
              'status.setText("✅ Paket hazır: 15m / 1h / 4h / 1D • 100 tamamlanmış mum + her periyodun AÇIK/ANLIK mumu + canlı piyasa verileri\\nCHATGPT\'YE GÖNDER\'e bas.");', 1)

fetch_anchor = '''    private Metrics fetchMetrics(String symbol, List<Candle> m15, long now) {'''
if fetch_anchor not in s:
    raise SystemExit('v9.5.8 fetchMetrics anchor missing')
forming_fetch = r'''
    private Candle fetchFormingCandle(String symbol, String interval, long now) throws Exception {
        String q = BASE + "/fapi/v1/klines?symbol=" + enc(symbol) + "&interval=" + enc(interval) + "&limit=2";
        JSONArray arr = new JSONArray(get(q));
        if (arr.length() == 0) return null;
        JSONArray a = arr.getJSONArray(arr.length() - 1);
        long closeTime = a.getLong(6);
        // If Binance returned only a fully closed last candle, do not pretend it is live.
        if (closeTime < now - 500L) return null;
        Candle c = new Candle();
        c.openTime = a.getLong(0);
        c.open = d(a.getString(1));
        c.high = d(a.getString(2));
        c.low = d(a.getString(3));
        c.close = d(a.getString(4));
        c.volume = d(a.getString(5));
        c.closeTime = closeTime;
        c.takerBuyVolume = a.length() > 9 ? d(a.getString(9)) : 0;
        return c;
    }

'''
s = s.replace(fetch_anchor, forming_fetch + fetch_anchor, 1)

s = s.replace('private Bitmap renderPack(String symbol, Map<String, List<Candle>> data, Metrics m, long now) {',
              'private Bitmap renderPack(String symbol, Map<String, List<Candle>> data, Map<String, Candle> forming, Metrics m, long now) {', 1)
s = s.replace('c.drawText("100 tamamlanmış mum • Binance Futures public veri • " + fmtTime(now), 55, 120, p);',
              'c.drawText("100 tamamlanmış + AÇIK/ANLIK mum • Binance Futures public veri • " + fmtTime(now), 55, 120, p);', 1)
s = s.replace('drawPanel(c, data.get(interval), symbol + " • " + interval.toUpperCase(Locale.US), 40, y, W - 80, PANEL - 18);',
              'drawPanel(c, data.get(interval), forming.get(interval), symbol + " • " + interval.toUpperCase(Locale.US), 40, y, W - 80, PANEL - 18, now);', 1)
s = s.replace('c.drawText("Not: Görsel fiyat yapısı içindir; OI/CVD/funding/orderbook sayısal olarak paylaşım metnine eklenmiştir.", 55, H - 45, p);',
              'c.drawText("Not: Sağdaki mavi çerçeveli mum AÇIK/ANLIKTIR; teyit değildir. OI/CVD/funding/orderbook metinde paylaşılır.", 55, H - 45, p);', 1)

s = s.replace('private void drawPanel(Canvas c, List<Candle> list, String title, int x, int y, int w, int h) {',
              'private void drawPanel(Canvas c, List<Candle> list, Candle current, String title, int x, int y, int w, int h, long now) {', 1)

old = '''        double min = Double.MAX_VALUE, max = -Double.MAX_VALUE, maxVol = 0;
        for (Candle k : list) {
            min = Math.min(min, k.low);
            max = Math.max(max, k.high);
            maxVol = Math.max(maxVol, k.volume);
        }
        double range = Math.max(1e-12, max - min);
        int left = x + 25, right = x + w - 25;
        int chartTop = y + 75, chartBottom = y + 390;
        int volTop = y + 405, volBottom = y + 485;
        int rsiTop = y + 505, rsiBottom = y + h - 25;'''
new = '''        List<Candle> visual = new ArrayList<>(list);
        if (current != null) visual.add(current);

        double min = Double.MAX_VALUE, max = -Double.MAX_VALUE, maxVol = 0;
        for (Candle k : visual) {
            min = Math.min(min, k.low);
            max = Math.max(max, k.high);
            maxVol = Math.max(maxVol, k.volume);
        }
        double range = Math.max(1e-12, max - min);
        int left = x + 25, right = x + w - 25;

        if (current != null) {
            p.setTypeface(Typeface.DEFAULT);
            p.setTextSize(22);
            p.setColor(Color.rgb(56, 189, 248));
            double ch = current.open == 0 ? 0 : (current.close / current.open - 1.0) * 100.0;
            c.drawText("AÇIK MUM  O " + price(current.open) + "  H " + price(current.high)
                    + "  L " + price(current.low) + "  C " + price(current.close)
                    + "  Δ " + String.format(Locale.US, "%+.2f%%", ch)
                    + "  •  kalan " + remaining(current.closeTime, now), x + 22, y + 78, p);
        }

        int chartTop = y + 96, chartBottom = y + 390;
        int volTop = y + 405, volBottom = y + 485;
        int rsiTop = y + 505, rsiBottom = y + h - 25;'''
if old not in s:
    raise SystemExit('v9.5.8 drawPanel range anchor missing')
s = s.replace(old, new, 1)

s = s.replace('int n = list.size();\n        float step = (right - left) / (float) n;',
              'int n = visual.size();\n        float step = (right - left) / (float) n;', 1)
s = s.replace('Candle k = list.get(i);', 'Candle k = visual.get(i);', 1)

old = '''            c.drawRect(cx - bodyW / 2, top, cx + bodyW / 2, bot, p);
            if (maxVol > 0) {'''
new = '''            c.drawRect(cx - bodyW / 2, top, cx + bodyW / 2, bot, p);
            boolean formingBar = current != null && i == n - 1;
            if (formingBar) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(4.2f);
                p.setColor(Color.rgb(56, 189, 248));
                c.drawRect(cx - bodyW / 2 - 2, top - 2, cx + bodyW / 2 + 2, bot + 2, p);
                p.setStyle(Paint.Style.FILL);
            }
            if (maxVol > 0) {'''
if old not in s:
    raise SystemExit('v9.5.8 forming outline anchor missing')
s = s.replace(old, new, 1)

s = s.replace('Candle last = list.get(list.size() - 1);\n        p.setColor(Color.rgb(60, 220, 150));\n        c.drawText("C " + price(last.close), left + 8, chartTop + 26, p);',
              'Candle last = list.get(list.size() - 1);\n        p.setColor(Color.rgb(60, 220, 150));\n        c.drawText("KAPANIŞ C " + price(last.close), left + 8, chartTop + 26, p);', 1)
s = s.replace('double[] rsi = rsi(list, 14);', 'double[] rsi = rsi(visual, 14);', 1)
s = s.replace('c.drawText("RSI14 " + (Double.isNaN(lastRsi) ? "--" : String.format(Locale.US, "%.1f", lastRsi)), left, rsiTop + 22, p);',
              'c.drawText((current == null ? "RSI14 " : "RSI14 ANLIK ") + (Double.isNaN(lastRsi) ? "--" : String.format(Locale.US, "%.1f", lastRsi)), left, rsiTop + 22, p);', 1)

helper_anchor = '''    private float mapPrice(double price, double min, double range, int top, int bottom) {'''
if helper_anchor not in s:
    raise SystemExit('v9.5.8 mapPrice anchor missing')
helper = r'''
    private String remaining(long closeTime, long now) {
        long sec = Math.max(0L, (closeTime - now + 999L) / 1000L);
        long h = sec / 3600L;
        long m = (sec % 3600L) / 60L;
        long ss = sec % 60L;
        if (h > 0) return String.format(Locale.US, "%02d:%02d:%02d", h, m, ss);
        return String.format(Locale.US, "%02d:%02d", m, ss);
    }

    private String formingLine(String interval, Candle c, long now) {
        if (c == null) return interval + " AÇIK/ANLIK mum: veri yok";
        double ch = c.open == 0 ? 0 : (c.close / c.open - 1.0) * 100.0;
        return interval + " AÇIK/ANLIK mum: O=" + price(c.open)
                + " H=" + price(c.high) + " L=" + price(c.low) + " C=" + price(c.close)
                + " Δ=" + String.format(Locale.US, "%+.2f%%", ch)
                + " kapanışa~" + remaining(c.closeTime, now);
    }

'''
s = s.replace(helper_anchor, helper + helper_anchor, 1)

s = s.replace('private String buildPrompt(String symbol, Map<String, List<Candle>> data, Metrics m, long now) {',
              'private String buildPrompt(String symbol, Map<String, List<Candle>> data, Map<String, Candle> forming, Metrics m, long now) {', 1)

# Strong rule in the master prompt: forming 1h/4h/1D candles are valuable context,
# but only a FINISHED 15m candle can confirm the app trigger.
prompt_anchor = 'sb.append("Plan seviyelerini mevcut grafiklerdeki yapıya göre üret. Fiyat çoktan bir seviyeyi geçtiyse geçmişte kalmış girişi yeni sinyal gibi verme.\\n\\n");'
if prompt_anchor not in s:
    raise SystemExit('v9.5.8 prompt plan anchor missing')
addition = prompt_anchor + '''\n        sb.append("Görselde her zaman diliminde sağdaki mavi çerçeveli mum AÇIK/ANLIK (henüz tamamlanmamış) mumdur. 15m/1h/4h/1D açık mumlarını güncel momentum, wick/rejection, intra-bar liquidity sweep ve hızlanma/yavaşlama bağlamı için MUTLAKA değerlendir; fakat bunları kapanmış mum gibi kabul etme. Breakout/breakdown ve kritik giriş teyidi yalnız TAMAMLANMIŞ 15m kapanışından gelebilir. 1h/4h/1D açık mum kapanmadan HTF BOS/CHoCH teyidi verme; yalnız olası gelişim olarak belirt.\\n\\n");'''
s = s.replace(prompt_anchor, addition, 1)

old = '''        sb.append("Ekli tek görsel: 15m / 1h / 4h / 1D, her panelde son ");
        sb.append(data.get("15m") == null ? 0 : data.get("15m").size()).append("'e kadar TAMAMLANMIŞ mum + hacim + RSI14.\\n");
        sb.append("Anlık fiyat: ").append(price(m.lastPrice)).append("\\n");'''
new = '''        sb.append("Ekli tek görsel: 15m / 1h / 4h / 1D, her panelde son ");
        sb.append(data.get("15m") == null ? 0 : data.get("15m").size()).append("'e kadar TAMAMLANMIŞ mum + hacim + RSI14; ayrıca en sağda mavi çerçeveli AÇIK/ANLIK mum.\\n");
        sb.append(formingLine("15m", forming.get("15m"), now)).append("\\n");
        sb.append(formingLine("1h", forming.get("1h"), now)).append("\\n");
        sb.append(formingLine("4h", forming.get("4h"), now)).append("\\n");
        sb.append(formingLine("1D", forming.get("1d"), now)).append("\\n");
        sb.append("Anlık fiyat: ").append(price(m.lastPrice)).append("\\n");'''
if old not in s:
    raise SystemExit('v9.5.8 prompt visual anchor missing')
s = s.replace(old, new, 1)

s = s.replace('ChatGPT ANALİZ PAKETİ • v9.5.6', 'ChatGPT ANALİZ PAKETİ • v9.5.8')
s = s.replace('Futures15mAlarmPRO/9.4', 'Futures15mAlarmPRO/9.5.8')
ANALYSIS.write_text(s)

# Main title + version bump.
m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.8', m)
m = m.replace('v9.5.7  •  MANUEL PRO', 'v9.5.8  •  MANUEL PRO')
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 22', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.8'", b, count=1)
BUILD.write_text(b)

# Build-time safety checks.
a = ANALYSIS.read_text(); mf = MAIN.read_text(); bf = BUILD.read_text()
checks = [
    ('Map<String, Candle> forming' in a, 'forming map'),
    ('fetchFormingCandle' in a and '&limit=2' in a, 'forming Binance fetch'),
    ('AÇIK MUM  O ' in a, 'forming OHLC overlay'),
    ('formingBar' in a and 'Color.rgb(56, 189, 248)' in a, 'cyan forming outline'),
    ('RSI14 ANLIK' in a, 'live RSI label'),
    ('formingLine("15m"' in a and 'formingLine("4h"' in a, 'prompt forming rows'),
    ('kritik giriş teyidi yalnız TAMAMLANMIŞ 15m kapanışından' in a, 'closed-15m confirmation guard'),
    ('1h/4h/1D açık mum kapanmadan HTF BOS/CHoCH teyidi verme' in a, 'HTF forming guard'),
    ('v9.5.8' in mf, 'main version'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.8' in a, 'analysis version'),
    ('versionCode 22' in bf and "versionName '9.5.8'" in bf, 'build version'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.8 check failed: ' + msg)

print('v9.5.8 OK: 100 closed candles retained + forming 15m/1h/4h/1D candle rendered and shared as context; only closed 15m can confirm a trade.')
