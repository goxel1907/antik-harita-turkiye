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
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private static final long CACHE_TTL_MS = 20L * 60L * 1000L;
    private WebView webView;
    private LocationManager locationManager;
    private final ExecutorService ioPool = Executors.newFixedThreadPool(4);
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private volatile long latestHeritageRequest = 0L;

    private static class CacheEntry {
        final String payload;
        final String format;
        final String source;
        final long time;
        CacheEntry(String payload, String format, String source) {
            this.payload = payload;
            this.format = format;
            this.source = source;
            this.time = System.currentTimeMillis();
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
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setUserAgentString(settings.getUserAgentString() + " AntikHaritaTurkiye/13.0");
        webView.clearCache(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidApp");
        webView.loadUrl("file:///android_asset/index-v13.html");
    }

    public class Bridge {
        @JavascriptInterface
        public void fetchLocalHeritageV4(String requestId, double lat, double lon, int zoom) {
            final String id = requestId == null ? "0" : requestId;
            final long numericId = parseId(id);
            latestHeritageRequest = Math.max(latestHeritageRequest, numericId);
            ioPool.execute(() -> fetchHeritage(id, numericId, lat, lon, zoom));
        }

        @JavascriptInterface
        public void geocodeV4(String text) {
            if (text == null || text.trim().isEmpty()) return;
            ioPool.execute(() -> {
                try {
                    String q = URLEncoder.encode(text.trim(), "UTF-8");
                    String raw = getText(
                            "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&countrycodes=tr&q=" + q,
                            "application/json", 6000, 12000);
                    runJs("window.onNativeGeocodeV4(" + JSONObject.quote(raw) + ")");
                } catch (Exception e) {
                    runJs("window.onNativeGeocodeErrorV4(" + JSONObject.quote(shortError(e)) + ")");
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

    private void fetchHeritage(String id, long numericId, double lat, double lon, int zoom) {
        if (numericId != latestHeritageRequest) return;
        int safeZoom = Math.max(13, Math.min(18, zoom));
        String key = safeZoom + ":" + Math.round(lat * 250.0) + ":" + Math.round(lon * 250.0);
        CacheEntry cached = cache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.time < CACHE_TTL_MS) {
            if (numericId == latestHeritageRequest) deliverHeritage(id, cached.payload, cached.format, "önbellek • " + cached.source);
            return;
        }

        double radiusKm;
        if (safeZoom <= 13) radiusKm = 1.25;
        else if (safeZoom == 14) radiusKm = 0.90;
        else if (safeZoom == 15) radiusKm = 0.60;
        else if (safeZoom == 16) radiusKm = 0.38;
        else radiusKm = 0.25;

        StringBuilder errors = new StringBuilder();

        // Primary path: the standard OSM map API. It uses the same OpenStreetMap infrastructure
        // that already serves the visible map and is more reliable on networks where Overpass DNS is blocked.
        double[] scales = {1.0, 0.72, 0.50};
        for (double scale : scales) {
            if (numericId != latestHeritageRequest) return;
            try {
                String bbox = bbox(lat, lon, radiusKm * scale);
                String raw = getText("https://api.openstreetmap.org/api/0.6/map?bbox=" + bbox,
                        "application/xml,text/xml", 6000, 14000);
                if (raw != null && raw.contains("<osm")) {
                    CacheEntry entry = new CacheEntry(raw, "xml", "api.openstreetmap.org");
                    cache.put(key, entry);
                    if (numericId == latestHeritageRequest) deliverHeritage(id, raw, "xml", entry.source);
                    return;
                }
            } catch (Exception e) {
                appendError(errors, "OSM API", e);
            }
        }

        // Secondary path: compact Overpass query. This is only a fallback now.
        int radiusM = Math.max(300, (int) Math.round(radiusKm * 1000.0));
        String query = buildOverpassQuery(lat, lon, radiusM);
        String[] endpoints = {
                "https://overpass-api.de/api/interpreter",
                "https://overpass.kumi.systems/api/interpreter",
                "https://overpass.private.coffee/api/interpreter"
        };
        for (String endpoint : endpoints) {
            if (numericId != latestHeritageRequest) return;
            try {
                String body = "data=" + URLEncoder.encode(query, "UTF-8");
                String raw = postForm(endpoint, body, 5000, 10000);
                if (raw != null && raw.contains("\"elements\"")) {
                    CacheEntry entry = new CacheEntry(raw, "json", new URL(endpoint).getHost());
                    cache.put(key, entry);
                    if (numericId == latestHeritageRequest) deliverHeritage(id, raw, "json", entry.source);
                    return;
                }
            } catch (Exception e) {
                appendError(errors, "Overpass", e);
            }
        }

        if (numericId == latestHeritageRequest) {
            deliverHeritageError(id, errors.length() == 0 ? "Kaynaklar yanıt vermedi" : errors.toString());
        }
    }

    private String bbox(double lat, double lon, double radiusKm) {
        double dLat = radiusKm / 111.32;
        double cos = Math.max(0.25, Math.cos(Math.toRadians(lat)));
        double dLon = radiusKm / (111.32 * cos);
        return String.format(Locale.US, "%.6f,%.6f,%.6f,%.6f", lon - dLon, lat - dLat, lon + dLon, lat + dLat);
    }

    private String buildOverpassQuery(double lat, double lon, int radiusM) {
        String around = String.format(Locale.US, "(around:%d,%.6f,%.6f)", radiusM, lat, lon);
        return "[out:json][timeout:12];(" +
                "nwr" + around + "[historic];" +
                "nwr" + around + "[heritage];" +
                "nwr" + around + "[tourism=archaeological_site];" +
                "nwr" + around + "[archaeological_site];" +
                "nwr" + around + "[ruins=yes];" +
                "nwr" + around + "[route:historic=yes];" +
                ");out tags center geom;";
    }

    private void deliverHeritage(String id, String payload, String format, String source) {
        runJs("window.onNativeHeritageV4(" + JSONObject.quote(id) + "," + JSONObject.quote(payload) + "," +
                JSONObject.quote(format) + "," + JSONObject.quote(source) + ")");
    }

    private void deliverHeritageError(String id, String message) {
        runJs("window.onNativeHeritageErrorV4(" + JSONObject.quote(id) + "," + JSONObject.quote(message) + ")");
    }

    private void appendError(StringBuilder sb, String prefix, Exception e) {
        if (sb.length() > 0) sb.append(" | ");
        sb.append(prefix).append(": ").append(shortError(e));
    }

    private long parseId(String id) {
        try { return Long.parseLong(id); } catch (Exception e) { return 0L; }
    }

    private void runJs(String js) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private String shortError(Exception e) {
        String msg = e.getMessage();
        return e.getClass().getSimpleName() + (msg == null || msg.trim().isEmpty() ? "" : ": " + msg);
    }

    private String getText(String address, String accept, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        try {
            connection.setUseCaches(false);
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", accept);
            connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/13.0 heritage-map contact:goxel1907");
            connection.setRequestProperty("Connection", "close");
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
            connection.setUseCaches(false);
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/13.0 heritage-map contact:goxel1907");
            connection.setRequestProperty("Connection", "close");
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
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) >= 0) sb.append(buf, 0, n);
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
        runJs("window.onNativeLocationV4(" + location.getLatitude() + "," + location.getLongitude() + ")");
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
        ioPool.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
