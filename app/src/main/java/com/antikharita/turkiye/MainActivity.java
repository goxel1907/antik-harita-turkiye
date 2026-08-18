package com.antikharita.turkiye;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.pdf.PdfDocument;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 7;
    private static final int REQ_PHOTO = 8;
    private WebView webView;
    private AppBridge appBridge;

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
        s.setUserAgentString(s.getUserAgentString() + " AntikHaritaTurkiye/6.0");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        appBridge = new AppBridge(this);
        webView.addJavascriptInterface(appBridge, "AndroidApp");
        webView.loadUrl("file:///android_asset/index.html");
    }

    public class AppBridge {
        private final Context context; private final LocationManager locationManager; private final SharedPreferences prefs;
        AppBridge(Context context){this.context=context;locationManager=(LocationManager)context.getSystemService(Context.LOCATION_SERVICE);prefs=getSharedPreferences("security",MODE_PRIVATE);}
        @JavascriptInterface public void requestLocation(){runOnUiThread(() -> {if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_LOCATION);return;}fetchLocation();});}
        void fetchLocation(){try{Location last=locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);if(last==null)last=locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);if(last!=null)sendLocation(last);LocationListener listener=new LocationListener(){@Override public void onLocationChanged(Location location){sendLocation(location);locationManager.removeUpdates(this);}};if(locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER,listener,null);else if(locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locationManager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER,listener,null);}catch(SecurityException ignored){}}
        void sendLocation(Location loc){final double lat=loc.getLatitude(),lon=loc.getLongitude();final float accuracy=loc.getAccuracy();runOnUiThread(() -> webView.evaluateJavascript("window.onNativeLocation("+lat+","+lon+","+accuracy+")",null));}
        @JavascriptInterface public boolean hasPin(){return prefs.contains("pin_hash");}
        @JavascriptInterface public boolean setPin(String pin){if(pin==null||pin.length()<4||pin.length()>12)return false;prefs.edit().putString("pin_hash",sha256("AH4:"+pin)).apply();return true;}
        @JavascriptInterface public boolean verifyPin(String pin){String expected=prefs.getString("pin_hash","");return !expected.isEmpty()&&expected.equals(sha256("AH4:"+pin));}
        @JavascriptInterface public void clearPin(){prefs.edit().remove("pin_hash").apply();}
        @JavascriptInterface public void setScreenshotProtection(boolean enabled){runOnUiThread(() -> {if(enabled)getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);});}
        @JavascriptInterface public void pickPhoto(){runOnUiThread(() -> {Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/*");startActivityForResult(i,REQ_PHOTO);});}
        @JavascriptInterface public void exportJson(String json){saveText("antik_harita_yedek_"+stamp()+".json",json);}
        @JavascriptInterface public void exportCsv(String csv){saveText("antik_harita_kayitlar_"+stamp()+".csv",csv);}
        @JavascriptInterface public void exportReportPdf(String json){try{JSONObject o=new JSONObject(json);PdfDocument pdf=new PdfDocument();PdfDocument.PageInfo info=new PdfDocument.PageInfo.Builder(595,842,1).create();PdfDocument.Page page=pdf.startPage(info);Canvas c=page.getCanvas();Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setTextSize(20);p.setFakeBoldText(true);c.drawText("KÜLTÜR VARLIĞI GÖZLEM / BİLDİRİM TASLAĞI",40,55,p);p.setFakeBoldText(false);p.setTextSize(11);int y=90;String[] rows={"Tarih: "+o.optString("time","—"),"İl / ilçe / mevki: "+o.optString("place","—"),"Koordinat: "+o.optString("lat","—")+", "+o.optString("lon","—"),"GPS doğruluğu: ~"+o.optString("accuracy","—")+" m","Gözlem türü: "+o.optString("kind","—"),"Güven / durum: "+o.optString("confidence","Saha gözlemi"),"Not: "+o.optString("note","—")};for(String row:rows)y=drawWrapped(c,p,row,40,y,510,16);pdf.finishPage(page);File file=new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),"kultur_varligi_bildirim_"+stamp()+".pdf");try(FileOutputStream out=new FileOutputStream(file)){pdf.writeTo(out);}pdf.close();notifySaved(file.getAbsolutePath());}catch(Exception e){notifyError("PDF oluşturulamadı: "+e.getMessage());}}
        @JavascriptInterface public void openGeo(double lat,double lon,String label){runOnUiThread(() -> {Uri uri=Uri.parse("geo:"+lat+","+lon+"?q="+lat+","+lon+"("+Uri.encode(label)+")");try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){Toast.makeText(MainActivity.this,"Harita uygulaması bulunamadı.",Toast.LENGTH_SHORT).show();}});}
        private void saveText(String name,String text){try{File dir=getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);if(dir!=null&&!dir.exists())dir.mkdirs();File f=new File(dir,name);try(FileOutputStream out=new FileOutputStream(f)){out.write(text.getBytes(StandardCharsets.UTF_8));}notifySaved(f.getAbsolutePath());}catch(Exception e){notifyError("Dosya kaydedilemedi: "+e.getMessage());}}
        private void notifySaved(String path){runOnUiThread(() -> {Toast.makeText(MainActivity.this,"Kaydedildi",Toast.LENGTH_SHORT).show();webView.evaluateJavascript("window.onNativeSaved("+JSONObject.quote(path)+")",null);});}
        private void notifyError(String message){runOnUiThread(() -> webView.evaluateJavascript("window.onNativeError("+JSONObject.quote(message)+")",null));}
    }

    private static String stamp(){return new SimpleDateFormat("yyyyMMdd_HHmmss",Locale.US).format(new Date());}
    private static String sha256(String s){try{MessageDigest md=MessageDigest.getInstance("SHA-256");byte[] b=md.digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte x:b)out.append(String.format(Locale.US,"%02x",x));return out.toString();}catch(Exception e){return "";}}
    private static int drawWrapped(Canvas c,Paint p,String text,int x,int y,int maxWidth,int lineHeight){String[] words=text.split("\\s+");StringBuilder line=new StringBuilder();for(String word:words){String test=line.length()==0?word:line+" "+word;if(p.measureText(test)>maxWidth&&line.length()>0){c.drawText(line.toString(),x,y,p);y+=lineHeight;line=new StringBuilder(word);}else line=new StringBuilder(test);}if(line.length()>0){c.drawText(line.toString(),x,y,p);y+=lineHeight;}return y;}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode==REQ_PHOTO&&resultCode==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();try(InputStream in=getContentResolver().openInputStream(uri)){Bitmap src=BitmapFactory.decodeStream(in);if(src==null)throw new Exception("Görüntü okunamadı");int max=1280;float scale=Math.min(1f,Math.min((float)max/src.getWidth(),(float)max/src.getHeight()));Bitmap bmp=scale<1f?Bitmap.createScaledBitmap(src,Math.round(src.getWidth()*scale),Math.round(src.getHeight()*scale),true):src;ByteArrayOutputStream bos=new ByteArrayOutputStream();bmp.compress(Bitmap.CompressFormat.JPEG,78,bos);String b64=Base64.encodeToString(bos.toByteArray(),Base64.NO_WRAP);webView.evaluateJavascript("window.onNativePhoto("+JSONObject.quote("data:image/jpeg;base64,"+b64)+")",null);if(bmp!=src)bmp.recycle();src.recycle();}catch(Exception e){webView.evaluateJavascript("window.onNativeError("+JSONObject.quote("Fotoğraf alınamadı: "+e.getMessage())+")",null);}}}
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){super.onRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==REQ_LOCATION&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)appBridge.fetchLocation();}
    @Override public void onBackPressed(){if(webView.canGoBack())webView.goBack();else super.onBackPressed();}
}
