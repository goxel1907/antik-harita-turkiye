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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private static final long CACHE_TTL_MS = 30L * 60L * 1000L;
    private WebView webView;
    private LocationManager locationManager;
    private final ExecutorService ioPool = Executors.newFixedThreadPool(6);
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
        // Keep normal HTTP caching for map tiles. The HTML itself is a versioned local asset,
        // so disabling the whole WebView cache only makes panning unnecessarily slow.
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " AntikHaritaTurkiye/14.0");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidApp");
        webView.loadUrl("file:///android_asset/index-v14.html");
    }

    public class Bridge {
        @JavascriptInterface
        public void fetchLocalHeritageV5(String requestId, double lat, double lon, int zoom) {
            final String id = requestId == null ? "0" : requestId;
            final long numericId = parseId(id);
            latestHeritageRequest = Math.max(latestHeritageRequest, numericId);

            final int safeZoom = Math.max(11, Math.min(18, zoom));
            final double radiusKm = radiusForZoom(safeZoom);
            final AtomicInteger pending = new AtomicInteger(2);
            final AtomicBoolean anySource = new AtomicBoolean(false);
            final StringBuilder errors = new StringBuilder();

            ioPool.execute(() -> {
                try {
                    CacheEntry entry = fetchOsmHeritage(lat, lon, safeZoom, radiusKm);
                    if (entry != null && numericId == latestHeritageRequest) {
                        anySource.set(true);
                        deliverHeritageChunk(id, entry.payload, entry.format, entry.source);
                    }
                } catch (Exception e) {
                    appendError(errors, "OSM", e);
                } finally {
                    finishHeritageRequest(id, numericId, pending, anySource, errors);
                }
            });

            ioPool.execute(() -> {
                try {
                    CacheEntry entry = fetchWikidataHeritage(lat, lon, safeZoom, radiusKm);
                    if (entry != null && numericId == latestHeritageRequest) {
                        anySource.set(true);
                        deliverHeritageChunk(id, entry.payload, entry.format, entry.source);
                    }
                } catch (Exception e) {
                    appendError(errors, "Wikidata", e);
                } finally {
                    finishHeritageRequest(id, numericId, pending, anySource, errors);
                }
            });
        }

        @JavascriptInterface
        public void geocodeV5(String text) {
            if (text == null || text.trim().isEmpty()) return;
            ioPool.execute(() -> {
                try {
                    String q = URLEncoder.encode(text.trim(), "UTF-8");
                    String raw = getText(
                            "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=12&countrycodes=tr&accept-language=tr&q=" + q,
                            "application/json", 5000, 10000);
                    runJs("window.onNativeGeocodeV5(" + JSONObject.quote(raw) + ")");
                } catch (Exception e) {
                    runJs("window.onNativeGeocodeErrorV5(" + JSONObject.quote(shortError(e)) + ")");
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

    private void finishHeritageRequest(String id, long numericId, AtomicInteger pending,
                                       AtomicBoolean anySource, StringBuilder errors) {
        if (pending.decrementAndGet() != 0 || numericId != latestHeritageRequest) return;
        synchronized (errors) {
            runJs("window.onNativeHeritageDoneV5(" + JSONObject.quote(id) + "," + anySource.get() + "," +
                    JSONObject.quote(errors.toString()) + ")");
        }
    }

    private CacheEntry fetchOsmHeritage(double lat, double lon, int zoom, double radiusKm) throws Exception {
        String key = cacheKey("osm", lat, lon, zoom);
        CacheEntry cached = validCache(key);
        if (cached != null) return new CacheEntry(cached.payload, cached.format, "önbellek • " + cached.source);

        StringBuilder errors = new StringBuilder();
        String query = buildOverpassQuery(lat, lon, radiusKm);
        String[] endpoints = {
                "https://overpass-api.de/api/interpreter",
                "https://overpass.kumi.systems/api/interpreter",
                "https://overpass.private.coffee/api/interpreter"
        };
        for (String endpoint : endpoints) {
            try {
                String body = "data=" + URLEncoder.encode(query, "UTF-8");
                String raw = postForm(endpoint, body, 4500, 9000);
                if (raw != null && raw.contains("\"elements\"")) {
                    CacheEntry entry = new CacheEntry(raw, "overpass-json", new URL(endpoint).getHost());
                    cache.put(key, entry);
                    return entry;
                }
            } catch (Exception e) {
                appendError(errors, new URL(endpoint).getHost(), e);
            }
        }

        // Guaranteed lightweight fallback: standard OSM map API around the exact centre.
        // It is intentionally kept small because /map returns every object in the box.
        double fallbackRadius = Math.min(radiusKm, zoom <= 12 ? 0.85 : 1.20);
        try {
            String raw = getText("https://api.openstreetmap.org/api/0.6/map?bbox=" + bbox(lat, lon, fallbackRadius),
                    "application/xml,text/xml", 5000, 12000);
            if (raw != null && raw.contains("<osm")) {
                CacheEntry entry = new CacheEntry(raw, "osm-xml", "api.openstreetmap.org");
                cache.put(key, entry);
                return entry;
            }
        } catch (Exception e) {
            appendError(errors, "api.openstreetmap.org", e);
        }
        throw new Exception(errors.length() == 0 ? "OSM kaynakları yanıt vermedi" : errors.toString());
    }

    private CacheEntry fetchWikidataHeritage(double lat, double lon, int zoom, double radiusKm) throws Exception {
        String key = cacheKey("wd", lat, lon, zoom);
        CacheEntry cached = validCache(key);
        if (cached != null) return new CacheEntry(cached.payload, cached.format, "önbellek • " + cached.source);

        double wdRadius = Math.min(radiusKm, zoom <= 11 ? 20.0 : 15.0);
        String query = buildWikidataQuery(lat, lon, wdRadius);
        String url = "https://query.wikidata.org/sparql?format=json&query=" + URLEncoder.encode(query, "UTF-8");
        String raw = getText(url, "application/sparql-results+json,application/json", 5500, 12000);
        if (raw == null || !raw.contains("\"bindings\"")) throw new Exception("Wikidata boş yanıt");
        CacheEntry entry = new CacheEntry(raw, "wikidata-json", "query.wikidata.org");
        cache.put(key, entry);
        return entry;
    }

    private double radiusForZoom(int zoom) {
        if (zoom <= 11) return 25.0;
        if (zoom == 12) return 14.0;
        if (zoom == 13) return 8.0;
        if (zoom == 14) return 4.0;
        if (zoom == 15) return 2.0;
        if (zoom == 16) return 1.0;
        if (zoom == 17) return 0.60;
        return 0.35;
    }

    private String cacheKey(String prefix, double lat, double lon, int zoom) {
        double q;
        if (zoom <= 11) q = 4.0;
        else if (zoom == 12) q = 8.0;
        else if (zoom == 13) q = 16.0;
        else if (zoom == 14) q = 32.0;
        else if (zoom == 15) q = 64.0;
        else q = 128.0;
        return prefix + ":" + zoom + ":" + Math.round(lat * q) + ":" + Math.round(lon * q);
    }

    private CacheEntry validCache(String key) {
        CacheEntry cached = cache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.time < CACHE_TTL_MS) return cached;
        return null;
    }

    private String buildOverpassQuery(double lat, double lon, double radiusKm) {
        double dLat = radiusKm / 111.32;
        double cos = Math.max(0.25, Math.cos(Math.toRadians(lat)));
        double dLon = radiusKm / (111.32 * cos);
        String box = String.format(Locale.US, "%.6f,%.6f,%.6f,%.6f", lat - dLat, lon - dLon, lat + dLat, lon + dLon);
        // Bounding-box filtering is considerably cheaper than repeated around filters on dense areas.
        return "[out:json][timeout:14][bbox:" + box + "];(" +
                "nwr[historic];" +
                "nwr[heritage];" +
                "nwr[archaeological_site];" +
                "nwr[tourism=archaeological_site];" +
                "nwr[ruins=yes];" +
                "nwr[route:historic=yes];" +
                ");out tags center geom;";
    }

    private String buildWikidataQuery(double lat, double lon, double radiusKm) {
        String center = String.format(Locale.US, "Point(%.6f %.6f)", lon, lat);
        String radius = String.format(Locale.US, "%.2f", radiusKm);
        return "SELECT DISTINCT ?item ?itemLabel ?location ?instanceLabel ?heritageLabel WHERE { " +
                "SERVICE wikibase:around { ?item wdt:P625 ?location. " +
                "bd:serviceParam wikibase:center \"" + center + "\"^^geo:wktLiteral. " +
                "bd:serviceParam wikibase:radius \"" + radius + "\". } " +
                "{ ?item wdt:P1435 ?heritage. } UNION " +
                "{ ?item wdt:P31/wdt:P279* wd:Q839954. } UNION " +
                "{ ?item wdt:P31/wdt:P279* wd:Q23413. } UNION " +
                "{ ?item wdt:P31/wdt:P279* wd:Q57821. } UNION " +
                "{ ?item wdt:P31/wdt:P279* wd:Q12280. } " +
                "OPTIONAL { ?item wdt:P31 ?instance. } " +
                "OPTIONAL { ?item wdt:P1435 ?heritage. } " +
                "SERVICE wikibase:label { bd:serviceParam wikibase:language \"tr,en\". } " +
                "} LIMIT 300";
    }

    private String bbox(double lat, double lon, double radiusKm) {
        double dLat = radiusKm / 111.32;
        double cos = Math.max(0.25, Math.cos(Math.toRadians(lat)));
        double dLon = radiusKm / (111.32 * cos);
        return String.format(Locale.US, "%.6f,%.6f,%.6f,%.6f", lon - dLon, lat - dLat, lon + dLon, lat + dLat);
    }

    private void deliverHeritageChunk(String id, String payload, String format, String source) {
        runJs("window.onNativeHeritageChunkV5(" + JSONObject.quote(id) + "," + JSONObject.quote(payload) + "," +
                JSONObject.quote(format) + "," + JSONObject.quote(source) + ")");
    }

    private void appendError(StringBuilder sb, String prefix, Exception e) {
        synchronized (sb) {
            if (sb.length() > 0) sb.append(" | ");
            sb.append(prefix).append(": ").append(shortError(e));
        }
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
            connection.setUseCaches(true);
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", accept);
            connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/14.0 public-heritage-map contact:goxel1907");
            connection.setRequestProperty("Accept-Language", "tr,en;q=0.7");
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
            connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/14.0 public-heritage-map contact:goxel1907");
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
        runJs("window.onNativeLocationV5(" + location.getLatitude() + "," + location.getLongitude() + ")");
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
