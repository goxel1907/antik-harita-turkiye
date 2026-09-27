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
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// V9577_OPTIONAL_PC_BRAINHUB compatibility marker retained for the v9.5.78 build bootstrap.
// V9579_PC_LIVE_BRIDGE: PC owns Binance credentials and execution; Android sends authenticated intents only.
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
    private static JSONObject request(Context c, String method, String path, JSONObject payload, boolean allowError) throws Exception {
        String base = prefs(c).getString("endpoint", "");
        validate(base);
        if (!path.startsWith("/") || path.contains("..")) throw new Exception("BrainHub yolu geçersiz");
        String bearer = token(c);
        if (bearer.isEmpty()) throw new Exception("BrainHub token gerekli");
        HttpURLConnection conn = (HttpURLConnection)new URL(base + path).openConnection();
        conn.setRequestMethod(method);conn.setConnectTimeout(4000);conn.setReadTimeout(path.equals("/live/execute") ? 120000 : 22000);
        conn.setRequestProperty("Authorization", "Bearer " + bearer);
        conn.setRequestProperty("Accept", "application/json");
        if (payload != null) {
            byte[] data = payload.toString().getBytes(StandardCharsets.UTF_8);
            if (data.length > 262144) throw new Exception("BrainHub istek gövdesi çok büyük");
            conn.setDoOutput(true);conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setFixedLengthStreamingMode(data.length);
            try (OutputStream out = conn.getOutputStream()) { out.write(data); }
        }
        try {
            int code = conn.getResponseCode();
            InputStream source = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            if (source == null) throw new Exception("BrainHub HTTP " + code);
            JSONObject body;
            try (InputStream in = source; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096]; int n;
                while ((n=in.read(buf))!=-1) { out.write(buf,0,n); if (out.size()>1048576) throw new Exception("BrainHub yanıtı çok büyük"); }
                String raw = out.toString("UTF-8");
                body = raw.trim().isEmpty() ? new JSONObject() : new JSONObject(raw);
            }
            if (code < 200 || code >= 300) {
                if (allowError) { body.put("_httpStatus", code); return body; }
                String msg = body.optString("error", "");
                if (msg.isEmpty()) {
                    JSONArray reasons = body.optJSONArray("reasons");
                    msg = reasons != null && reasons.length() > 0 ? reasons.optString(0, "") : "";
                }
                throw new Exception("BrainHub HTTP " + code + (msg.isEmpty() ? "" : " • " + msg));
            }
            return body;
        } finally { conn.disconnect(); }
    }
    private static JSONObject get(Context c, String path) throws Exception { return request(c, "GET", path, null, false); }
    private static JSONObject post(Context c, String path, JSONObject payload, boolean allowError) throws Exception { return request(c, "POST", path, payload, allowError); }

    private static JSONObject check(Context c) throws Exception {
        JSONObject health = get(c, "/health");
        String mode = health.optString("execution");
        boolean modeOk = "ADVISORY_ONLY".equals(mode) || "LIVE_ARMED_PER_ORDER_GRANT_REQUIRED".equals(mode);
        if (!health.optBoolean("ok") || !"brainhub-pro-1".equals(health.optString("version")) || !modeOk) throw new Exception("BrainHub sürümü veya güvenlik modu uygun değil");
        return health;
    }
    // V95106_ATTENTION_SYNC: sends only sanitized public discovery scores to the paired PC.
    public static void syncAttentionSnapshot(Context c, JSONObject root) {
        if(c==null||root==null||!configured(c))return;
        try {
            long now=System.currentTimeMillis();
            SharedPreferences p=prefs(c);
            long last=p.getLong("attention_sync_at",0L);
            long srcAt=root.optLong("updatedAt",0L);
            long lastSrc=p.getLong("attention_sync_source_at",0L);
            if(srcAt>0&&srcAt==lastSrc&&now-last<60000L)return;
            JSONArray rows=root.optJSONArray("rows"),safe=new JSONArray();
            if(rows!=null)for(int i=0;i<Math.min(12,rows.length());i++){
                JSONObject r=rows.optJSONObject(i);if(r==null)continue;
                String symbol=r.optString("symbol","").trim().toUpperCase(java.util.Locale.US);
                if(!symbol.matches("[A-Z0-9]{1,28}USDT"))continue;
                JSONObject x=new JSONObject();
                x.put("symbol",symbol);
                x.put("talkScore",r.optInt("talkScore",0));
                x.put("earlyMoveScore",r.optInt("earlyMoveScore",0));
                x.put("sourceConfidence",r.optInt("sourceConfidence",0));
                x.put("preMoveState",r.optString("preMoveState",""));
                x.put("direction",r.optString("direction",""));
                safe.put(x);
            }
            JSONObject payload=new JSONObject();
            payload.put("updatedAt",srcAt>0?srcAt:now);
            payload.put("rows",safe);
            JSONObject out=post(c,"/scanner/attention",payload,true);
            if(out.optInt("_httpStatus",200)<400){
                p.edit().putLong("attention_sync_at",now)
                    .putLong("attention_sync_source_at",srcAt).apply();
            }
        } catch(Throwable ignored) {}
    }

    public static JSONObject liveStatus(Context c) throws Exception {
        check(c);
        try { syncAttentionSnapshot(c,new JSONObject(V9542AttentionRadar.latestJson(c))); } catch(Throwable ignored) {}
        JSONObject status=get(c, "/live/status");
        JSONObject jev=status.optJSONObject("jev"), budget=jev==null?null:jev.optJSONObject("budget");
        String label=jev==null?"Jev durumu alınamadı":("Jev: "+(jev.optBoolean("configured")?"hazır • veto denetimi":"yapılandırma/anahtar eksik"));
        if(budget!=null)label+=String.format(java.util.Locale.US," • bugün $%.4f / $%.2f",budget.optDouble("spentUsd",0),budget.optDouble("dailyCapUsd",0));
        c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE).edit().putString("v9597_jev_status",label)
            .putString("v9598_jev",jev==null?"{}":jev.toString())
            .putString("v9598_progress",status.optJSONObject("visionProgress")==null?"{}":status.optJSONObject("visionProgress").toString())
            .putString("v9598_openrouter_billing",status.optJSONObject("openRouterBilling")==null?"{}":status.optJSONObject("openRouterBilling").toString())
            .putString("v9599_position_manager",status.optJSONObject("positionManager")==null?"{}":status.optJSONObject("positionManager").toString())
            .putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString()).apply();
        return status;
    }
    public static JSONObject liveAccount(Context c) throws Exception {
        check(c);
        return get(c, "/live/account");
    }
    // CLAUDE_V113_ANDROID_LIVE_TRUTH: read-only PC position ledger (open Binance positions + closed-trade outcomes).
    // GET only; Android never sends order/cancel/close through this path.
    public static JSONObject livePositions(Context c) throws Exception {
        check(c);
        return get(c, "/live/positions");
    }
    public static JSONObject leaderAutoStatus(Context c) throws Exception {
        check(c);
        return get(c, "/live/leader-auto");
    }
    public static JSONObject configureLeaderAuto(Context c, boolean enabled, double marginQuote, int leverage, int maxOpenPositions, boolean allowLong, boolean allowShort) throws Exception {
        check(c);
        JSONObject body = new JSONObject();
        body.put("enabled", enabled);
        body.put("marginQuote", marginQuote);
        body.put("leverage", leverage);
        body.put("maxOpenPositions", maxOpenPositions);
        body.put("allowLong", allowLong);
        body.put("allowShort", allowShort);
        return post(c, "/live/leader-auto", body, true);
    }
    // R2539_ANDROID_PC_ONLY_FAIL_CLOSED:
    // Android can ARM/DISARM/configure/read telemetry, but it can never originate an order.
    // The PC BrainHub scheduler is the sole entry executor.
    public static JSONObject liveExecute(Context c, JSONObject intent) throws Exception {
        JSONObject out = new JSONObject();
        out.put("ok", false);
        out.put("orderPlaced", false);
        out.put("liveAllowed", false);
        out.put("execution", "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY");
        out.put("reasons", new JSONArray().put("ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY"));
        return out;
    }
    public static JSONObject liveArm(Context c) throws Exception {
        check(c);
        JSONObject body = new JSONObject();body.put("confirm", "LIVE");
        return post(c, "/live/arm", body, true);
    }
    public static JSONObject liveDisarm(Context c, String reason) throws Exception {
        JSONObject body = new JSONObject();body.put("reason", reason == null ? "ANDROID_USER_DISARM" : reason);
        return post(c, "/live/disarm", body, true);
    }
    public static String dashboard(Context c) throws Exception {
        JSONObject health = check(c);
        JSONObject global = get(c, "/context/global"), scan = get(c, "/scanner");
        JSONObject cap = global.optJSONObject("marketCap");
        JSONObject live = get(c, "/live/status");
        StringBuilder b = new StringBuilder("PC BRAIN HUB • ").append(live.optBoolean("armed") ? "CANLI İŞLEM AÇIK" : "analiz modu").append("\n");
        b.append("BTC 15m: ").append(frame(global.optJSONObject("btc"),"15m")).append("\n");
        b.append("ETH 15m: ").append(frame(global.optJSONObject("eth"),"15m")).append("\n");
        b.append("ETH/BTC 15m: ").append(frame(global.optJSONObject("ethbtc"),"15m")).append("\n");
        b.append("USDT.D / TOTAL2 / TOTAL3: ").append(cap != null && cap.optBoolean("available") ? cap.toString() : "veri yok").append("\n\n");
        b.append("EARLY_TOP5:\n");
        JSONArray early = scan.optJSONArray("earlyTop5");
        if (early == null || early.length()==0) b.append("Şu an doğrulanmış erken aday yok.\n");
        else for(int i=0;i<Math.min(5,early.length());i++) b.append(early.optJSONObject(i).toString()).append('\n');
        b.append("\nİşlem yetkisi: ").append(live.optBoolean("armed") ? "PC ARMED • her emir için deterministic grant gerekir" : "YOK");
        return b.toString();
    }
    private static String frame(JSONObject asset,String tf) {
        JSONObject t = asset == null ? null : asset.optJSONObject("frames");
        JSONObject f = t == null ? null : t.optJSONObject(tf);
        return f != null && f.optBoolean("available") ? "EĞİLİM="+("UP".equals(f.optString("trend"))?"YÜKSELİŞ":"DOWN".equals(f.optString("trend"))?"DÜŞÜŞ":"KARMA")+" KAPANIŞ="+f.optString("close")+" RSI="+f.optString("rsi14") : "veri yok";
    }
    public static String symbolSnapshot(Context c,String symbol) throws Exception {
        if (symbol==null || !symbol.matches("[A-Z0-9]{2,28}USDT")) throw new Exception("Sembol geçersiz");
        check(c);
        JSONObject market = get(c, "/context/symbol?symbol=" + symbol);
        JSONObject global = get(c, "/context/global");
        return "PC BRAIN HUB / " + symbol + " • analiz; LIVE emri yalnız /live/execute güvenlik zinciriyle\n" + market.toString() + "\nGLOBAL:\n" + global.toString();
    }
    public static String endpoint(Context c) { return prefs(c).getString("endpoint", ""); }

    // Analysis export only: reads public market charts through the paired PC.
    public static android.graphics.Bitmap reviewCharts(Context c,String symbol) throws Exception {
        if(symbol==null||!symbol.matches("[A-Z0-9]{1,28}USDT"))throw new Exception("Sembol geçersiz");
        String base=endpoint(c);validate(base);String bearer=token(c);
        if(bearer.isEmpty())throw new Exception("BrainHub token gerekli");
        String[] frames={"1d","4h","1h","45m","30m","15m","5m","3m","1m"};
        android.graphics.Bitmap sheet=android.graphics.Bitmap.createBitmap(3840,2160,android.graphics.Bitmap.Config.RGB_565);
        android.graphics.Canvas canvas=new android.graphics.Canvas(sheet);
        try {
            for(int i=0;i<frames.length;i++) {
                HttpURLConnection conn=(HttpURLConnection)new URL(base+"/chart/png?symbol="+symbol+"&tf="+frames[i]+"&bars=128&mode=annotated").openConnection();
                conn.setConnectTimeout(4000);conn.setReadTimeout(22000);conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("Authorization","Bearer "+bearer);
                try {
                    if(conn.getResponseCode()!=200)throw new Exception(frames[i]+" PC grafiği alınamadı");
                    byte[] bytes;
                    try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                        byte[] buf=new byte[8192];int n;
                        while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>2097152)throw new Exception("PC grafiği çok büyük");}
                        bytes=out.toByteArray();
                    }
                    android.graphics.BitmapFactory.Options bounds=new android.graphics.BitmapFactory.Options();
                    bounds.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
                    if(bounds.outWidth!=1280||bounds.outHeight!=720)throw new Exception("PC grafik boyutu geçersiz");
                    android.graphics.Bitmap chart=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length);
                    if(chart==null)throw new Exception("PC grafiği çözülemedi");
                    try{canvas.drawBitmap(chart,(i%3)*1280,(i/3)*720,null);}finally{chart.recycle();}
                } finally {conn.disconnect();}
            }
            return sheet;
        } catch(Exception ex){sheet.recycle();throw ex;}
    }

    public static JSONObject reviewContext(Context c,String symbol) throws Exception {
        if(symbol==null||!symbol.matches("[A-Z0-9]{1,28}USDT"))throw new Exception("Sembol geçersiz");
        JSONObject market=get(c,"/context/symbol?symbol="+symbol);
        JSONObject result=new JSONObject(),frames=new JSONObject();
        // BrainHub /context/symbol contract uses "timeframes". Keep "frames" only
        // as a backward-compatible fallback for an older paired PC.
        JSONObject raw=market.optJSONObject("timeframes");
        if(raw==null)raw=market.optJSONObject("frames");
        String[] order={"1m","3m","5m","15m","30m","45m","1h","4h","1d"};
        String[] fields={
            "available","frame","asOf","closedCandles","close","trend","rsi14","atr14","atrPct",
            "ema20","ema50","patterns","candle","swingStructure","smcContext","liquidity",
            "buySideLiquidity","sellSideLiquidity","recentFairValueGaps","breakOfStructure",
            "prior20High","prior20Low","returnPct","opportunity"
        };
        for(String tf:order){
            JSONObject frame=raw==null?null:raw.optJSONObject(tf),safe=new JSONObject();
            if(frame!=null){
                for(String field:fields)if(frame.has(field))safe.put(field,frame.get(field));
                if(!safe.has("available"))safe.put("available",frame.optBoolean("available",false));
            } else safe.put("available",false);
            frames.put(tf,safe);
        }
        result.put("symbol",symbol);
        result.put("receivedAt",System.currentTimeMillis());
        result.put("marketGeneratedAt",market.optString("generatedAt",""));
        result.put("frames",frames);
        if(market.has("microstructure"))result.put("microstructure",market.get("microstructure"));
        if(market.has("streamHealth"))result.put("streamHealth",market.get("streamHealth"));
        if(market.has("limitations"))result.put("limitations",market.get("limitations"));
        result.put("note","Chart and data requests have separate capture times; refresh before any decision. 45m is synthetic, forming is context only. No account or credentials included.");
        return result;
    }
}
