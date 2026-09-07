from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.22b missing: ' + str(p))


def method_bounds(src, signature):
    a = src.find(signature)
    if a < 0: return None
    b = src.find('{', a)
    if b < 0: return None
    depth = 1; i = b + 1; quote = False; char_quote = False; esc = False
    while i < len(src) and depth:
        c = src[i]
        if quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': quote = False
        elif char_quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": char_quote = False
        else:
            if c == '"': quote = True
            elif c == "'": char_quote = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

m = MAIN.read_text()
m = m.replace('v9.5.21', 'v9.5.22')
m = re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.22', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.22  •  MANUEL PRO', m)
m = m.replace('otomatik emir yok', 'API emri yalnız kullanıcı onayıyla')
m = m.replace('otomatik emir YOK', 'API emri yalnız kullanıcı onayıyla')

# Add a clearly named API/order settings action below the analysis package.
api_anchor = '        root.addView(analysisPack, analysisLp);'
if 'V9522_API_SETTINGS_BUTTON' not in m:
    if api_anchor not in m:
        raise SystemExit('v9.5.22b analysis button anchor missing')
    ui = r'''

        // V9522_API_SETTINGS_BUTTON
        Button v9522ApiButton = button("BINANCE API / EMİR\nAnahtar ve işlem ayarları", Color.rgb(30, 64, 175));
        v9522ApiButton.setOnClickListener(v -> v9522ShowApiSettings());
        LinearLayout.LayoutParams v9522ApiLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
        v9522ApiLp.setMargins(0, 0, 0, dp(18));
        root.addView(v9522ApiButton, v9522ApiLp);'''
    m = m.replace(api_anchor, api_anchor + ui, 1)

# Coin tap: if there is a real active signal, open the in-app order ticket.
# Otherwise retain the exact Binance Futures contract fallback from v9.5.21.
b = method_bounds(m, '    private void openBinanceFutures(String symbol) ')
if not b:
    raise SystemExit('v9.5.22b openBinanceFutures missing')
a0, _, e0 = b
new_open = r'''    private void openBinanceFutures(String symbol) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
        if (sym.isEmpty()) return;
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        if (sp.getBoolean("v9518_signal_active_" + sym, false)) {
            v9522ShowTradeTicket(sym);
            return;
        }
        v9522OpenExactFutures(sym);
    }'''
m = m[:a0] + new_open + m[e0:]

if 'private void v9522ShowApiSettings()' not in m:
    pos = m.rfind('}')
    if pos < 0: raise SystemExit('v9.5.22b MainActivity closing brace missing')
    helper = r'''

    // ============================================================
    // v9.5.22 • Binance API / manual-confirmation order engine
    // API secrets are encrypted by an AES/GCM key held in Android Keystore.
    // No secret is logged, copied to clipboard or rendered back to the screen.
    // ============================================================
    private static final String V9522_API_ALIAS = "futures_alarm_binance_api_v1";
    private static final String V9522_API_BASE = "https://fapi.binance.com";
    private final java.util.concurrent.ExecutorService v9522Io =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private volatile long v9522TimeOffset = 0L;

    private android.content.SharedPreferences v9522Prefs() {
        return getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
    }

    private javax.crypto.SecretKey v9522AesKey() throws Exception {
        if (android.os.Build.VERSION.SDK_INT < 23)
            throw new Exception("API anahtarı için Android 6.0 veya üzeri gerekir.");
        java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(V9522_API_ALIAS)) {
            javax.crypto.KeyGenerator kg = javax.crypto.KeyGenerator.getInstance(
                    android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            android.security.keystore.KeyGenParameterSpec spec =
                    new android.security.keystore.KeyGenParameterSpec.Builder(
                            V9522_API_ALIAS,
                            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT |
                                    android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                            .build();
            kg.init(spec);
            return kg.generateKey();
        }
        java.security.KeyStore.SecretKeyEntry e = (java.security.KeyStore.SecretKeyEntry)
                ks.getEntry(V9522_API_ALIAS, null);
        return e.getSecretKey();
    }

    private String v9522Encrypt(String plain) throws Exception {
        javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        c.init(javax.crypto.Cipher.ENCRYPT_MODE, v9522AesKey());
        byte[] iv = c.getIV();
        byte[] enc = c.doFinal(plain.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP) + ":" +
                android.util.Base64.encodeToString(enc, android.util.Base64.NO_WRAP);
    }

    private String v9522Decrypt(String packed) throws Exception {
        if (packed == null || packed.isEmpty()) return "";
        String[] p = packed.split(":", 2);
        if (p.length != 2) throw new Exception("Şifreli API kaydı bozuk.");
        byte[] iv = android.util.Base64.decode(p[0], android.util.Base64.NO_WRAP);
        byte[] enc = android.util.Base64.decode(p[1], android.util.Base64.NO_WRAP);
        javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        c.init(javax.crypto.Cipher.DECRYPT_MODE, v9522AesKey(),
                new javax.crypto.spec.GCMParameterSpec(128, iv));
        return new String(c.doFinal(enc), java.nio.charset.StandardCharsets.UTF_8);
    }

    private String[] v9522Credentials() throws Exception {
        android.content.SharedPreferences sp = v9522Prefs();
        String key = v9522Decrypt(sp.getString("v9522_api_key_enc", ""));
        String secret = v9522Decrypt(sp.getString("v9522_api_secret_enc", ""));
        if (key.trim().isEmpty() || secret.trim().isEmpty())
            throw new Exception("Binance API Key / Secret kayıtlı değil.");
        return new String[]{key.trim(), secret.trim()};
    }

    private String v9522MaskedKey() {
        try {
            String[] c = v9522Credentials();
            String k = c[0];
            if (k.length() <= 8) return "Kayıtlı";
            return k.substring(0, 4) + "••••••••" + k.substring(k.length() - 4);
        } catch (Throwable ignored) { return "Kayıt yok"; }
    }

    private EditText v9522Input(String hint, boolean secret) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.rgb(120, 138, 164));
        e.setSingleLine(true);
        e.setTextSize(15f);
        e.setPadding(dp(12), dp(8), dp(12), dp(8));
        e.setBackgroundColor(Color.rgb(15, 28, 46));
        if (secret) e.setInputType(android.text.InputType.TYPE_CLASS_TEXT |
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        else e.setInputType(android.text.InputType.TYPE_CLASS_TEXT |
                android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        return e;
    }

    private void v9522ShowApiSettings() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(8), dp(16), dp(4));
        TextView st = text("KAYIT: " + v9522MaskedKey() +
                "\nYalnız Futures işlem yetkili, para çekme yetkisi KAPALI ayrı bir API anahtarı kullanın. Secret ekranda tekrar gösterilmez.",
                12.5f, Color.rgb(203, 213, 225), false);
        box.addView(st);
        EditText key = v9522Input("Yeni API Key • boşsa kayıtlı olan korunur", false);
        EditText sec = v9522Input("Yeni API Secret • boşsa kayıtlı olan korunur", true);
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(-1, dp(52));
        ep.setMargins(0, dp(10), 0, 0);
        box.addView(key, ep); box.addView(sec, ep);

        android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)
                .setTitle("Binance API / Emir Ayarları")
                .setView(box)
                .setNegativeButton("KAPAT", null)
                .setNeutralButton("KAYDI SİL", null)
                .setPositiveButton("KAYDET", null)
                .create();
        dlg.setOnShowListener(x -> {
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                try {
                    String nk = key.getText().toString().trim();
                    String ns = sec.getText().toString().trim();
                    android.content.SharedPreferences sp = v9522Prefs();
                    String oldK = "", oldS = "";
                    try { oldK = v9522Decrypt(sp.getString("v9522_api_key_enc", "")); } catch (Throwable ignored) {}
                    try { oldS = v9522Decrypt(sp.getString("v9522_api_secret_enc", "")); } catch (Throwable ignored) {}
                    if (nk.isEmpty()) nk = oldK;
                    if (ns.isEmpty()) ns = oldS;
                    if (nk.trim().isEmpty() || ns.trim().isEmpty()) {
                        Toast.makeText(this, "API Key ve Secret birlikte gerekli.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    sp.edit().putString("v9522_api_key_enc", v9522Encrypt(nk.trim()))
                            .putString("v9522_api_secret_enc", v9522Encrypt(ns.trim())).apply();
                    key.setText(""); sec.setText("");
                    st.setText("KAYIT: " + v9522MaskedKey() + "\nSecret Android Keystore ile cihazda şifreli saklanıyor.");
                    Toast.makeText(this, "API bilgileri şifreli kaydedildi.", Toast.LENGTH_LONG).show();
                } catch (Throwable ex) {
                    Toast.makeText(this, "API kaydı başarısız: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
            dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                v9522Prefs().edit().remove("v9522_api_key_enc").remove("v9522_api_secret_enc").apply();
                key.setText(""); sec.setText(""); st.setText("KAYIT: Kayıt yok");
                Toast.makeText(this, "API kaydı uygulamadan silindi.", Toast.LENGTH_LONG).show();
            });
            st.setOnClickListener(v -> v9522TestApi());
        });
        dlg.show();
        Toast.makeText(this, "Bağlantı testi için KAYIT satırına dokunabilirsiniz.", Toast.LENGTH_LONG).show();
    }

    private String v9522Enc(String x) throws Exception {
        return java.net.URLEncoder.encode(x == null ? "" : x, "UTF-8");
    }

    private String v9522Query(java.util.Map<String,String> p) throws Exception {
        StringBuilder b = new StringBuilder();
        for (java.util.Map.Entry<String,String> e : p.entrySet()) {
            if (b.length() > 0) b.append('&');
            b.append(v9522Enc(e.getKey())).append('=').append(v9522Enc(e.getValue()));
        }
        return b.toString();
    }

    private String v9522Hmac(String secret, String data) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(
                secret.getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] out = mac.doFinal(data.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder h = new StringBuilder();
        for (byte q : out) h.append(String.format(java.util.Locale.US, "%02x", q & 0xff));
        return h.toString();
    }

    private String v9522Read(java.io.InputStream in) throws Exception {
        java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(in));
        StringBuilder b = new StringBuilder(); String line;
        while ((line = r.readLine()) != null) b.append(line);
        r.close(); return b.toString();
    }

    private String v9522Http(String method, String path, java.util.Map<String,String> params, boolean signed) throws Exception {
        java.util.LinkedHashMap<String,String> p = new java.util.LinkedHashMap<>();
        if (params != null) p.putAll(params);
        String apiKey = null, secret = null;
        if (signed) {
            String[] cr = v9522Credentials(); apiKey = cr[0]; secret = cr[1];
            p.put("recvWindow", "5000");
            p.put("timestamp", Long.toString(System.currentTimeMillis() + v9522TimeOffset));
        }
        String q = v9522Query(p);
        if (signed) q += "&signature=" + v9522Hmac(secret, q);
        java.net.URL url = new java.net.URL(V9522_API_BASE + path + (q.isEmpty() ? "" : "?" + q));
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
        c.setRequestMethod(method); c.setConnectTimeout(8000); c.setReadTimeout(12000);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "Futures15mAlarmPRO/9.5.22");
        if (signed) c.setRequestProperty("X-MBX-APIKEY", apiKey);
        int code = c.getResponseCode();
        java.io.InputStream in = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
        String body = in == null ? "" : v9522Read(in);
        c.disconnect();
        if (code < 200 || code >= 300) {
            String msg = body;
            try { msg = new org.json.JSONObject(body).optString("msg", body); } catch (Throwable ignored) {}
            throw new Exception("Binance API " + code + ": " + msg);
        }
        return body;
    }

    private void v9522SyncTime() throws Exception {
        String b = v9522Http("GET", "/fapi/v1/time", null, false);
        long server = new org.json.JSONObject(b).getLong("serverTime");
        v9522TimeOffset = server - System.currentTimeMillis();
    }

    private void v9522TestApi() {
        Toast.makeText(this, "Binance API bağlantısı test ediliyor...", Toast.LENGTH_SHORT).show();
        v9522Io.execute(() -> {
            try {
                v9522SyncTime();
                org.json.JSONObject a = new org.json.JSONObject(v9522Http("GET", "/fapi/v2/account", null, true));
                boolean can = a.optBoolean("canTrade", false);
                String bal = a.optString("availableBalance", "-");
                runOnUiThread(() -> Toast.makeText(this,
                        "API BAĞLANTISI: " + (can ? "İŞLEM YETKİSİ UYGUN" : "İŞLEM YETKİSİ YOK") +
                                " • Kullanılabilir bakiye: " + bal + " USDT",
                        Toast.LENGTH_LONG).show());
            } catch (Throwable ex) {
                runOnUiThread(() -> Toast.makeText(this, "API TEST HATASI: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void v9522OpenExactFutures(String sym) {
        String url = "https://www.binance.com/en/futures/" + Uri.encode(sym);
        try {
            Intent direct = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            direct.setPackage("com.binance.dev"); direct.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(direct); return;
        } catch (Throwable ignored) {}
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); return; }
        catch (Throwable ignored) {}
        Toast.makeText(this, "Binance Futures açılamadı.", Toast.LENGTH_LONG).show();
    }

    private double v9522D(android.content.SharedPreferences sp, String key) {
        try { return Double.parseDouble(sp.getString(key, "NaN")); }
        catch (Throwable ignored) { return Double.NaN; }
    }

    private String v9522P(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x)) return "-";
        try { return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString(); }
        catch (Throwable ignored) { return String.format(java.util.Locale.US, "%.8f", x); }
    }

    private void v9522ShowTradeTicket(String symbol) {
        android.content.SharedPreferences sp = v9522Prefs();
        if (!sp.getBoolean("v9518_signal_active_" + symbol, false)) {
            v9522OpenExactFutures(symbol); return;
        }
        long ts = sp.getLong("v9518_signal_time_" + symbol, 0L);
        String side = sp.getString("v9518_signal_side_" + symbol, "-");
        String reason = sp.getString("v9518_signal_reason_short_" + symbol, "giriş teyidi");
        double entry = v9522D(sp, "v9518_signal_price_" + symbol);
        double stop = v9522D(sp, "v9518_signal_stop_" + symbol);
        double t1 = v9522D(sp, "v9518_signal_tp1_" + symbol);
        double t2 = v9522D(sp, "v9518_signal_tp2_" + symbol);
        double t3 = v9522D(sp, "v9518_signal_tp3_" + symbol);
        if (Double.isNaN(entry) || Double.isNaN(stop) || Double.isNaN(t1) || Double.isNaN(t2) || Double.isNaN(t3)) {
            Toast.makeText(this, "Aktif sinyalde GİRİŞ / STOP / TP seviyeleri eksik. Emir hazırlanmadı.", Toast.LENGTH_LONG).show();
            return;
        }

        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(6), dp(16), dp(4));
        TextView levels = text(symbol + " • " + side +
                "\nSİNYAL NEDENİ: " + reason +
                "\nGİRİŞ REFERANSI: " + v9522P(entry) +
                "\nSTOP: " + v9522P(stop) +
                "\nTP1: " + v9522P(t1) + "   TP2: " + v9522P(t2) + "   TP3: " + v9522P(t3) +
                "\n\nGİRİŞ TÜRÜ: PİYASA • canlı fiyat referanstan %0,50'den fazla uzaklaşırsa emir kilitlenir.",
                13f, Color.rgb(226,232,240), false);
        box.addView(levels);
        EditText margin = v9522Input("Marj miktarı (USDT)", false);
        EditText lev = v9522Input("Kaldıraç (1-125)", false);
        margin.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        lev.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        String lm = sp.getString("v9522_last_margin", "");
        String ll = sp.getString("v9522_last_leverage", "");
        if (!lm.isEmpty()) margin.setText(lm); if (!ll.isEmpty()) lev.setText(ll);
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(-1, dp(52)); ep.setMargins(0, dp(9), 0, 0);
        box.addView(margin, ep); box.addView(lev, ep);
        TextView warn = text("Marj × kaldıraç = yaklaşık pozisyon büyüklüğü. Emir kendi kendine gönderilmez; ikinci ekranda son onay gerekir. TP dağılımı %33 / %33 / %34'tür.",
                11.5f, Color.rgb(251,191,36), false); warn.setPadding(0, dp(10), 0, 0); box.addView(warn);

        new android.app.AlertDialog.Builder(this)
                .setTitle("EMİR TASLAĞI")
                .setView(box)
                .setNegativeButton("VAZGEÇ", null)
                .setNeutralButton("BINANCE SAYFASI", (d,w) -> v9522OpenExactFutures(symbol))
                .setPositiveButton("EMRİ HAZIRLA", (d,w) -> {
                    try {
                        double mg = Double.parseDouble(margin.getText().toString().trim());
                        int lv = Integer.parseInt(lev.getText().toString().trim());
                        if (!(mg > 0) || lv < 1 || lv > 125) throw new Exception("Marj > 0 ve kaldıraç 1-125 olmalı.");
                        sp.edit().putString("v9522_last_margin", v9522P(mg))
                                .putString("v9522_last_leverage", Integer.toString(lv)).apply();
                        v9522PrepareOrder(symbol, side, reason, ts, entry, stop, t1, t2, t3, mg, lv);
                    } catch (Throwable ex) {
                        Toast.makeText(this, "Marj/kaldıraç hatası: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }).show();
    }

    private static class V9522OrderDraft {
        String symbol, side, reason, qtyText, q1Text, q2Text, q3Text, positionSide;
        double entryRef, live, stop, tp1, tp2, tp3, margin, step, minQty;
        int leverage; boolean hedge;
    }

    private org.json.JSONObject v9522SymbolInfo(String symbol) throws Exception {
        org.json.JSONObject ex = new org.json.JSONObject(v9522Http("GET", "/fapi/v1/exchangeInfo", null, false));
        org.json.JSONArray ar = ex.getJSONArray("symbols");
        for (int i=0;i<ar.length();i++) {
            org.json.JSONObject s = ar.getJSONObject(i);
            if (symbol.equals(s.optString("symbol"))) return s;
        }
        throw new Exception(symbol + " Futures sözleşmesi exchangeInfo içinde bulunamadı.");
    }

    private org.json.JSONObject v9522Filter(org.json.JSONObject sym, String type) {
        org.json.JSONArray f = sym.optJSONArray("filters");
        if (f == null) return null;
        for (int i=0;i<f.length();i++) {
            org.json.JSONObject x = f.optJSONObject(i);
            if (x != null && type.equals(x.optString("filterType"))) return x;
        }
        return null;
    }

    private double v9522Floor(double value, double step) {
        if (!(step > 0)) return value;
        java.math.BigDecimal v = java.math.BigDecimal.valueOf(value);
        java.math.BigDecimal s = java.math.BigDecimal.valueOf(step);
        return v.divide(s, 0, java.math.RoundingMode.DOWN).multiply(s).doubleValue();
    }

    private double v9522Round(double value, double step) {
        if (!(step > 0)) return value;
        java.math.BigDecimal v = java.math.BigDecimal.valueOf(value);
        java.math.BigDecimal s = java.math.BigDecimal.valueOf(step);
        return v.divide(s, 0, java.math.RoundingMode.HALF_UP).multiply(s).doubleValue();
    }

    private String v9522StepText(double value, double step) {
        return java.math.BigDecimal.valueOf(v9522Floor(value, step)).stripTrailingZeros().toPlainString();
    }

    private boolean v9522HasOpenPosition(org.json.JSONObject account, String symbol) {
        org.json.JSONArray p = account.optJSONArray("positions");
        if (p == null) return false;
        for (int i=0;i<p.length();i++) {
            org.json.JSONObject x = p.optJSONObject(i);
            if (x != null && symbol.equals(x.optString("symbol"))) {
                try { if (Math.abs(Double.parseDouble(x.optString("positionAmt", "0"))) > 0) return true; }
                catch (Throwable ignored) {}
            }
        }
        return false;
    }

    private void v9522PrepareOrder(String symbol, String side, String reason, long signalTs,
                                   double entry, double stop, double t1, double t2, double t3,
                                   double margin, int leverage) {
        Toast.makeText(this, "Canlı fiyat, hesap ve sözleşme kuralları kontrol ediliyor...", Toast.LENGTH_SHORT).show();
        v9522Io.execute(() -> {
            try {
                v9522SyncTime();
                long age = System.currentTimeMillis() - signalTs;
                if (signalTs <= 0 || age < 0 || age > 8L*60L*1000L)
                    throw new Exception("Sinyal 8 dakikadan eski. Yeni teyit/retest beklenmeli.");
                android.content.SharedPreferences sp = v9522Prefs();
                if (!sp.getBoolean("v9518_signal_active_" + symbol, false))
                    throw new Exception("Sinyal artık aktif değil.");
                if (sp.getLong("v9522_order_sent_signal_" + symbol, -1L) == signalTs)
                    throw new Exception("Bu sinyal için daha önce API emri gönderildi.");

                java.util.LinkedHashMap<String,String> pp = new java.util.LinkedHashMap<>(); pp.put("symbol", symbol);
                double live = Double.parseDouble(new org.json.JSONObject(v9522Http("GET", "/fapi/v1/ticker/price", pp, false)).getString("price"));
                double dev = Math.abs(live-entry)/entry*100.0;
                if (dev > 0.50) throw new Exception(String.format(java.util.Locale.US,
                        "Canlı fiyat giriş referansından %%.2f uzaklaştı (sınır %%0.50). Fiyat kovalanmadı.", dev));
                boolean lng = "LONG".equalsIgnoreCase(side);
                if ((lng && live <= stop) || (!lng && live >= stop))
                    throw new Exception("Canlı fiyat STOP/geçersizlik tarafında. Emir kilitlendi.");
                if (lng && !(stop < live && live < t1 && t1 < t2 && t2 < t3))
                    throw new Exception("LONG STOP/TP sıralaması güncel fiyat için geçersiz.");
                if (!lng && !(stop > live && live > t1 && t1 > t2 && t2 > t3))
                    throw new Exception("SHORT STOP/TP sıralaması güncel fiyat için geçersiz.");

                org.json.JSONObject account = new org.json.JSONObject(v9522Http("GET", "/fapi/v2/account", null, true));
                if (!account.optBoolean("canTrade", false)) throw new Exception("API anahtarında Futures işlem yetkisi yok.");
                if (v9522HasOpenPosition(account, symbol)) throw new Exception(symbol + " için zaten açık Futures pozisyonu var; üst üste pozisyon açılmadı.");
                boolean hedge = new org.json.JSONObject(v9522Http("GET", "/fapi/v1/positionSide/dual", null, true))
                        .optBoolean("dualSidePosition", false);

                org.json.JSONObject si = v9522SymbolInfo(symbol);
                org.json.JSONObject lot = v9522Filter(si, "MARKET_LOT_SIZE");
                if (lot == null) lot = v9522Filter(si, "LOT_SIZE");
                if (lot == null) throw new Exception("Miktar filtresi bulunamadı.");
                double step = Double.parseDouble(lot.optString("stepSize", "0"));
                double minQty = Double.parseDouble(lot.optString("minQty", "0"));
                double maxQty = Double.parseDouble(lot.optString("maxQty", "1e50"));
                double qty = v9522Floor((margin * leverage) / live, step);
                if (!(qty >= minQty) || qty > maxQty) throw new Exception("Hesaplanan miktar sözleşme min/max miktarına uymuyor.");
                double q1 = v9522Floor(qty * 0.33, step);
                double q2 = v9522Floor(qty * 0.33, step);
                double q3 = v9522Floor(qty - q1 - q2, step);
                if (q1 < minQty || q2 < minQty || q3 < minQty)
                    throw new Exception("Pozisyon miktarı TP1/TP2/TP3'e güvenli bölünemiyor. Marj veya kaldıracı artırın.");

                org.json.JSONObject pf = v9522Filter(si, "PRICE_FILTER");
                double tick = pf == null ? 0 : Double.parseDouble(pf.optString("tickSize", "0"));
                V9522OrderDraft d = new V9522OrderDraft();
                d.symbol=symbol; d.side=side; d.reason=reason; d.entryRef=entry; d.live=live;
                d.stop=v9522Round(stop,tick); d.tp1=v9522Round(t1,tick); d.tp2=v9522Round(t2,tick); d.tp3=v9522Round(t3,tick);
                d.margin=margin; d.leverage=leverage; d.hedge=hedge; d.positionSide=hedge?(lng?"LONG":"SHORT"):"BOTH";
                d.step=step; d.minQty=minQty; d.qtyText=v9522StepText(qty,step);
                d.q1Text=v9522StepText(q1,step); d.q2Text=v9522StepText(q2,step); d.q3Text=v9522StepText(q3,step);
                runOnUiThread(() -> v9522FinalConfirm(d, signalTs));
            } catch (Throwable ex) {
                runOnUiThread(() -> Toast.makeText(this, "EMİR HAZIRLANMADI: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void v9522FinalConfirm(V9522OrderDraft d, long signalTs) {
        String body = d.symbol + " • " + d.side +
                "\nSİNYAL NEDENİ: " + d.reason +
                "\n\nGİRİŞ: PİYASA\nSinyal referansı: " + v9522P(d.entryRef) +
                "\nCanlı fiyat: " + v9522P(d.live) +
                "\nMarj: " + v9522P(d.margin) + " USDT • Kaldıraç: " + d.leverage + "x" +
                "\nMiktar: " + d.qtyText +
                "\nPozisyon modu: " + (d.hedge ? "HEDGE / " + d.positionSide : "TEK YÖN") +
                "\n\nSTOP: " + v9522P(d.stop) +
                "\nTP1: " + v9522P(d.tp1) + " • miktar " + d.q1Text +
                "\nTP2: " + v9522P(d.tp2) + " • miktar " + d.q2Text +
                "\nTP3: " + v9522P(d.tp3) + " • miktar " + d.q3Text +
                "\n\nBu düğmeye basılmadan Binance'a hiçbir emir gönderilmez.";
        new android.app.AlertDialog.Builder(this)
                .setTitle("SON EMİR ONAYI")
                .setMessage(body)
                .setNegativeButton("VAZGEÇ", null)
                .setPositiveButton("EMİRLERİ BINANCE'A GÖNDER", (x,w) -> v9522ExecuteOrder(d, signalTs))
                .show();
    }

    private java.util.LinkedHashMap<String,String> v9522BaseOrder(V9522OrderDraft d, String side) {
        java.util.LinkedHashMap<String,String> p = new java.util.LinkedHashMap<>();
        p.put("symbol", d.symbol); p.put("side", side);
        if (d.hedge) p.put("positionSide", d.positionSide);
        return p;
    }

    private void v9522Algo(V9522OrderDraft d, String type, double trigger, String quantity, boolean closeAll) throws Exception {
        String exitSide = "LONG".equalsIgnoreCase(d.side) ? "SELL" : "BUY";
        java.util.LinkedHashMap<String,String> p = v9522BaseOrder(d, exitSide);
        p.put("algoType", "CONDITIONAL"); p.put("type", type);
        p.put("triggerPrice", v9522P(trigger)); p.put("workingType", "MARK_PRICE");
        p.put("priceProtect", "false");
        if (closeAll) p.put("closePosition", "true");
        else {
            p.put("quantity", quantity);
            if (!d.hedge) p.put("reduceOnly", "true");
        }
        v9522Http("POST", "/fapi/v1/algoOrder", p, true);
    }

    private void v9522EmergencyClose(V9522OrderDraft d, String qty) {
        try {
            String exitSide = "LONG".equalsIgnoreCase(d.side) ? "SELL" : "BUY";
            java.util.LinkedHashMap<String,String> p = v9522BaseOrder(d, exitSide);
            p.put("type", "MARKET"); p.put("quantity", qty);
            if (!d.hedge) p.put("reduceOnly", "true");
            v9522Http("POST", "/fapi/v1/order", p, true);
        } catch (Throwable ignored) {}
    }

    private void v9522ExecuteOrder(V9522OrderDraft d, long signalTs) {
        android.content.SharedPreferences sp = v9522Prefs();
        if (sp.getBoolean("v9522_order_inflight_" + d.symbol, false)) {
            Toast.makeText(this, "Bu coin için emir zaten gönderiliyor.", Toast.LENGTH_LONG).show(); return;
        }
        sp.edit().putBoolean("v9522_order_inflight_" + d.symbol, true).apply();
        Toast.makeText(this, "Binance Futures emirleri gönderiliyor...", Toast.LENGTH_SHORT).show();
        v9522Io.execute(() -> {
            String filledQty = d.qtyText;
            boolean entryFilled = false, stopPlaced = false;
            java.util.ArrayList<String> tpErrors = new java.util.ArrayList<>();
            try {
                v9522SyncTime();
                if (!sp.getBoolean("v9518_signal_active_" + d.symbol, false)) throw new Exception("Sinyal artık aktif değil.");
                if (System.currentTimeMillis() - signalTs > 8L*60L*1000L) throw new Exception("Sinyal zaman aşımına uğradı.");
                if (sp.getLong("v9522_order_sent_signal_" + d.symbol, -1L) == signalTs) throw new Exception("Bu sinyal daha önce gönderildi.");

                java.util.LinkedHashMap<String,String> lp = new java.util.LinkedHashMap<>();
                lp.put("symbol", d.symbol); lp.put("leverage", Integer.toString(d.leverage));
                v9522Http("POST", "/fapi/v1/leverage", lp, true);

                String entrySide = "LONG".equalsIgnoreCase(d.side) ? "BUY" : "SELL";
                java.util.LinkedHashMap<String,String> ep = v9522BaseOrder(d, entrySide);
                ep.put("type", "MARKET"); ep.put("quantity", d.qtyText); ep.put("newOrderRespType", "RESULT");
                org.json.JSONObject er = new org.json.JSONObject(v9522Http("POST", "/fapi/v1/order", ep, true));
                String exq = er.optString("executedQty", d.qtyText);
                try { if (Double.parseDouble(exq) > 0) filledQty = v9522StepText(Double.parseDouble(exq), d.step); } catch (Throwable ignored) {}
                entryFilled = true;
                sp.edit().putLong("v9522_order_sent_signal_" + d.symbol, signalTs).apply();

                try { v9522Algo(d, "STOP_MARKET", d.stop, null, true); stopPlaced = true; }
                catch (Throwable stopEx) {
                    v9522EmergencyClose(d, filledQty);
                    throw new Exception("STOP koruması kurulamadı; güvenlik için pozisyonu piyasa emriyle kapatma denendi. " + stopEx.getMessage());
                }

                try { v9522Algo(d, "TAKE_PROFIT_MARKET", d.tp1, d.q1Text, false); } catch (Throwable ex) { tpErrors.add("TP1: " + ex.getMessage()); }
                try { v9522Algo(d, "TAKE_PROFIT_MARKET", d.tp2, d.q2Text, false); } catch (Throwable ex) { tpErrors.add("TP2: " + ex.getMessage()); }
                try { v9522Algo(d, "TAKE_PROFIT_MARKET", d.tp3, d.q3Text, false); } catch (Throwable ex) { tpErrors.add("TP3: " + ex.getMessage()); }

                String result = tpErrors.isEmpty()
                        ? "EMİRLER HAZIR • Giriş gerçekleşti • STOP + TP1/TP2/TP3 gönderildi. Binance'ta pozisyonu kontrol edin."
                        : "GİRİŞ + STOP AKTİF. Bazı TP emirleri kurulamadı; STOP pozisyonu koruyor. Binance'ta TP'leri manuel tamamlayın: " + android.text.TextUtils.join(" | ", tpErrors);
                final String rr = result;
                runOnUiThread(() -> new android.app.AlertDialog.Builder(this)
                        .setTitle("BINANCE EMİR SONUCU").setMessage(rr).setPositiveButton("TAMAM", null).show());
            } catch (Throwable ex) {
                final String msg = ex.getMessage();
                final boolean en = entryFilled, st = stopPlaced;
                runOnUiThread(() -> new android.app.AlertDialog.Builder(this)
                        .setTitle("EMİR HATASI")
                        .setMessage((en ? "Giriş emri gönderildi. " : "Giriş emri gönderilmedi. ") +
                                (st ? "STOP koruması aktif olabilir. " : "") + msg +
                                "\n\nBinance Futures pozisyon/emir ekranını hemen kontrol edin.")
                        .setNegativeButton("KAPAT", null)
                        .setPositiveButton("BINANCE'I AÇ", (d2,w2) -> v9522OpenExactFutures(d.symbol)).show());
            } finally {
                sp.edit().putBoolean("v9522_order_inflight_" + d.symbol, false).apply();
            }
        });
    }
'''
    m = m[:pos] + helper + '\n' + m[pos:]

if 'V9522_API_ORDER' not in m:
    p = m.find('\n', m.find('public class '))
    if p < 0: p = 0
    m = m[:p+1] + '    // V9522_API_ORDER\n' + m[p+1:]
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 36', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.22'", b, count=1)
BUILD.write_text(b)

mf = MAIN.read_text(); bf = BUILD.read_text()
checks = [
    ('V9522_API_ORDER' in mf, 'API order marker'),
    ('V9522_API_SETTINGS_BUTTON' in mf, 'API settings button'),
    ('AndroidKeyStore' in mf and 'AES/GCM/NoPadding' in mf, 'Keystore encryption'),
    ('v9522ShowTradeTicket' in mf and 'SON EMİR ONAYI' in mf, 'manual final confirmation'),
    ('/fapi/v1/leverage' in mf and '/fapi/v1/order' in mf and '/fapi/v1/algoOrder' in mf, 'Binance Futures order endpoints'),
    ('STOP_MARKET' in mf and mf.count('TAKE_PROFIT_MARKET') >= 3, 'protective STOP and TPs'),
    ('v9522EmergencyClose' in mf, 'unprotected-entry fail-safe'),
    ('order_sent_signal_' in mf and 'order_inflight_' in mf, 'duplicate-order locks'),
    ('%0,50' in mf or '%0.50' in mf, 'entry deviation guard'),
    ('versionCode 36' in bf and "versionName '9.5.22'" in bf, 'version bump'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok: raise SystemExit('v9.5.22b sanity failed: ' + name)
print('v9.5.22b OK: encrypted Binance API settings + in-app market order ticket + manual final confirmation + STOP/TP protection.')
