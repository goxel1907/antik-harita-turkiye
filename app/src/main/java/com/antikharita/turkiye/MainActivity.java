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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private static final long CACHE_TTL_MS = 30L * 60L * 1000L;
    private WebView webView;
    private LocationManager locationManager;
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    private static class CacheEntry {
        final String payload; final String source; final long time;
        CacheEntry(String p, String s) { payload=p; source=s; time=System.currentTimeMillis(); }
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        locationManager = (LocationManager)getSystemService(LOCATION_SERVICE);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setGeolocationEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString()+" AntikHaritaTurkiye/10.0");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String url){
                super.onPageFinished(view,url);
                view.evaluateJavascript("(function(){if(document.getElementById('protection-module'))return;var s=document.createElement('script');s.id='protection-module';s.src='protection.js';document.body.appendChild(s);})()",null);
            }
        });
        webView.addJavascriptInterface(new Bridge(),"AndroidApp");
        webView.loadUrl("file:///android_asset/index.html");
    }

    public class Bridge {
        @JavascriptInterface public void fetchOverpassV2(String requestId,String query){
            if(query==null||query.trim().isEmpty())return;
            final String id=requestId==null?"0":requestId;
            CacheEntry ce=cache.get(query);
            if(ce!=null&&System.currentTimeMillis()-ce.time<CACHE_TTL_MS){
                deliverOverpass(id,ce.payload,"önbellek • "+ce.source); return;
            }
            new Thread(()->{
                String[] endpoints={
                    "https://overpass.kumi.systems/api/interpreter",
                    "https://overpass.private.coffee/api/interpreter",
                    "https://overpass-api.de/api/interpreter"
                };
                String payload=null,source=null; StringBuilder errs=new StringBuilder();
                for(String ep:endpoints){
                    try{
                        payload=postForm(ep,"data="+URLEncoder.encode(query,"UTF-8"),5000,14000);
                        if(payload!=null&&!payload.isEmpty()){source=host(ep);break;}
                    }catch(Exception e){if(errs.length()>0)errs.append(" | ");errs.append(host(ep)).append(": ").append(e.getClass().getSimpleName());}
                }
                if(payload!=null){cache.put(query,new CacheEntry(payload,source));deliverOverpass(id,payload,source);} else deliverError(errs.length()==0?"Canlı veri sunucularına erişilemedi":errs.toString());
            }).start();
        }
        @JavascriptInterface public void fetchOverpass(String query){ fetchOverpassV2("0",query); }
        @JavascriptInterface public void geocode(String text){
            if(text==null||text.trim().isEmpty())return;
            new Thread(()->{
                try{
                    String q=URLEncoder.encode(text.trim(),"UTF-8");
                    String out=getText("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=12&countrycodes=tr&q="+q,6000,12000);
                    runOnUiThread(()->webView.evaluateJavascript("window.onNativeGeocode("+JSONObject.quote(out)+")",null));
                }catch(Exception e){String m=e.getClass().getSimpleName()+": "+String.valueOf(e.getMessage());runOnUiThread(()->webView.evaluateJavascript("window.onNativeGeocodeError("+JSONObject.quote(m)+")",null));}
            }).start();
        }
        @JavascriptInterface public void requestLocation(){
            runOnUiThread(()->{
                if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_LOCATION);return;} fetchLocation();
            });
        }
    }

    private void deliverOverpass(String id,String payload,String source){ runOnUiThread(()->webView.evaluateJavascript("window.onNativeOverpassV2("+JSONObject.quote(id)+","+JSONObject.quote(payload)+","+JSONObject.quote(source==null?"canlı":source)+")",null)); }
    private void deliverError(String msg){ runOnUiThread(()->webView.evaluateJavascript("window.onNativeOverpassError("+JSONObject.quote(msg)+")",null)); }
    private String host(String u){try{return new URL(u).getHost();}catch(Exception e){return u;}}
    private String getText(String address,int ct,int rt)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); try{c.setConnectTimeout(ct);c.setReadTimeout(rt);c.setRequestMethod("GET");c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","AntikHaritaTurkiye/10.0 heritage-protection-app");int code=c.getResponseCode();if(code<200||code>=300)throw new Exception("HTTP "+code);return read(c);}finally{c.disconnect();}
    }
    private String postForm(String address,String bodyText,int ct,int rt)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); try{c.setConnectTimeout(ct);c.setReadTimeout(rt);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/x-www-form-urlencoded; charset=UTF-8");c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","AntikHaritaTurkiye/10.0 heritage-protection-app");byte[] b=bodyText.getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(b.length);try(OutputStream o=c.getOutputStream()){o.write(b);}int code=c.getResponseCode();if(code<200||code>=300)throw new Exception("HTTP "+code);return read(c);}finally{c.disconnect();}
    }
    private String read(HttpURLConnection c)throws Exception{StringBuilder sb=new StringBuilder();try(BufferedReader br=new BufferedReader(new InputStreamReader(c.getInputStream(),StandardCharsets.UTF_8))){String line;while((line=br.readLine())!=null)sb.append(line);}return sb.toString();}
    private void fetchLocation(){
        try{
            Location last=locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);if(last==null)last=locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);if(last!=null)sendLocation(last);
            LocationListener l=new LocationListener(){@Override public void onLocationChanged(Location x){sendLocation(x);try{locationManager.removeUpdates(this);}catch(Exception ignored){}}};
            if(locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER,l,null);else if(locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER,l,null);
        }catch(SecurityException ignored){}
    }
    private void sendLocation(Location l){double a=l.getLatitude(),o=l.getLongitude();runOnUiThread(()->webView.evaluateJavascript("window.onNativeLocation("+a+","+o+")",null));}
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){super.onRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==REQ_LOCATION&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)fetchLocation();}
    @Override public void onBackPressed(){if(webView.canGoBack())webView.goBack();else super.onBackPressed();}
}
