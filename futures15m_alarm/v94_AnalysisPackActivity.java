package com.futuresalarm.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.provider.MediaStore;
import android.content.ContentValues;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AnalysisPackActivity extends Activity {
    private static final String BASE = "https://fapi.binance.com";
    private static final String[] INTERVALS = {"15m", "1h", "4h", "1d"};

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private EditText symbolInput;
    private TextView status;
    private ImageView preview;
    private Button shareButton;
    private Uri imageUri;
    private String shareText;
    private Bitmap packBitmap;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(Color.rgb(8, 13, 22));
            getWindow().setNavigationBarColor(Color.rgb(8, 13, 22));
        }

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 13, 22));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(22), dp(18), dp(32));
        scroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text("📊 ChatGPT ANALİZ PAKETİ • v9.4", 27, Color.WHITE, true);
        root.addView(title);
        TextView info = text("Coin adını yaz. Uygulama Binance Futures public verisinden 15m / 1h / 4h / 1D son 100 TAMAMLANMIŞ mumu çeker; tek görsel + MASTER prompt + canlı teyit verilerini hazırlar.", 16, Color.rgb(178, 190, 210), false);
        info.setPadding(0, dp(8), 0, dp(14));
        root.addView(info);

        symbolInput = new EditText(this);
        symbolInput.setHint("Örn: UAI veya UAIUSDT");
        symbolInput.setHintTextColor(Color.rgb(125, 138, 160));
        symbolInput.setTextColor(Color.WHITE);
        symbolInput.setTextSize(20);
        symbolInput.setSingleLine(true);
        symbolInput.setPadding(dp(14), dp(12), dp(14), dp(12));
        symbolInput.setBackgroundColor(Color.rgb(18, 29, 48));
        root.addView(symbolInput, lp(-1, dp(58), 0, 0, 0, 12));

        Button build = button("ANALİZ PAKETİNİ HAZIRLA", Color.rgb(0, 160, 190));
        root.addView(build, lp(-1, dp(62), 0, 0, 0, 10));
        build.setOnClickListener(v -> buildPack());

        status = text("Hazır. Coin adını gir.", 15, Color.rgb(255, 193, 7), true);
        status.setPadding(dp(4), dp(8), dp(4), dp(12));
        root.addView(status);

        preview = new ImageView(this);
        preview.setAdjustViewBounds(true);
        preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        preview.setBackgroundColor(Color.rgb(12, 20, 34));
        root.addView(preview, lp(-1, -2, 0, 0, 0, 12));

        shareButton = button("CHATGPT'YE GÖNDER", Color.rgb(111, 34, 226));
        shareButton.setEnabled(false);
        shareButton.setAlpha(0.45f);
        root.addView(shareButton, lp(-1, dp(64), 0, 0, 0, 10));
        shareButton.setOnClickListener(v -> sharePack());

        Button close = button("GERİ", Color.rgb(70, 84, 105));
        root.addView(close, lp(-1, dp(56), 0, 0, 0, 0));
        close.setOnClickListener(v -> finish());

        setContentView(scroll);
    }

    private void buildPack() {
        String symbol = normalizeSymbol(symbolInput.getText().toString());
        if (symbol.length() < 5) {
            Toast.makeText(this, "Coin adını yaz.", Toast.LENGTH_SHORT).show();
            return;
        }
        shareButton.setEnabled(false);
        shareButton.setAlpha(0.45f);
        status.setText("⏳ " + symbol + " verileri alınıyor... 4 zaman dilimi + canlı teyitler");
        preview.setImageDrawable(null);
        imageUri = null;
        shareText = null;

        io.execute(() -> {
            try {
                long now = System.currentTimeMillis();
                Map<String, List<Candle>> candles = new LinkedHashMap<>();
                for (String interval : INTERVALS) {
                    candles.put(interval, fetchCompletedCandles(symbol, interval, now));
                }
                List<Candle> m15 = candles.get("15m");
                if (m15 == null || m15.size() < 20) throw new Exception("Yeterli 15m mum verisi yok.");
                Metrics metrics = fetchMetrics(symbol, m15, now);
                Bitmap image = renderPack(symbol, candles, metrics, now);
                Uri uri = saveImage(symbol, image);
                String prompt = buildPrompt(symbol, candles, metrics, now);

                packBitmap = image;
                imageUri = uri;
                shareText = prompt;
                runOnUiThread(() -> {
                    preview.setImageBitmap(packBitmap);
                    status.setText("✅ Paket hazır: 15m / 1h / 4h / 1D • 100 tamamlanmış mum + canlı piyasa verileri\nCHATGPT'YE GÖNDER'e bas.");
                    shareButton.setEnabled(true);
                    shareButton.setAlpha(1f);
                });
            } catch (Exception e) {
                final String msg = e.getMessage() == null ? e.toString() : e.getMessage();
                runOnUiThread(() -> status.setText("❌ Paket hazırlanamadı: " + msg));
            }
        });
    }

    private String normalizeSymbol(String raw) {
        String s = raw == null ? "" : raw.toUpperCase(Locale.US).trim();
        s = s.replace("/", "").replace("-", "").replace(" ", "").replace("PERP", "");
        if (!s.endsWith("USDT") && s.length() > 0) s += "USDT";
        return s;
    }

    private List<Candle> fetchCompletedCandles(String symbol, String interval, long now) throws Exception {
        String q = BASE + "/fapi/v1/klines?symbol=" + enc(symbol) + "&interval=" + enc(interval) + "&limit=101";
        JSONArray arr = new JSONArray(get(q));
        List<Candle> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONArray a = arr.getJSONArray(i);
            long closeTime = a.getLong(6);
            if (closeTime >= now - 500) continue;
            Candle c = new Candle();
            c.openTime = a.getLong(0);
            c.open = d(a.getString(1));
            c.high = d(a.getString(2));
            c.low = d(a.getString(3));
            c.close = d(a.getString(4));
            c.volume = d(a.getString(5));
            c.closeTime = closeTime;
            c.takerBuyVolume = a.length() > 9 ? d(a.getString(9)) : 0;
            out.add(c);
        }
        while (out.size() > 100) out.remove(0);
        if (out.size() < 15) throw new Exception(symbol + " " + interval + " için yeterli tamamlanmış mum yok");
        return out;
    }

    private Metrics fetchMetrics(String symbol, List<Candle> m15, long now) {
        Metrics m = new Metrics();
        m.symbol = symbol;
        try {
            JSONObject t = new JSONObject(get(BASE + "/fapi/v1/ticker/price?symbol=" + enc(symbol)));
            m.lastPrice = d(t.optString("price", "0"));
        } catch (Exception ignored) {}
        try {
            JSONObject p = new JSONObject(get(BASE + "/fapi/v1/premiumIndex?symbol=" + enc(symbol)));
            m.markPrice = d(p.optString("markPrice", "0"));
            m.funding = d(p.optString("lastFundingRate", "0"));
        } catch (Exception ignored) {}
        try {
            JSONObject oi = new JSONObject(get(BASE + "/fapi/v1/openInterest?symbol=" + enc(symbol)));
            m.openInterest = d(oi.optString("openInterest", "0"));
        } catch (Exception ignored) {}
        try {
            JSONArray hist = new JSONArray(get(BASE + "/futures/data/openInterestHist?symbol=" + enc(symbol) + "&period=5m&limit=4"));
            if (hist.length() >= 2) {
                double first = d(hist.getJSONObject(0).optString("sumOpenInterestValue", hist.getJSONObject(0).optString("sumOpenInterest", "0")));
                double last = d(hist.getJSONObject(hist.length() - 1).optString("sumOpenInterestValue", hist.getJSONObject(hist.length() - 1).optString("sumOpenInterest", "0")));
                if (first != 0) m.oiChange15m = (last / first - 1.0) * 100.0;
            }
        } catch (Exception ignored) {}
        try {
            JSONObject depth = new JSONObject(get(BASE + "/fapi/v1/depth?symbol=" + enc(symbol) + "&limit=20"));
            double bids = depthNotional(depth.optJSONArray("bids"));
            double asks = depthNotional(depth.optJSONArray("asks"));
            double total = bids + asks;
            if (total > 0) {
                m.bidPct = bids * 100.0 / total;
                m.askPct = asks * 100.0 / total;
            }
        } catch (Exception ignored) {}
        try {
            JSONArray trades = new JSONArray(get(BASE + "/fapi/v1/aggTrades?symbol=" + enc(symbol) + "&limit=1000"));
            long oldest = now;
            for (int i = 0; i < trades.length(); i++) {
                JSONObject a = trades.getJSONObject(i);
                long ts = a.optLong("T", now);
                oldest = Math.min(oldest, ts);
                double quote = d(a.optString("p", "0")) * d(a.optString("q", "0"));
                boolean buyerMaker = a.optBoolean("m", false);
                double signed = buyerMaker ? -quote : quote;
                if (ts >= now - 15L * 60L * 1000L) m.cvd15m += signed;
                if (ts >= now - 5L * 60L * 1000L) m.cvd5m += signed;
            }
            m.cvdCoverageMin = Math.min(15.0, Math.max(0.0, (now - oldest) / 60000.0));
        } catch (Exception ignored) {}

        if (m.lastPrice == 0 && !m15.isEmpty()) m.lastPrice = m15.get(m15.size() - 1).close;
        if (m.markPrice == 0) m.markPrice = m.lastPrice;
        Candle last = m15.get(m15.size() - 1);
        if (last.volume > 0) {
            m.takerBuyPct = last.takerBuyVolume * 100.0 / last.volume;
            m.takerSellPct = 100.0 - m.takerBuyPct;
        }
        int n = Math.min(20, m15.size() - 1);
        if (n > 0) {
            double avg = 0;
            for (int i = m15.size() - 1 - n; i < m15.size() - 1; i++) avg += m15.get(i).volume;
            avg /= n;
            if (avg > 0) m.volumeRatio = last.volume / avg;
        }
        return m;
    }

    private double depthNotional(JSONArray arr) {
        if (arr == null) return 0;
        double sum = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONArray x = arr.optJSONArray(i);
            if (x != null && x.length() >= 2) sum += d(x.optString(0, "0")) * d(x.optString(1, "0"));
        }
        return sum;
    }

    private Bitmap renderPack(String symbol, Map<String, List<Candle>> data, Metrics m, long now) {
        final int W = 1600;
        final int HEADER = 180;
        final int PANEL = 640;
        final int H = HEADER + PANEL * 4 + 100;
        Bitmap bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(Color.rgb(7, 12, 20));
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setColor(Color.WHITE);
        p.setTextSize(58);
        c.drawText(symbol + " • FUTURES PRO ANALİZ PAKETİ", 55, 72, p);
        p.setTypeface(Typeface.DEFAULT);
        p.setTextSize(30);
        p.setColor(Color.rgb(170, 185, 205));
        c.drawText("100 tamamlanmış mum • Binance Futures public veri • " + fmtTime(now), 55, 120, p);
        p.setColor(Color.rgb(55, 220, 135));
        c.drawText("Fiyat " + price(m.lastPrice) + "   Mark " + price(m.markPrice) + "   Funding " + pct(m.funding * 100.0), 55, 160, p);

        int y = HEADER;
        for (String interval : INTERVALS) {
            drawPanel(c, data.get(interval), symbol + " • " + interval.toUpperCase(Locale.US), 40, y, W - 80, PANEL - 18);
            y += PANEL;
        }
        p.setTextSize(26);
        p.setColor(Color.rgb(160, 175, 198));
        c.drawText("Not: Görsel fiyat yapısı içindir; OI/CVD/funding/orderbook sayısal olarak paylaşım metnine eklenmiştir.", 55, H - 45, p);
        return bmp;
    }

    private void drawPanel(Canvas c, List<Candle> list, String title, int x, int y, int w, int h) {
        if (list == null || list.isEmpty()) return;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.rgb(13, 23, 38));
        c.drawRect(x, y, x + w, y + h, p);

        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextSize(38);
        p.setColor(Color.WHITE);
        c.drawText(title, x + 22, y + 48, p);

        double min = Double.MAX_VALUE, max = -Double.MAX_VALUE, maxVol = 0;
        for (Candle k : list) {
            min = Math.min(min, k.low);
            max = Math.max(max, k.high);
            maxVol = Math.max(maxVol, k.volume);
        }
        double range = Math.max(1e-12, max - min);
        int left = x + 25, right = x + w - 25;
        int chartTop = y + 75, chartBottom = y + 390;
        int volTop = y + 405, volBottom = y + 485;
        int rsiTop = y + 505, rsiBottom = y + h - 25;

        p.setStrokeWidth(2);
        p.setColor(Color.rgb(45, 60, 82));
        for (int g = 0; g <= 4; g++) {
            float gy = chartTop + (chartBottom - chartTop) * g / 4f;
            c.drawLine(left, gy, right, gy, p);
        }

        int n = list.size();
        float step = (right - left) / (float) n;
        float bodyW = Math.max(3f, step * 0.58f);
        for (int i = 0; i < n; i++) {
            Candle k = list.get(i);
            float cx = left + step * (i + 0.5f);
            float yh = mapPrice(k.high, min, range, chartTop, chartBottom);
            float yl = mapPrice(k.low, min, range, chartTop, chartBottom);
            float yo = mapPrice(k.open, min, range, chartTop, chartBottom);
            float yc = mapPrice(k.close, min, range, chartTop, chartBottom);
            boolean up = k.close >= k.open;
            int color = up ? Color.rgb(39, 205, 145) : Color.rgb(246, 72, 89);
            p.setColor(color);
            p.setStrokeWidth(2.4f);
            c.drawLine(cx, yh, cx, yl, p);
            float top = Math.min(yo, yc), bot = Math.max(yo, yc);
            if (bot - top < 2) bot = top + 2;
            c.drawRect(cx - bodyW / 2, top, cx + bodyW / 2, bot, p);
            if (maxVol > 0) {
                float vh = (float) ((k.volume / maxVol) * (volBottom - volTop));
                p.setColor(up ? Color.rgb(30, 135, 105) : Color.rgb(150, 54, 68));
                c.drawRect(cx - bodyW / 2, volBottom - vh, cx + bodyW / 2, volBottom, p);
            }
        }

        p.setTypeface(Typeface.DEFAULT);
        p.setTextSize(25);
        p.setColor(Color.rgb(175, 190, 210));
        c.drawText("H " + price(max), right - 260, chartTop + 26, p);
        c.drawText("L " + price(min), right - 260, chartBottom - 8, p);
        Candle last = list.get(list.size() - 1);
        p.setColor(Color.rgb(60, 220, 150));
        c.drawText("C " + price(last.close), left + 8, chartTop + 26, p);
        p.setColor(Color.rgb(145, 160, 182));
        c.drawText("VOLUME", left, volTop + 20, p);

        double[] rsi = rsi(list, 14);
        p.setColor(Color.rgb(45, 60, 82));
        p.setStrokeWidth(2);
        float y70 = rsiY(70, rsiTop, rsiBottom), y50 = rsiY(50, rsiTop, rsiBottom), y30 = rsiY(30, rsiTop, rsiBottom);
        c.drawLine(left, y70, right, y70, p);
        c.drawLine(left, y50, right, y50, p);
        c.drawLine(left, y30, right, y30, p);
        Path path = new Path();
        boolean started = false;
        for (int i = 0; i < rsi.length; i++) {
            if (Double.isNaN(rsi[i])) continue;
            float px = left + step * (i + 0.5f);
            float py = rsiY(rsi[i], rsiTop, rsiBottom);
            if (!started) { path.moveTo(px, py); started = true; } else path.lineTo(px, py);
        }
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(3.5f);
        p.setColor(Color.rgb(153, 101, 255));
        c.drawPath(path, p);
        p.setStyle(Paint.Style.FILL);
        p.setTextSize(24);
        p.setColor(Color.rgb(185, 165, 240));
        double lastRsi = Double.NaN;
        for (int i = rsi.length - 1; i >= 0; i--) if (!Double.isNaN(rsi[i])) { lastRsi = rsi[i]; break; }
        c.drawText("RSI14 " + (Double.isNaN(lastRsi) ? "--" : String.format(Locale.US, "%.1f", lastRsi)), left, rsiTop + 22, p);
    }

    private double[] rsi(List<Candle> list, int period) {
        int n = list.size();
        double[] out = new double[n];
        for (int i = 0; i < n; i++) out[i] = Double.NaN;
        if (n <= period) return out;
        double gain = 0, loss = 0;
        for (int i = 1; i <= period; i++) {
            double ch = list.get(i).close - list.get(i - 1).close;
            if (ch >= 0) gain += ch; else loss -= ch;
        }
        gain /= period; loss /= period;
        out[period] = rsiFrom(gain, loss);
        for (int i = period + 1; i < n; i++) {
            double ch = list.get(i).close - list.get(i - 1).close;
            double g = ch > 0 ? ch : 0;
            double l = ch < 0 ? -ch : 0;
            gain = (gain * (period - 1) + g) / period;
            loss = (loss * (period - 1) + l) / period;
            out[i] = rsiFrom(gain, loss);
        }
        return out;
    }

    private double rsiFrom(double gain, double loss) {
        if (loss == 0) return 100;
        double rs = gain / loss;
        return 100.0 - 100.0 / (1.0 + rs);
    }

    private float mapPrice(double price, double min, double range, int top, int bottom) {
        return (float) (bottom - ((price - min) / range) * (bottom - top));
    }

    private float rsiY(double rsi, int top, int bottom) {
        return (float) (bottom - (rsi / 100.0) * (bottom - top));
    }

    private Uri saveImage(String symbol, Bitmap bitmap) throws Exception {
        if (Build.VERSION.SDK_INT < 29) return null;
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, symbol + "_Futures_PRO_" + System.currentTimeMillis() + ".png");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/FuturesAlarm");
        Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("Grafik dosyası oluşturulamadı");
        OutputStream os = getContentResolver().openOutputStream(uri);
        if (os == null) throw new Exception("Grafik dosyası açılamadı");
        bitmap.compress(Bitmap.CompressFormat.PNG, 95, os);
        os.flush();
        os.close();
        return uri;
    }

    private void sharePack() {
        if (shareText == null) return;
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("15m Futures PRO master analiz", shareText));

        Intent send = new Intent(Intent.ACTION_SEND);
        send.putExtra(Intent.EXTRA_TEXT, shareText);
        if (imageUri != null) {
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, imageUri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else {
            send.setType("text/plain");
        }

        Intent direct = new Intent(send);
        direct.setPackage("com.openai.chatgpt");
        try {
            startActivity(direct);
            Toast.makeText(this, "Prompt panoya da kopyalandı.", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            startActivity(Intent.createChooser(send, "ChatGPT'ye gönder"));
            Toast.makeText(this, "Prompt panoya da kopyalandı.", Toast.LENGTH_LONG).show();
        }
    }

    private String buildPrompt(String symbol, Map<String, List<Candle>> data, Metrics m, long now) {
        StringBuilder sb = new StringBuilder();
        sb.append("15M FUTURES PRO MANUEL ANALİZ PROTOKOLÜ\n\n");
        sb.append("Gönderdiğim coin için 15m, 1h, 4h ve 1D grafiklerini birlikte ve profesyonel trader mantığıyla analiz et. Önce piyasa rejimini belirle: TREND UP / TREND DOWN / RANGE / HIGH VOLATILITY / TRANSITION. Öncelik sırası: piyasa yapısı (HH-HL / LH-LL ve swingler) > fiyatın destek/direnç ve likidite konumu > 15m kapanış/tetik > hacim > RSI/momentum > volatilite. RSI tek başına LONG veya SHORT sebebi değildir. Fake breakout, liquidity sweep, wick/rejection, retest ve trend karşıtı işlem riskini kontrol et.\n\n");
        sb.append("Bana önce yalnızca ana kararı açıkça ver: LONG / SHORT / İŞLEM YOK ve 0-100 güven puanı. Ardından LONG pullback, LONG breakout, SHORT direnç/rejection ve SHORT breakdown senaryolarını ayrı ayrı değerlendir. Uygun senaryolarda giriş bölgesi, STOP, TP1, TP2, TP3 ve geçersizlik seviyesini ver. Breakout/breakdown için TAMAMLANMIŞ 15m mum kapanışı şart olsun. Risk/ödül kötü veya yapı karışıksa İŞLEM YOK de; sırf sinyal üretmek için işlem önerme.\n\n");
        sb.append("SONUNDA uygulamaya doğrudan yapıştırabileceğim TEK SATIR plan kodu üret ve kod dışında o satıra açıklama ekleme. Format:\n");
        sb.append("SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB\n");
        sb.append("LP=stop;tp1;tp2;tp3\nLB=girisAlt;girisUst;stop;tp1;tp2;tp3\nSR=stop;tp1;tp2;tp3\nSB=girisAlt;girisUst;stop;tp1;tp2;tp3\n\n");
        sb.append("Plan seviyelerini mevcut grafiklerdeki yapıya göre üret. Fiyat çoktan bir seviyeyi geçtiyse geçmişte kalmış girişi yeni sinyal gibi verme.\n\n");
        sb.append("--- UYGULAMANIN OTOMATİK TOPLADIĞI CANLI VERİLER ---\n");
        sb.append("Coin: ").append(symbol).append("\n");
        sb.append("Paket zamanı: ").append(fmtTime(now)).append("\n");
        sb.append("Ekli tek görsel: 15m / 1h / 4h / 1D, her panelde son ");
        sb.append(data.get("15m") == null ? 0 : data.get("15m").size()).append("'e kadar TAMAMLANMIŞ mum + hacim + RSI14.\n");
        sb.append("Anlık fiyat: ").append(price(m.lastPrice)).append("\n");
        sb.append("Mark price: ").append(price(m.markPrice)).append("\n");
        sb.append("Funding: ").append(pct(m.funding * 100.0)).append("\n");
        sb.append("Open Interest: ").append(num(m.openInterest)).append("\n");
        sb.append("OI yaklaşık 15m değişim: ").append(signedPct(m.oiChange15m)).append("\n");
        sb.append("CVD 5m (son agg trade örneklemi, quote notional): ").append(signedMoney(m.cvd5m)).append("\n");
        sb.append("CVD 15m (son agg trade örneklemi, quote notional): ").append(signedMoney(m.cvd15m)).append("\n");
        sb.append("CVD örneklem kapsaması yaklaşık: ").append(String.format(Locale.US, "%.1f dk", m.cvdCoverageMin)).append(" (çok yoğun coinde 1000 trade sınırı nedeniyle 15m'den kısa olabilir).\n");
        sb.append("Son tamamlanmış 15m Taker Buy/Sell: ").append(String.format(Locale.US, "%.1f%% / %.1f%%", m.takerBuyPct, m.takerSellPct)).append("\n");
        sb.append("Son 15m hacim / önceki 20 mum ortalaması: ").append(String.format(Locale.US, "%.2fx", m.volumeRatio)).append("\n");
        sb.append("Order book top20 Bid/Ask notional: ").append(String.format(Locale.US, "%.1f%% / %.1f%%", m.bidPct, m.askPct)).append("\n");
        sb.append("Likidasyon: bu pakette yok; eksik veriyi varmış gibi yorumlama.\n");
        sb.append("Bu sayısal veriler yardımcı teyittir. Ana öncelik yine fiyat yapısı ve tamamlanmış 15m mum kapanışıdır.\n");
        return sb.toString();
    }

    private String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("GET");
        c.setConnectTimeout(9000);
        c.setReadTimeout(12000);
        c.setRequestProperty("User-Agent", "Futures15mAlarmPRO/9.4");
        int code = c.getResponseCode();
        BufferedReader br = new BufferedReader(new InputStreamReader(code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream()));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        c.disconnect();
        if (code < 200 || code >= 300) throw new Exception("Binance HTTP " + code + ": " + sb);
        return sb.toString();
    }

    private String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }
    private double d(String s) { try { return Double.parseDouble(s); } catch (Exception e) { return 0; } }

    private String price(double v) {
        if (v == 0) return "--";
        if (v >= 1000) return String.format(Locale.US, "%.2f", v);
        if (v >= 100) return String.format(Locale.US, "%.3f", v);
        if (v >= 1) return String.format(Locale.US, "%.4f", v);
        if (v >= 0.1) return String.format(Locale.US, "%.5f", v);
        if (v >= 0.01) return String.format(Locale.US, "%.6f", v);
        return String.format(Locale.US, "%.8f", v);
    }

    private String num(double v) {
        if (v == 0) return "--";
        if (Math.abs(v) >= 1_000_000_000) return String.format(Locale.US, "%.2fB", v / 1_000_000_000.0);
        if (Math.abs(v) >= 1_000_000) return String.format(Locale.US, "%.2fM", v / 1_000_000.0);
        if (Math.abs(v) >= 1_000) return String.format(Locale.US, "%.2fK", v / 1_000.0);
        return String.format(Locale.US, "%.2f", v);
    }
    private String signedMoney(double v) { return (v >= 0 ? "+" : "") + num(v) + " USDT"; }
    private String pct(double v) { return String.format(Locale.US, "%.5f%%", v); }
    private String signedPct(double v) { return String.format(Locale.US, "%+.2f%%", v); }

    private String fmtTime(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
        f.setTimeZone(TimeZone.getDefault());
        return f.format(new Date(ms));
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String s, int color) {
        Button b = new Button(this);
        b.setText(s);
        b.setTextSize(16);
        b.setTextColor(Color.WHITE);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setBackgroundColor(color);
        return b;
    }

    private LinearLayout.LayoutParams lp(int w, int h, int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(dp(l), dp(t), dp(r), dp(b));
        return p;
    }
    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density + 0.5f); }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        io.shutdownNow();
    }

    static class Candle {
        long openTime, closeTime;
        double open, high, low, close, volume, takerBuyVolume;
    }

    static class Metrics {
        String symbol;
        double lastPrice, markPrice, funding, openInterest, oiChange15m;
        double cvd5m, cvd15m, cvdCoverageMin;
        double takerBuyPct, takerSellPct, volumeRatio, bidPct, askPct;
    }
}
