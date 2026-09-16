package com.futuresalarm.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// V9577_OPTIONAL_PC_BRAINHUB: read-only market context; mobile BrainCore remains available.
public final class BrainHubClient {
    private static final String PREF = "v9577_brainhub";
    private static final String ALIAS = "futures_alarm_brainhub_token_v1";
    private BrainHubClient() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREF, Context.MODE_PRIVATE); }
    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        KeyStore.Entry old = ks.getEntry(ALIAS, null);
        if (old instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry)old).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return gen.generateKey();
    }
    public static void save(Context c, String endpoint, String newToken) throws Exception {
        endpoint = endpoint == null ? "" : endpoint.trim().replaceAll("/+$", "");
        if (!endpoint.isEmpty()) validate(endpoint);
        SharedPreferences.Editor ed = prefs(c).edit().putString("endpoint", endpoint);
        if (newToken != null && !newToken.trim().isEmpty()) {
            String token = newToken.trim();
            if (token.length() < 32 || token.length() > 128) throw new Exception("BrainHub token 32-128 karakter olmalı");
            Cipher enc = Cipher.getInstance("AES/GCM/NoPadding"); enc.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = enc.getIV(), cipher = enc.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] packed = new byte[iv.length + cipher.length];
            System.arraycopy(iv,0,packed,0,iv.length);System.arraycopy(cipher,0,packed,iv.length,cipher.length);
            ed.putString("token", Base64.encodeToString(packed, Base64.NO_WRAP));
        }
        ed.apply();
    }
    private static String token(Context c) throws Exception {
        String encoded = prefs(c).getString("token", "");
        if (encoded == null || encoded.isEmpty()) return "";
        byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
        if (packed.length < 29) throw new Exception("BrainHub token kaydı bozuk");
        Cipher dec = Cipher.getInstance("AES/GCM/NoPadding");
        dec.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, packed, 0, 12));
        return new String(dec.doFinal(packed, 12, packed.length - 12), StandardCharsets.UTF_8);
    }
    private static void validate(String endpoint) throws Exception {
        URI uri = new URI(endpoint);
        String scheme = uri.getScheme(), host = uri.getHost();
        if (host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || (uri.getPath() != null && !uri.getPath().isEmpty())) throw new Exception("BrainHub adresi kök URL olmalı");
        if (!"https".equalsIgnoreCase(scheme)) throw new Exception("BrainHub için HTTPS gerekli");
    }
    public static boolean configured(Context c) {
        String e = prefs(c).getString("endpoint", "");
        return e != null && !e.isEmpty() && prefs(c).contains("token");
    }
    private static JSONObject get(Context c, String path) throws Exception {
        String base = prefs(c).getString("endpoint", "");
        validate(base);
        if (!path.startsWith("/") || path.contains("..")) throw new Exception("BrainHub yolu geçersiz");
        String bearer = token(c);
        if (bearer.isEmpty()) throw new Exception("BrainHub token gerekli");
        HttpURLConnection conn = (HttpURLConnection)new URL(base + path).openConnection();
        conn.setRequestMethod("GET");conn.setConnectTimeout(4000);conn.setReadTimeout(22000);
        conn.setRequestProperty("Authorization", "Bearer " + bearer);
        conn.setRequestProperty("Accept", "application/json");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("BrainHub HTTP " + code);
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096]; int n;
                while ((n=in.read(buf))!=-1) { out.write(buf,0,n); if (out.size()>1048576) throw new Exception("BrainHub yanıtı çok büyük"); }
                return new JSONObject(out.toString("UTF-8"));
            }
        } finally { conn.disconnect(); }
    }
    private static void check(Context c) throws Exception {
        JSONObject health = get(c, "/health");
        if (!health.optBoolean("ok") || !"brainhub-pro-1".equals(health.optString("version")) || !"ADVISORY_ONLY".equals(health.optString("execution"))) throw new Exception("BrainHub sürümü veya güvenlik modu uygun değil");
    }
    public static String dashboard(Context c) throws Exception {
        check(c);
        JSONObject global = get(c, "/context/global"), scan = get(c, "/scanner");
        JSONObject cap = global.optJSONObject("marketCap");
        StringBuilder b = new StringBuilder("PC BRAIN HUB • analiz modu\n");
        b.append("BTC 15m: ").append(frame(global.optJSONObject("btc"),"15m")).append("\n");
        b.append("ETH 15m: ").append(frame(global.optJSONObject("eth"),"15m")).append("\n");
        b.append("ETH/BTC 15m: ").append(frame(global.optJSONObject("ethbtc"),"15m")).append("\n");
        b.append("USDT.D / TOTAL2 / TOTAL3: ").append(cap != null && cap.optBoolean("available") ? cap.toString() : "veri yok").append("\n\n");
        b.append("EARLY_TOP5:\n");
        JSONArray early = scan.optJSONArray("earlyTop5");
        if (early == null || early.length()==0) b.append("Şu an doğrulanmış erken aday yok.\n");
        else for(int i=0;i<Math.min(5,early.length());i++) b.append(early.optJSONObject(i).toString()).append('\n');
        b.append("\nİşlem yetkisi: YOK • Telefonun yerel BrainCore'u bağlantı kesilince kullanılabilir.");
        return b.toString();
    }
    private static String frame(JSONObject asset,String tf) {
        JSONObject t = asset == null ? null : asset.optJSONObject("frames");
        JSONObject f = t == null ? null : t.optJSONObject(tf);
        return f != null && f.optBoolean("available") ? "TREND="+f.optString("trend")+" CLOSE="+f.optString("close")+" RSI="+f.optString("rsi14") : "veri yok";
    }
    public static String symbolSnapshot(Context c,String symbol) throws Exception {
        if (symbol==null || !symbol.matches("[A-Z0-9]{2,28}USDT")) throw new Exception("Sembol geçersiz");
        check(c);
        JSONObject market = get(c, "/context/symbol?symbol=" + symbol);
        JSONObject global = get(c, "/context/global");
        return "PC BRAIN HUB / " + symbol + " • analiz, emir değil\n" + market.toString() + "\nGLOBAL:\n" + global.toString();
    }
    public static String endpoint(Context c) { return prefs(c).getString("endpoint", ""); }
}
