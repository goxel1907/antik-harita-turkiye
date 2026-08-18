package com.antikharita.turkiye;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private static final int JS_CHUNK = 180_000;
    private WebView webView;
    private LocationManager locationManager;
    private final ExecutorService ioPool = Executors.newFixedThreadPool(3);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(189, 211, 221));
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
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
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AntikHaritaTurkiye/16.0");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme)
                        || "https".equalsIgnoreCase(scheme)
                        || "geo".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        return true;
                    } catch (Exception ignored) {
                        return false;
                    }
                }
                return false;
            }
        });
        webView.addJavascriptInterface(new Bridge(), "AndroidApp");
        webView.loadUrl("file:///android_asset/index-v16.html");
    }

    public class Bridge {
        @JavascriptInterface
        public void loadCorpusV1() {
            ioPool.execute(() -> {
                try {
                    String raw = readAsset("data/history-corpus.json");
                    int total = Math.max(1, (raw.length() + JS_CHUNK - 1) / JS_CHUNK);
                    runJs("window.onNativeCorpusStartV1(" + total + ")");
                    for (int i = 0; i < total; i++) {
                        int from = i * JS_CHUNK;
                        int to = Math.min(raw.length(), from + JS_CHUNK);
                        String part = raw.substring(from, to);
                        runJs("window.onNativeCorpusChunkV1(" + i + "," + JSONObject.quote(part) + ")");
                    }
                    runJs("window.onNativeCorpusEndV1()");
                } catch (Exception e) {
                    runJs("window.onNativeCorpusErrorV1(" + JSONObject.quote(shortError(e)) + ")");
                }
            });
        }

        @JavascriptInterface
        public void geocodeV6(String text) {
            if (text == null || text.trim().isEmpty()) return;
            ioPool.execute(() -> {
                HttpURLConnection connection = null;
                try {
                    String q = URLEncoder.encode(text.trim(), "UTF-8");
                    URL url = new URL("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=15&countrycodes=tr&accept-language=tr&q=" + q);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setUseCaches(true);
                    connection.setConnectTimeout(6000);
                    connection.setReadTimeout(12000);
                    connection.setRequestMethod("GET");
                    connection.setRequestProperty("Accept", "application/json");
                    connection.setRequestProperty("Accept-Language", "tr,en;q=0.7");
                    connection.setRequestProperty("User-Agent", "AntikHaritaTurkiye/16.0 public-historical-research-map contact:goxel1907");
                    int code = connection.getResponseCode();
                    if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
                    String raw = read(connection.getInputStream());
                    runJs("window.onNativeGeocodeV6(" + JSONObject.quote(raw) + ")");
                } catch (Exception e) {
                    runJs("window.onNativeGeocodeErrorV6(" + JSONObject.quote(shortError(e)) + ")");
                } finally {
                    if (connection != null) connection.disconnect();
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

    private String readAsset(String path) throws Exception {
        try (InputStream input = getAssets().open(path)) {
            return read(input);
        }
    }

    private String read(InputStream input) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            char[] buf = new char[16 * 1024];
            int n;
            while ((n = reader.read(buf)) >= 0) sb.append(buf, 0, n);
        }
        return sb.toString();
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

    private void fetchLocation() {
        try {
            Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last == null) last = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null) sendLocation(last);

            LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    sendLocation(location);
                    try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                }
            };

            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, null);
            } else if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, null);
            }
        } catch (SecurityException ignored) {
            runJs("window.onNativeGeocodeErrorV6('Konum izni kullanılamadı')");
        }
    }

    private void sendLocation(Location location) {
        runJs("window.onNativeLocationV6(" + location.getLatitude() + "," + location.getLongitude() + ")");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            fetchLocation();
        }
    }

    @Override
    protected void onDestroy() {
        ioPool.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
