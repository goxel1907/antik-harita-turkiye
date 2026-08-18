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
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);

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
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                String js = "(function(){if(document.getElementById('protection-module'))return;" +
                        "var s=document.createElement('script');s.id='protection-module';" +
                        "s.src='protection.js';document.body.appendChild(s);})()";
                view.evaluateJavascript(js, null);
            }
        });
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");
        webView.loadUrl("file:///android_asset/index.html");
    }

    public class AppBridge {
        @JavascriptInterface public void fetchOverpass(String query) {
            if (query == null || query.trim().isEmpty()) return;
            new Thread(() -> {
                String[] endpoints = {
                        "https://overpass-api.de/api/interpreter",
                        "https://overpass.kumi.systems/api/interpreter",
                        "https://overpass.nchc.org.tw/api/interpreter"
                };
                String payload = null;
                String err = "Overpass bağlantısı kurulamadı";
                for (String endpoint : endpoints) {
                    try {
                        payload = postForm(endpoint, "data=" + URLEncoder.encode(query, "UTF-8"), 12000, 30000);
                        if (payload != null && !payload.isEmpty()) break;
                    } catch (Exception e) {
                        err = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
                    }
                }
                final String out = payload;
                final String error = err;
                runOnUiThread(() -> {
                    if (out != null) webView.evaluateJavascript("window.onNativeOverpass(" + JSONObject.quote(out) + ")", null);
                    else webView.evaluateJavascript("window.onNativeOverpassError(" + JSONObject.quote(error) + ")", null);
                });
            }).start();
        }

        @JavascriptInterface public void geocode(String text) {
            if (text == null || text.trim().isEmpty()) return;
            new Thread(() -> {
                String payload = null;
                String err = "Yer araması yapılamadı";
                try {
                    String q = URLEncoder.encode(text.trim(), "UTF-8");
                    String u = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=12&countrycodes=tr&q=" + q;
                    payload = getText(u, 10000, 20000);
                } catch (Exception e) {
                    err = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
                }
                final String out = payload;
                final String error = err;
                runOnUiThread(() -> {
                    if (out != null) webView.evaluateJavascript("window.onNativeGeocode(" + JSONObject.quote(out) + ")", null);
                    else webView.evaluateJavascript("window.onNativeGeocodeError(" + JSONObject.quote(error) + ")", null);
                });
            }).start();
        }

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
    }

    private String getText(String address, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(address).openConnection();
            c.setConnectTimeout(connectTimeout);
            c.setReadTimeout(readTimeout);
            c.setRequestMethod("GET");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "AntikHaritaTurkiye/8.0 heritage-protection-app");
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return read(c);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private String postForm(String address, String bodyText, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(address).openConnection();
            c.setConnectTimeout(connectTimeout);
            c.setReadTimeout(readTimeout);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "AntikHaritaTurkiye/8.0 heritage-protection-app");
            byte[] body = bodyText.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = c.getOutputStream()) { out.write(body); }
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return read(c);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private String read(HttpURLConnection c) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
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
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, null);
            else if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, null);
        } catch (SecurityException ignored) {}
    }

    private void sendLocation(Location loc) {
        final double la = loc.getLatitude(), lo = loc.getLongitude();
        runOnUiThread(() -> webView.evaluateJavascript("window.onNativeLocation(" + la + "," + lo + ")", null));
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) fetchLocation();
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
