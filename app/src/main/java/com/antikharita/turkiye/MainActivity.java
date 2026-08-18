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
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private WebView webView;
    private LocationManager locationManager;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setGeolocationEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AntikHaritaTurkiye/8.0");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        locationManager = (LocationManager)getSystemService(LOCATION_SERVICE);
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");
        webView.loadUrl("file:///android_asset/index.html");
    }

    public class AppBridge {
        @JavascriptInterface public void requestLocation() {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                    return;
                }
                fetchLocation();
            });
        }

        @JavascriptInterface public void fetchOverpass(String query) {
            if (query == null || query.trim().isEmpty()) return;
            new Thread(() -> {
                String[] endpoints = {
                    "https://overpass-api.de/api/interpreter",
                    "https://overpass.kumi.systems/api/interpreter",
                    "https://overpass.nchc.org.tw/api/interpreter"
                };
                String result = null;
                String error = "Overpass bağlantısı kurulamadı";
                for (String endpoint : endpoints) {
                    try {
                        result = postForm(endpoint, "data=" + URLEncoder.encode(query, "UTF-8"), 14000, 30000);
                        if (result != null && !result.isEmpty()) break;
                    } catch (Exception e) {
                        error = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
                    }
                }
                final String payload = result;
                final String err = error;
                runOnUiThread(() -> {
                    if (payload != null) js("window.onNativeOverpass(" + JSONObject.quote(payload) + ")");
                    else js("window.onNativeOverpassError(" + JSONObject.quote(err) + ")");
                });
            }).start();
        }

        @JavascriptInterface public void geocode(String text) {
            if (text == null || text.trim().isEmpty()) return;
            new Thread(() -> {
                try {
                    String url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=12&countrycodes=tr&addressdetails=1&q=" + URLEncoder.encode(text.trim(), "UTF-8");
                    String result = get(url, 12000, 22000);
                    runOnUiThread(() -> js("window.onNativeGeocode(" + JSONObject.quote(result == null ? "[]" : result) + ")"));
                } catch (Exception e) {
                    String msg = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
                    runOnUiThread(() -> js("window.onNativeGeocodeError(" + JSONObject.quote(msg) + ")"));
                }
            }).start();
        }
    }

    private String postForm(String endpoint, String bodyText, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection)new URL(endpoint).openConnection();
            conn.setConnectTimeout(connectTimeout);
            conn.setReadTimeout(readTimeout);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "AntikHaritaTurkiye/8.0 heritage-research-map");
            byte[] body = bodyText.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = conn.getOutputStream()) { out.write(body); }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return readAll(conn);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String get(String endpoint, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection)new URL(endpoint).openConnection();
            conn.setConnectTimeout(connectTimeout);
            conn.setReadTimeout(readTimeout);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Accept-Language", "tr");
            conn.setRequestProperty("User-Agent", "AntikHaritaTurkiye/8.0 heritage-research-map");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return readAll(conn);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String readAll(HttpURLConnection conn) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private void js(String script) {
        if (webView != null) webView.evaluateJavascript(script, null);
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
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, null);
            else if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, null);
        } catch (SecurityException ignored) {}
    }

    private void sendLocation(Location loc) {
        final double la = loc.getLatitude();
        final double lo = loc.getLongitude();
        final float accuracy = loc.getAccuracy();
        runOnUiThread(() -> js("window.onNativeLocation(" + la + "," + lo + "," + accuracy + ")"));
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) fetchLocation();
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
