package com.antikharita.turkiye;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private static final long CACHE_TTL_MS = 30L * 60L * 1000L;
    private WebView webView;
    private LocationManager locationManager;
    private final Map<String, CacheEntry> overpassCache = new ConcurrentHashMap<>();
    private final Map<String, CacheEntry> osmCache = new ConcurrentHashMap<>();
    private final ExecutorService requestPool = Executors.newFixedThreadPool(2);
    private final ExecutorService networkPool = Executors.newFixedThreadPool(6);
    private volatile long latestOverpassRequest = 0L;

    private static class CacheEntry {
        final String payload;
        final String source;
        final long time;
        CacheEntry(String payload, String source) {
            this.payload = payload;
            this.source = source;
            this.time = System.currentTimeMillis();
        }
    }

    private static class FetchResult {
        final String payload;
        final String source;
        final String error;
        FetchResult(String payload, String source, String error) {
            this.payload = payload;
            this.source = source;
            this.error = error;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setUserAgentString(settings.getUserAgentString() + " AntikHaritaTurkiye/12.0");
        webView.clearCache(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidApp");
        webView.loadUrl("file:///android_asset/index-v12.html");
    }

    public class Bridge {
        @JavascriptInterface
        public void fetchOverpassV3(String requestId, String query) {
            if (query == null || query.trim().isEmpty()) return;
            final String id = requestId == null ? "0" : requestId;
            final long numericId = parseId(id);
            latestOverpassRequest = Math.max(latestOverpassRequest, numericId);

            CacheEntry cached = overpassCache.get(query);
            if (cached != null && System.currentTimeMillis() - cached.time < CACHE_TTL_MS) {
                if (numericId == latestOverpassRequest) {
                    deliverOverpassV3(id, cached.payload, "önbellek • " + cached.source);
                }
                return;
            }
            requestPool.execute(() -> fetchOverpassParallel(id, numericId, query));
        }

        @JavascriptInterface
        public void fetchOsmMapV2(String requestId, String bbox) {
            if (bbox == null || bbox.trim().isEmpty()) return;
            final String id = requestId == null ? "0" : requestId;
            CacheEntry cached = osmCache.get(bbox);
            if (cached != null && System.currentTimeMillis() - cached.time < CACHE_TTL_MS) {
                deliverOsmMapV2(id, cached.payload);
                return;
            }
            requestPool.execute(() -> {
                try {
                    String url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + URLEncoder.encode(bbox, "UTF-8");
                    String raw = getText(url, "application/xml,text/xml", 5000, 10000);
                    osmCache.put(bbox, new CacheEntry(raw, "api.openstreetmap.org"));
                    deliverOsmMapV2(id, raw);
                } catch (Exception e) {
                    deliverOsmMapErrorV2(id, shortError(e));
                }
            });
        }

        @JavascriptInterface
        public void geocode(String text) {
            if (text == null || text.trim().isEmpty()) return;
            requestPool.execute(() -> {
                try {
                    String q = URLEncoder.encode(text.trim(), "UTF-8");
                    String raw = getText(
                        "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=12&countrycodes=tr&q=" + q,
                        "application/json", 5000, 10000
                    );
                    runJs("window.onNativeGeocode(" + JSONObject.quote(raw) + ")");
                } catch (Exception e) {
                    runJs("window.onNativeGeocodeError(" + JSONObject.quote(shortError(e)) + ")");
                }
            });
        }

        @JavascriptInterface
        public void requestLocation() {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                        && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                    return;
                }
                fetchLocation();
            });
        }
    }

    private void fetchOverpassParallel(String id, long numericId, String query) {
        if (numericId != latestOverpassRequest) return;
        String[] endpoints = {
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
            "https://overpass-api.de/api/interpreter"
        };
        CompletionService<FetchResult> completion = new ExecutorCompletionService<>(networkPool);
        for (String endpoint : endpoints) {
            completion.submit(() -> {
                try {
                    String body = "data=" + URLEncoder.encode(query, "UTF-8");
                    String payload = postForm(endpoint, body, 3500, 8000);
                    return new FetchResult(payload, host(endpoint), null);
                } catch (Exception e) {
                    return new FetchResult(null, host(endpoint), shortError(e));
                }
            });
        }

        long deadline = System.currentTimeMillis() + 9000L;
        StringBuilder errors = new StringBuilder();
        for (int i = 0; i < endpoints.length; i++) {
            if (numericId != latestOverpassRequest) return;
            try {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) break;
                Future<FetchResult> future = completion.poll(remaining, TimeUnit.MILLISECONDS);
                if (future == null) break;
                FetchResult result = future.get();
                if (result.payload != null && !result.payload.isEmpty()) {
                    overpassCache.put(query, new CacheEntry(result.payload, result.source));
                    if (numericId == latestOverpassRequest) {
                        deliverOverpassV3(id, result.payload, result.source);
                    }
                    return;
                }
                if (result.error != null) {
                    if (errors.length() > 0) errors.append(" | ");
                    errors.append(result.source).append(": ").append(result.error);
                }
            } catch (Exception e) {
                if (errors.length() > 0) errors.append(" | ");
                errors.append(shortError(e));
            }
        }
        if (numericId == latestOverpassRequest) {
            deliverOverpassErrorV3(id, errors.length() == 0 ? "Canlı veri sunucuları yanıt vermedi" : errors.toString());
        }
    }

    private long parseId(String id) {
        try { return Long.parseLong(id); } catch (Exception e) { return 0L; }
    }

    private void deliverOverpassV3(String id, String payload, String source) {
        runJs("window.onNativeOverpassV3(" + JSONObject.quote(id) + "," + JSONObject.quote(payload) + "," + JSONObject.quote(source == null ? "canlı" : source) + ")");
    }

    private void deliverOverpassErrorV3(String id, String message) {
        runJs("window.onNativeOverpassErrorV3(" + JSONObject.quote(id) + "," + JSONObject.quote(message) + ")");
    }

    private void deliverOsmMapV2(String id, String payload) {
        runJs("window.onNativeOsmMapV2(" + JSONObject.quote(id) + "," + JSONObject.quote(payload) + ")");
    }

    private void deliverOsmMapErrorV2(String id, String message) {
        runJs("window.onNativeOsmMapErrorV2(" + JSONObject.quote(id) + "," + JSONObject.quote(message) + ")");
    }

    private void runJs(String js) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private String host(String address) {
        try { return new URL(address).getHost(); } catch (Exception e) { return address; }
    }

    private String shortError(Exception e) {
        String msg = e.getMessage();
        return e.getClass().getSimpleName() + (msg == null || msg.trim().isEmpty() ? "" : ": " + msg);
    }

    private String getText(String address, String accept, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        try {
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", accept);
            connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/12.0 heritage-protection-app");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return read(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    private String postForm(String address, String bodyText, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        try {
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/12.0 heritage-protection-app");
            byte[] bytes = bodyText.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return read(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    private String read(InputStream input) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }

    private void fetchLocation() {
        try {
            Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last == null) last = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null) sendLocation(last);
            LocationListener listener = new LocationListener() {
                @Override public void onLocationChanged(Location location) {
                    sendLocation(location);
                    try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                }
            };
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, null);
            } else if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, null);
            }
        } catch (SecurityException ignored) {}
    }

    private void sendLocation(Location location) {
        double a = location.getLatitude(), o = location.getLongitude();
        runJs("window.onNativeLocation(" + a + "," + o + ")");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            fetchLocation();
        }
    }

    @Override
    protected void onDestroy() {
        requestPool.shutdownNow();
        networkPool.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
