from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists(): raise SystemExit('v9.5.22d MainActivity missing')
m=MAIN.read_text()

start=m.find('    private void v9522TestApi() {')
end=m.find('    private void v9522OpenExactFutures(String sym) {', start)
if start < 0 or end < 0:
    raise SystemExit('v9.5.22d API test method anchor missing')

replacement=r'''    // V9523_API_DIAGNOSTICS
    private String v9523HttpBase(String base, String method, String path,
                                 java.util.Map<String,String> params, boolean signed) throws Exception {
        java.util.LinkedHashMap<String,String> p = new java.util.LinkedHashMap<>();
        if (params != null) p.putAll(params);
        String apiKey = null, secret = null;
        if (signed) {
            String[] cr = v9522Credentials(); apiKey = cr[0]; secret = cr[1];
            p.put("recvWindow", "10000");
            p.put("timestamp", Long.toString(System.currentTimeMillis() + v9522TimeOffset));
        }
        String q = v9522Query(p);
        if (signed) q += "&signature=" + v9522Hmac(secret, q);
        java.net.URL url = new java.net.URL(base + path + (q.isEmpty() ? "" : "?" + q));
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) url.openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(8000); c.setReadTimeout(12000);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "Futures15mAlarmPRO/9.5.22d");
        if (signed) c.setRequestProperty("X-MBX-APIKEY", apiKey);
        int code = c.getResponseCode();
        java.io.InputStream in = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
        String body = in == null ? "" : v9522Read(in);
        c.disconnect();
        if (code < 200 || code >= 300) {
            String msg = body;
            int bcode = 0;
            try {
                org.json.JSONObject j = new org.json.JSONObject(body);
                bcode = j.optInt("code", 0);
                msg = j.optString("msg", body);
            } catch (Throwable ignored) {}
            throw new Exception("HTTP " + code + " / Binance " + bcode + ": " + msg);
        }
        return body;
    }

    private String v9523Err(Throwable ex) {
        String s = ex == null ? "Bilinmeyen hata" : String.valueOf(ex.getMessage());
        if (s.contains("-2015")) return s + "\nAnahtar/IP/yetki/hesap modu uyuşmazlığı.";
        if (s.contains("-1022")) return s + "\nAPI Key kabul edildi fakat imza/Secret doğrulanmadı.";
        if (s.contains("-1021")) return s + "\nSaat farkı/recvWindow sorunu.";
        return s;
    }

    private void v9523SyncFuturesTime() throws Exception {
        String b = v9523HttpBase("https://fapi.binance.com", "GET", "/fapi/v1/time", null, false);
        long server = new org.json.JSONObject(b).getLong("serverTime");
        v9522TimeOffset = server - System.currentTimeMillis();
    }

    private void v9522TestApi() {
        Toast.makeText(this, "Binance API ayrıntılı test başlatıldı...", Toast.LENGTH_SHORT).show();
        v9522Io.execute(() -> {
            String fapi = null, spot = null, papi = null;
            try { v9522Credentials(); }
            catch (Throwable ex) {
                String msg = "API TEST HATASI: " + v9523Err(ex);
                runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
                return;
            }
            try { v9523SyncFuturesTime(); }
            catch (Throwable ex) {
                String msg = "AĞ TESTİ BAŞARISIZ\nFutures sunucusuna ulaşılamadı: " + v9523Err(ex);
                runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
                return;
            }

            try {
                String raw = v9523HttpBase("https://fapi.binance.com", "GET", "/fapi/v1/accountConfig", null, true);
                org.json.JSONObject a = new org.json.JSONObject(raw);
                boolean can = a.optBoolean("canTrade", false);
                v9522Prefs().edit().putString("v9522_api_mode", "FAPI").apply();
                String msg = "API BAĞLANTISI BAŞARILI\nUSDⓈ-M Futures (FAPI) doğrulandı.\nİşlem yetkisi: " + (can ? "UYGUN" : "YOK");
                runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
                return;
            } catch (Throwable ex) { fapi = v9523Err(ex); }

            try { v9523HttpBase("https://api.binance.com", "GET", "/api/v3/account", null, true); spot = "BAŞARILI"; }
            catch (Throwable ex) { spot = v9523Err(ex); }

            try {
                String raw = v9523HttpBase("https://papi.binance.com", "GET", "/papi/v1/um/account", null, true);
                if (raw != null && raw.length() > 1) {
                    papi = "BAŞARILI";
                    v9522Prefs().edit().putString("v9522_api_mode", "PAPI").apply();
                }
            } catch (Throwable ex) { papi = v9523Err(ex); }

            final String ff = fapi, fs = spot, fp = papi;
            StringBuilder out = new StringBuilder();
            out.append("API TANILAMA\n");
            out.append("Futures sunucu: ULAŞILDI\n");
            out.append("USDⓈ-M FAPI: ").append(ff).append("\n");
            out.append("Spot anahtar testi: ").append(fs).append("\n");
            out.append("Portfolio Margin UM: ").append(fp);
            if ("BAŞARILI".equals(fp)) {
                out.append("\n\nAPI AKTİF. Hesap Portfolio Margin modunda görünüyor. Mevcut FAPI emir motoruyla otomatik emir GÖNDERİLMEYECEK; PAPI uyarlaması gerekir.");
            } else if ("BAŞARILI".equals(fs)) {
                out.append("\n\nAPI AKTİF. Spot erişimi doğrulandı fakat USDⓈ-M Futures erişimi reddedildi. Futures yetkisi/hesap modu kontrol edilmeli.");
            } else {
                out.append("\n\nAnahtarın başka yerde çalışması mümkündür; bu telefondaki IP whitelist veya kullanılan Binance hesap ortamı farklı olabilir.");
            }
            String msg = out.toString();
            runOnUiThread(() -> new android.app.AlertDialog.Builder(this)
                    .setTitle("Binance API Tanılama")
                    .setMessage(msg)
                    .setPositiveButton("KAPAT", null)
                    .show());
        });
    }

'''

m=m[:start]+replacement+m[end:]
MAIN.write_text(m)

f=MAIN.read_text()
checks=[
 ('V9523_API_DIAGNOSTICS' in f,'diagnostic marker'),
 ('/fapi/v1/accountConfig' in f,'FAPI diagnostic'),
 ('/api/v3/account' in f,'Spot diagnostic'),
 ('/papi/v1/um/account' in f,'Portfolio diagnostic'),
 ('HTTP " + code + " / Binance " + bcode' in f,'Binance numeric error'),
]
for ok,name in checks:
    print(('OK   ' if ok else 'FAIL '),name)
    if not ok: raise SystemExit('v9.5.22d sanity failed: '+name)
print('v9.5.22d OK: staged Binance API diagnostics + account-mode detection.')
