from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
AGENT = JAVA / 'TradeAgentActivity.java'
BUILD = APP / 'app/build.gradle'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'

for p in (MAIN, MON, ANALYSIS, BUILD, MANIFEST):
    if not p.exists():
        raise SystemExit('v9.5.68 missing required file: ' + str(p))


def java_lex_sanity(src):
    depth = 0
    i = 0
    line = 1
    state = 'code'
    esc = False
    while i < len(src):
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if c == '\n': line += 1
        if state == 'line':
            if c == '\n': state = 'code'
            i += 1; continue
        if state == 'block':
            if c == '*' and n == '/': state = 'code'; i += 2; continue
            i += 1; continue
        if state == 'string':
            if c == '\n': return False, 'newline in string near line ' + str(line)
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': state = 'code'
            i += 1; continue
        if state == 'char':
            if c == '\n': return False, 'newline in char near line ' + str(line)
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": state = 'code'
            i += 1; continue
        if c == '/' and n == '/': state = 'line'; i += 2; continue
        if c == '/' and n == '*': state = 'block'; i += 2; continue
        if c == '"': state = 'string'; esc = False; i += 1; continue
        if c == "'": state = 'char'; esc = False; i += 1; continue
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth < 0: return False, 'extra closing brace near line ' + str(line)
        i += 1
    if state in ('string','char','block'): return False, 'unclosed lexical state ' + state
    if depth != 0: return False, 'brace depth ' + str(depth)
    return True, 'OK'

ana = ANALYSIS.read_text()
main = MAIN.read_text()
mon = MON.read_text()
bf = BUILD.read_text()
manifest = MANIFEST.read_text()

if 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' not in ana:
    raise SystemExit('v9.5.68 prerequisite missing: V9567_CLIPBOARD_GALLERY_SAME_CHAT')
if 'V9564_PLAN_CODE_ONLY_CONTRACT' not in ana or 'V9564_BATCH_FINAL_OUTPUT' not in ana:
    raise SystemExit('v9.5.68 plan/batch contracts missing')
if 'selected.size() < 2 || selected.size() > 8' not in main:
    raise SystemExit('v9.5.68 2-8 selector guard missing')

agent_java = r'''package com.futuresalarm.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// V9568_FREE_FIRST_TRADE_AGENT
// Advisory-only in-app agent. It never places, edits or closes an order.
// LLM access is hard-filtered to free model ids exposed by a user-controlled 9Router.
public class TradeAgentActivity extends Activity {
    private static final String PREF = "v9568_trade_agent";
    private static final String HISTORY = "history";
    private static final int MAX_HISTORY = 18;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ArrayList<Msg> history = new ArrayList<>();
    private LinearLayout chatBox;
    private ScrollView scroll;
    private EditText input;
    private TextView status;
    private Button deepButton;
    private boolean deepMode = false;

    private static final class Msg {
        final String role;
        final String text;
        Msg(String role, String text) { this.role = role; this.text = text; }
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("Trade Ajanı");
        deepMode = prefs().getBoolean("deep_mode", false);
        buildUi();
        loadHistory();
        if (history.isEmpty()) {
            addAssistant("Hazırım. Bir sembol ve fikrini yaz: örn. “BTC için 15m long/short senaryosu nedir?”\n\nFREE-ONLY mod yalnız 9Router'ın ücretsiz model kimliklerini kullanır. Emir açmam; veri, senaryo, risk ve tetik analizi yaparım.", false);
        }
        refreshStatusAsync();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private GradientDrawable bg(int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color); d.setCornerRadius(dp((int) radius));
        return d;
    }

    private TextView label(String text, float sp, int color, boolean bold) {
        TextView v = new TextView(this); v.setText(text); v.setTextSize(sp); v.setTextColor(color);
        if (bold) v.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return v;
    }

    private Button smallButton(String text) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setTextSize(11.5f);
        b.setTextColor(Color.WHITE); b.setMinHeight(0); b.setMinimumHeight(0);
        b.setPadding(dp(8), dp(3), dp(8), dp(3)); b.setBackground(bg(Color.rgb(31,41,55), 8));
        return b;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(10), dp(10), dp(10), dp(10)); root.setBackgroundColor(Color.rgb(7,12,20));

        LinearLayout head = new LinearLayout(this); head.setOrientation(LinearLayout.HORIZONTAL); head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = label("🧠 TRADE AJANI • FREE-FIRST", 16f, Color.WHITE, true);
        head.addView(title, new LinearLayout.LayoutParams(0, dp(42), 1f));
        Button settings = smallButton("⚙ AYAR"); settings.setOnClickListener(v -> showSettings());
        head.addView(settings, new LinearLayout.LayoutParams(dp(78), dp(40)));
        root.addView(head, new LinearLayout.LayoutParams(-1, dp(44)));

        status = label("9Router kontrol ediliyor…", 11.5f, Color.rgb(148,163,184), false);
        status.setPadding(dp(2), dp(2), dp(2), dp(7));
        root.addView(status, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this); actions.setOrientation(LinearLayout.HORIZONTAL);
        deepButton = smallButton(deepMode ? "DERİN: AÇIK" : "DERİN: KAPALI");
        deepButton.setOnClickListener(v -> {
            deepMode = !deepMode;
            prefs().edit().putBoolean("deep_mode", deepMode).apply();
            deepButton.setText(deepMode ? "DERİN: AÇIK" : "DERİN: KAPALI");
        });
        Button clear = smallButton("SOHBETİ TEMİZLE"); clear.setOnClickListener(v -> clearHistory());
        actions.addView(deepButton, new LinearLayout.LayoutParams(0, dp(40), 1f));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, dp(40), 1f); cp.setMargins(dp(7),0,0,0); actions.addView(clear, cp);
        root.addView(actions, new LinearLayout.LayoutParams(-1, dp(42)));

        scroll = new ScrollView(this); scroll.setFillViewport(true);
        chatBox = new LinearLayout(this); chatBox.setOrientation(LinearLayout.VERTICAL); chatBox.setPadding(0, dp(8), 0, dp(8));
        scroll.addView(chatBox, new ScrollView.LayoutParams(-1, -2));
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        LinearLayout sendRow = new LinearLayout(this); sendRow.setOrientation(LinearLayout.HORIZONTAL); sendRow.setGravity(Gravity.BOTTOM);
        input = new EditText(this); input.setTextColor(Color.WHITE); input.setHintTextColor(Color.rgb(100,116,139));
        input.setHint("Örn: SOL için şu an trade fikri ver"); input.setTextSize(14f); input.setMinLines(1); input.setMaxLines(5);
        input.setBackground(bg(Color.rgb(17,24,39), 10)); input.setPadding(dp(10), dp(8), dp(10), dp(8));
        sendRow.addView(input, new LinearLayout.LayoutParams(0, -2, 1f));
        Button send = smallButton("GÖNDER"); send.setTextSize(12.5f); send.setBackground(bg(Color.rgb(37,99,235), 10));
        send.setOnClickListener(v -> send());
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(88), dp(48)); sp.setMargins(dp(7),0,0,0); sendRow.addView(send, sp);
        root.addView(sendRow, new LinearLayout.LayoutParams(-1, -2));

        setContentView(root);
    }

    private void bubble(String text, boolean user) {
        TextView v = label(text, 14f, user ? Color.WHITE : Color.rgb(226,232,240), false);
        v.setTextIsSelectable(true); v.setLineSpacing(0, 1.08f); v.setPadding(dp(11), dp(9), dp(11), dp(9));
        v.setBackground(bg(user ? Color.rgb(30,64,175) : Color.rgb(15,23,42), 12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2); lp.setMargins(user ? dp(34) : 0, dp(5), user ? 0 : dp(22), dp(5));
        chatBox.addView(v, lp); scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private void addUser(String text, boolean persist) { bubble(text, true); if (persist) { history.add(new Msg("user", text)); trimSave(); } }
    private void addAssistant(String text, boolean persist) { bubble(text, false); if (persist) { history.add(new Msg("assistant", text)); trimSave(); } }

    private void send() {
        final String q = input.getText() == null ? "" : input.getText().toString().trim();
        if (q.isEmpty()) return;
        input.setText(""); addUser(q, true); status.setText("Piyasa verisi + ücretsiz modeller analiz ediliyor…");
        io.execute(() -> {
            try {
                String symbol = detectSymbol(q);
                String market = symbol == null ? "Kullanıcı mesajında net sembol yok." : marketSnapshot(symbol);
                String app = symbol == null ? "" : appContext(symbol);
                ArrayList<String> models = discoverFreeModels();
                if (models.isEmpty()) throw new Exception("9Router ücretsiz model döndürmedi. AYAR bölümünden endpoint/API anahtarını kontrol et.");
                String answer = deepMode && models.size() >= 2
                        ? deepAnswer(models, q, market, app)
                        : callWithFallback(models, systemPrompt(market, app), buildHistoryMessages());
                final String modelInfo = deepMode && models.size() >= 2 ? "DERİN ücretsiz komite" : models.get(0);
                ui.post(() -> { addAssistant(answer, true); status.setText("FREE-ONLY • " + modelInfo); });
            } catch (Throwable ex) {
                final String m = shortError(ex);
                ui.post(() -> { addAssistant("Ajan isteği tamamlanamadı: " + m + "\n\nÜcretli modele otomatik geçiş yapılmadı.", false); status.setText("Bağlantı/ücretsiz model hatası"); });
            }
        });
    }

    private String systemPrompt(String market, String app) {
        return "Sen Futures15m Alarm içindeki disiplinli trade araştırma ajanısın. "
                + "Kendini kusursuz veya piyasadan üstün ilan etme. Amaç; sayısal veriyi, çoklu zaman dilimini, akış verisini ve risk mantığını sentezleyerek tutarlı karar desteği vermektir. "
                + "Veri yoksa ASLA uydurma. Kesinlik dili kullanma. Uygulamanın hard-veto, stop, RR, geç giriş ve risk kuralları AI görüşünden üstündür. "
                + "Emir açma/kapama talimatı verme; yalnız fikir, tetik, invalidation, risk ve alternatif senaryo üret. "
                + "Trade fikri sorulursa şu sırayı kullan: KARAR (LONG ADAY/SHORT ADAY/BEKLE), GÜVEN 0-100, VERİ KALİTESİ, ANA GEREKÇE, TETİK, INVALIDATION, STOP MANTIĞI, HEDEFLER/RR, KARŞI SENARYO, NEYİ BEKLİYORUZ. "
                + "Kullanıcı sohbet etmek isterse doğal Türkçe konuş.\n\nCANLI SAYISAL BAĞLAM:\n" + market + "\n\nUYGULAMA BAĞLAMI:\n" + app;
    }

    private String deepAnswer(ArrayList<String> models, String q, String market, String app) throws Exception {
        ArrayList<String> picks = diverse(models, 3);
        ArrayList<String> opinions = new ArrayList<>();
        String base = systemPrompt(market, app) + "\nBu turda bağımsız analistsin. Diğer modelleri görmeden karar ver.";
        for (String model : picks) {
            try {
                String out = callModel(model, base, buildHistoryMessages());
                opinions.add("MODEL " + model + ":\n" + clip(out, 4500));
            } catch (Throwable ignored) { }
        }
        if (opinions.isEmpty()) throw new Exception("Ücretsiz komite modelleri yanıt vermedi");
        if (opinions.size() == 1) return opinions.get(0).substring(opinions.get(0).indexOf(':') + 1).trim();
        StringBuilder judge = new StringBuilder();
        judge.append("Aynı trade sorusuna bağımsız ücretsiz modeller yanıt verdi. Kör çoğunluk yapma; veriyle çelişeni ele. Ortak noktaları ve anlaşmazlıkları değerlendir. Son kullanıcıya tek nihai karar üret.\n\nSORU: ").append(q).append("\n\n");
        for (String x : opinions) judge.append(x).append("\n\n---\n");
        JSONArray msgs = new JSONArray();
        msgs.put(new JSONObject().put("role","user").put("content",judge.toString()));
        return callModel(picks.get(0), systemPrompt(market, app) + "\nSen komite hakemisin. Son kararında model sayısını değil kanıt kalitesini ağır bas.", msgs);
    }

    private ArrayList<String> diverse(ArrayList<String> models, int max) {
        ArrayList<String> out = new ArrayList<>(); Set<String> fam = new HashSet<>();
        for (String m : models) {
            String f = m.contains("/") ? m.substring(0, m.indexOf('/')) : "free";
            if (fam.add(f)) { out.add(m); if (out.size() >= max) return out; }
        }
        for (String m : models) if (!out.contains(m)) { out.add(m); if (out.size() >= max) break; }
        return out;
    }

    private JSONArray buildHistoryMessages() throws Exception {
        JSONArray arr = new JSONArray();
        int from = Math.max(0, history.size() - 8);
        for (int i = from; i < history.size(); i++) {
            Msg m = history.get(i); arr.put(new JSONObject().put("role", m.role).put("content", clip(m.text, 5000)));
        }
        return arr;
    }

    private String callWithFallback(ArrayList<String> models, String system, JSONArray msgs) throws Exception {
        Exception last = null;
        for (String m : models) {
            try { return callModel(m, system, msgs); }
            catch (Exception ex) { last = ex; }
        }
        throw last == null ? new Exception("Ücretsiz model yok") : last;
    }

    private String callModel(String model, String system, JSONArray msgs) throws Exception {
        JSONObject body = new JSONObject(); body.put("model", model); body.put("temperature", 0.18); body.put("max_tokens", 1500);
        JSONArray all = new JSONArray(); all.put(new JSONObject().put("role","system").put("content",system));
        for (int i=0;i<msgs.length();i++) all.put(msgs.getJSONObject(i));
        body.put("messages", all);
        String raw = request("POST", baseUrl() + "/chat/completions", body.toString(), true);
        JSONObject o = new JSONObject(raw);
        JSONArray choices = o.optJSONArray("choices");
        if (choices == null || choices.length() == 0) throw new Exception("9Router choices boş");
        Object c = choices.getJSONObject(0).optJSONObject("message").opt("content");
        if (c instanceof String) return ((String)c).trim();
        if (c instanceof JSONArray) {
            StringBuilder s = new StringBuilder(); JSONArray a=(JSONArray)c;
            for(int i=0;i<a.length();i++){ Object z=a.get(i); if(z instanceof JSONObject){ String t=((JSONObject)z).optString("text",""); if(!t.isEmpty()) s.append(t); } }
            if(s.length()>0) return s.toString().trim();
        }
        throw new Exception("9Router yanıt içeriği yok");
    }

    private ArrayList<String> discoverFreeModels() throws Exception {
        String raw = request("GET", baseUrl() + "/models", null, true);
        JSONArray data = new JSONObject(raw).optJSONArray("data");
        ArrayList<String> out = new ArrayList<>();
        if (data != null) for (int i=0;i<data.length();i++) {
            String id = data.getJSONObject(i).optString("id",""); if (isFreeModel(id)) out.add(id);
        }
        Collections.sort(out, Comparator.comparingInt(this::freeScore).reversed());
        return out;
    }

    private boolean isFreeModel(String id) {
        if (id == null) return false; String x=id.toLowerCase(Locale.US);
        return x.startsWith("oc/") || x.startsWith("kr/") || x.contains(":free") || x.startsWith("free/");
    }

    private int freeScore(String id) {
        String x=id.toLowerCase(Locale.US); int s=0;
        if(x.startsWith("oc/")) s+=1000; else if(x.startsWith("kr/")) s+=800; else s+=600;
        if(x.contains("claude")) s+=90; if(x.contains("gpt")) s+=80; if(x.contains("glm-5")) s+=70;
        if(x.contains("deepseek")) s+=60; if(x.contains("qwen")) s+=50; if(x.contains("mini")) s-=10;
        return s;
    }

    private String baseUrl() throws Exception {
        String raw = prefs().getString("endpoint", ""); raw = raw == null ? "" : raw.trim();
        if (raw.isEmpty()) throw new Exception("9Router endpoint ayarlı değil");
        while (raw.endsWith("/")) raw=raw.substring(0,raw.length()-1);
        if (!raw.endsWith("/v1")) raw += "/v1";
        URL u = new URL(raw); String proto=u.getProtocol();
        if (!"https".equalsIgnoreCase(proto) && !"http".equalsIgnoreCase(proto)) throw new Exception("Endpoint http/https olmalı");
        if ("http".equalsIgnoreCase(proto) && !privateHost(u.getHost())) throw new Exception("Uzak 9Router için HTTPS kullan. HTTP yalnız yerel ağda kabul edilir.");
        return raw;
    }

    private boolean privateHost(String h) {
        if (h == null) return false; h=h.toLowerCase(Locale.US);
        if(h.equals("localhost")||h.equals("127.0.0.1")||h.startsWith("10.")||h.startsWith("192.168.")) return true;
        if(h.startsWith("172.")) { try { int p=Integer.parseInt(h.split("\\.")[1]); return p>=16&&p<=31; } catch(Throwable ignored){} }
        return false;
    }

    private String request(String method, String url, String body, boolean auth) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(45000); c.setRequestMethod(method); c.setUseCaches(false);
        c.setRequestProperty("Accept","application/json"); c.setRequestProperty("Content-Type","application/json");
        c.setRequestProperty("User-Agent","Futures15mAlarmPRO/9.5.68");
        String key=prefs().getString("api_key",""); if(auth && key!=null && !key.trim().isEmpty()) c.setRequestProperty("Authorization","Bearer "+key.trim());
        if(body!=null){ c.setDoOutput(true); try(OutputStream out=c.getOutputStream()){ out.write(body.getBytes(StandardCharsets.UTF_8)); } }
        int code=c.getResponseCode(); InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
        String text=readAll(in); c.disconnect(); if(code<200||code>=300) throw new Exception("HTTP "+code+": "+clip(text,600)); return text;
    }

    private String publicGet(String url) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection(); c.setConnectTimeout(6000); c.setReadTimeout(9000); c.setRequestMethod("GET"); c.setRequestProperty("User-Agent","Futures15mAlarmPRO/9.5.68");
        int code=c.getResponseCode(); String text=readAll(code>=200&&code<300?c.getInputStream():c.getErrorStream()); c.disconnect(); if(code<200||code>=300) throw new Exception("market HTTP "+code); return text;
    }

    private String readAll(InputStream in) throws Exception {
        if(in==null) return ""; StringBuilder s=new StringBuilder(); try(BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){ String line; while((line=r.readLine())!=null)s.append(line); } return s.toString();
    }

    private String detectSymbol(String q) {
        String u=q.toUpperCase(Locale.US).replace("/","").replace("-","");
        Matcher m=Pattern.compile("\\b([A-Z0-9]{2,12}USDT)\\b").matcher(u); if(m.find()) return m.group(1);
        String[] known={"BTC","ETH","SOL","XRP","BNB","DOGE","ADA","AVAX","LINK","SUI","ENA","ARB","OP","TIA","NEAR","APT","SEI","PEPE","WIF","TON","TRX"};
        for(String k:known) if(Pattern.compile("\\b"+k+"\\b").matcher(u).find()) return k+"USDT";
        return null;
    }

    private String marketSnapshot(String s) {
        StringBuilder o=new StringBuilder("SYMBOL: ").append(s).append("\nSNAPSHOT_MS: ").append(System.currentTimeMillis()).append("\n");
        try { JSONObject x=new JSONObject(publicGet("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol="+s)); o.append("24H_CHANGE_PCT=").append(x.optString("priceChangePercent","?")).append(" VOLUME_USDT=").append(x.optString("quoteVolume","?")).append(" HIGH=").append(x.optString("highPrice","?")).append(" LOW=").append(x.optString("lowPrice","?")).append("\n"); } catch(Throwable e){ o.append("24H=UNAVAILABLE\n"); }
        try { JSONObject x=new JSONObject(publicGet("https://fapi.binance.com/fapi/v1/premiumIndex?symbol="+s)); o.append("MARK=").append(x.optString("markPrice","?")).append(" FUNDING=").append(x.optString("lastFundingRate","?")).append(" INDEX=").append(x.optString("indexPrice","?")).append("\n"); } catch(Throwable e){ o.append("FUNDING=UNAVAILABLE\n"); }
        try { JSONObject x=new JSONObject(publicGet("https://fapi.binance.com/fapi/v1/openInterest?symbol="+s)); o.append("OPEN_INTEREST=").append(x.optString("openInterest","?")).append("\n"); } catch(Throwable e){ o.append("OPEN_INTEREST=UNAVAILABLE\n"); }
        try { o.append(klineMetrics(s,"15m",120,"15M")); } catch(Throwable e){ o.append("15M=UNAVAILABLE\n"); }
        try { o.append(klineMetrics(s,"1h",96,"1H")); } catch(Throwable e){ o.append("1H=UNAVAILABLE\n"); }
        try { o.append(klineMetrics(s,"4h",90,"4H")); } catch(Throwable e){ o.append("4H=UNAVAILABLE\n"); }
        try { JSONObject d=new JSONObject(publicGet("https://fapi.binance.com/fapi/v1/depth?symbol="+s+"&limit=50")); JSONArray b=d.getJSONArray("bids"), a=d.getJSONArray("asks"); double bq=sumQty(b,20), aq=sumQty(a,20); double imb=(bq+aq)==0?0:(bq-aq)/(bq+aq); double bid=Double.parseDouble(b.getJSONArray(0).getString(0)), ask=Double.parseDouble(a.getJSONArray(0).getString(0)); o.append("L2_IMBALANCE=").append(f(imb)).append(" SPREAD_PCT=").append(f((ask-bid)/((ask+bid)/2.0)*100)).append("\n"); } catch(Throwable e){ o.append("L2=UNAVAILABLE\n"); }
        try { JSONArray x=new JSONArray(publicGet("https://fapi.binance.com/futures/data/takerlongshortRatio?symbol="+s+"&period=15m&limit=1")); if(x.length()>0)o.append("TAKER_BUYSELL_RATIO=").append(x.getJSONObject(0).optString("buySellRatio","?")).append("\n"); } catch(Throwable e){ o.append("TAKER_RATIO=UNAVAILABLE\n"); }
        try { JSONArray x=new JSONArray(publicGet("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol="+s+"&period=15m&limit=1")); if(x.length()>0)o.append("GLOBAL_LONGSHORT_RATIO=").append(x.getJSONObject(0).optString("longShortRatio","?")).append("\n"); } catch(Throwable e){ o.append("GLOBAL_LS=UNAVAILABLE\n"); }
        return o.toString().trim();
    }

    private String klineMetrics(String s,String interval,int limit,String tag) throws Exception {
        JSONArray k=new JSONArray(publicGet("https://fapi.binance.com/fapi/v1/klines?symbol="+s+"&interval="+interval+"&limit="+limit));
        ArrayList<Double> close=new ArrayList<>(), high=new ArrayList<>(), low=new ArrayList<>();
        for(int i=0;i<k.length();i++){ JSONArray r=k.getJSONArray(i); close.add(r.getDouble(4)); high.add(r.getDouble(2)); low.add(r.getDouble(3)); }
        double last=close.get(close.size()-1), e20=ema(close,20), e50=ema(close,50), rsi=rsi(close,14), atr=atr(high,low,close,14);
        int back=Math.min(close.size()-1, tag.equals("15M")?4:tag.equals("1H")?4:6); double ret=(last/close.get(close.size()-1-back)-1)*100.0;
        return tag+" LAST="+f(last)+" EMA20="+f(e20)+" EMA50="+f(e50)+" RSI14="+f(rsi)+" ATR_PCT="+f(atr/last*100.0)+" RET="+f(ret)+"% TREND="+(e20>e50?"UP":"DOWN")+"\n";
    }

    private double sumQty(JSONArray a,int n) throws Exception { double s=0; for(int i=0;i<Math.min(n,a.length());i++)s+=Double.parseDouble(a.getJSONArray(i).getString(1)); return s; }
    private double ema(ArrayList<Double> x,int p){ double alpha=2.0/(p+1.0), e=x.get(0); for(int i=1;i<x.size();i++)e=alpha*x.get(i)+(1-alpha)*e; return e; }
    private double rsi(ArrayList<Double>x,int p){ if(x.size()<p+1)return Double.NaN; double g=0,l=0; for(int i=x.size()-p;i<x.size();i++){ double d=x.get(i)-x.get(i-1); if(d>=0)g+=d; else l-=d; } if(l==0)return 100; double rs=(g/p)/(l/p); return 100-100/(1+rs); }
    private double atr(ArrayList<Double>h,ArrayList<Double>l,ArrayList<Double>c,int p){ if(c.size()<p+1)return Double.NaN; double s=0; for(int i=c.size()-p;i<c.size();i++){ double tr=Math.max(h.get(i)-l.get(i),Math.max(Math.abs(h.get(i)-c.get(i-1)),Math.abs(l.get(i)-c.get(i-1)))); s+=tr; } return s/p; }
    private String f(double v){ return Double.isNaN(v)?"NaN":String.format(Locale.US,"%.6f",v); }

    private String appContext(String s) {
        try {
            SharedPreferences sp=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE); Map<String,?> all=sp.getAll(); StringBuilder b=new StringBuilder();
            String[] keys={"v95_meta_"+s,"v9518_signal_state_"+s,"v9518_signal_side_"+s,"v9518_signal_price_"+s,"v9518_signal_stop_"+s,"v9518_signal_tp1_"+s,"v9518_signal_tp2_"+s,"v9518_signal_tp3_"+s,"v9545_plan_import_ts_"+s};
            for(String k:keys){ Object v=all.get(k); if(v!=null)b.append(k).append('=').append(clip(String.valueOf(v),1400)).append('\n'); }
            return b.length()==0?"Bu sembol için kayıtlı plan/sinyal bağlamı yok.":b.toString().trim();
        } catch(Throwable ignored){ return "Uygulama bağlamı okunamadı."; }
    }

    private SharedPreferences prefs(){ return getSharedPreferences(PREF,MODE_PRIVATE); }

    private void showSettings() {
        LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(18),0,dp(18),0);
        EditText ep=new EditText(this); ep.setHint("https://sunucu/v1 veya http://192.168.x.x:20128/v1"); ep.setText(prefs().getString("endpoint","")); ep.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); box.addView(ep);
        EditText key=new EditText(this); key.setHint("9Router API key (varsa)"); key.setText(prefs().getString("api_key","")); key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD); box.addView(key);
        TextView note=label("FREE-ONLY kilidi açıktır: yalnız oc/, kr/, :free veya free/ modelleri kullanılır. Ücretli modele otomatik fallback yapılmaz. PC'deki 9Router için telefondan 127.0.0.1 değil PC'nin yerel IP'sini kullan.",12f,Color.DKGRAY,false); note.setPadding(0,dp(8),0,0); box.addView(note);
        new AlertDialog.Builder(this).setTitle("9Router • ücretsiz ajan ayarı").setView(box).setNegativeButton("İPTAL",null).setPositiveButton("KAYDET",(d,w)->{
            prefs().edit().putString("endpoint",ep.getText()==null?"":ep.getText().toString().trim()).putString("api_key",key.getText()==null?"":key.getText().toString().trim()).apply(); refreshStatusAsync();
        }).show();
    }

    private void refreshStatusAsync(){ io.execute(()->{ try{ ArrayList<String> m=discoverFreeModels(); ui.post(()->status.setText("FREE-ONLY hazır • "+m.size()+" ücretsiz model")); }catch(Throwable e){ ui.post(()->status.setText("9Router ayarı gerekli • ⚙ AYAR")); } }); }

    private void clearHistory(){ history.clear(); prefs().edit().remove(HISTORY).apply(); chatBox.removeAllViews(); addAssistant("Sohbet temizlendi.",false); }

    private void loadHistory(){ try{ JSONArray a=new JSONArray(prefs().getString(HISTORY,"[]")); for(int i=0;i<a.length();i++){ JSONObject o=a.getJSONObject(i); Msg m=new Msg(o.optString("role","assistant"),o.optString("text","")); history.add(m); bubble(m.text,"user".equals(m.role)); } }catch(Throwable ignored){} }
    private void trimSave(){ while(history.size()>MAX_HISTORY)history.remove(0); try{ JSONArray a=new JSONArray(); for(Msg m:history)a.put(new JSONObject().put("role",m.role).put("text",m.text)); prefs().edit().putString(HISTORY,a.toString()).apply(); }catch(Throwable ignored){} }
    private String clip(String s,int n){ if(s==null)return ""; return s.length()<=n?s:s.substring(0,n)+"…"; }
    private String shortError(Throwable e){ String m=e.getMessage(); return e.getClass().getSimpleName()+(m==null||m.trim().isEmpty()?"":": "+m); }

    @Override protected void onDestroy(){ io.shutdownNow(); super.onDestroy(); }
}
'''

AGENT.write_text(agent_java)

# Manifest: activity + INTERNET + local-LAN HTTP support. The agent itself rejects
# non-private cleartext hosts, so remote endpoints still require HTTPS.
if 'android.permission.INTERNET' not in manifest:
    manifest = manifest.replace('<application', '<uses-permission android:name="android.permission.INTERNET"/>\n    <application', 1)
if 'android:usesCleartextTraffic=' not in manifest:
    manifest = re.sub(r'<application\b', '<application android:usesCleartextTraffic="true"', manifest, count=1)
if 'TradeAgentActivity' not in manifest:
    activity = '        <activity android:name=".TradeAgentActivity" android:exported="false" android:screenOrientation="portrait"/>\n'
    manifest = manifest.replace('</application>', activity + '    </application>', 1)
MANIFEST.write_text(manifest)

# Add a floating launch button next to the existing top helper. No trading method is changed.
if 'V9568_TRADE_AGENT_LAUNCH' not in main:
    anchor = '            frame.addView(up, fp);'
    if anchor not in main:
        raise SystemExit('v9.5.68 top-overlay anchor missing')
    insert = r'''

            // V9568_TRADE_AGENT_LAUNCH — advisory chat only; no order path.
            Button agent = new Button(this);
            agent.setTag("v9568_trade_agent");
            agent.setText("🧠 AJAN");
            agent.setAllCaps(false);
            agent.setTextSize(11.5f);
            agent.setTextColor(Color.WHITE);
            agent.setMinHeight(0); agent.setMinimumHeight(0); agent.setMinWidth(0); agent.setMinimumWidth(0);
            agent.setPadding(dp(8), dp(3), dp(8), dp(3));
            agent.setBackgroundColor(Color.rgb(88, 45, 150));
            if (android.os.Build.VERSION.SDK_INT >= 21) agent.setElevation(dp(8));
            agent.setContentDescription("Ücretsiz çoklu-model trade ajanını aç");
            agent.setOnClickListener(v -> startActivity(new android.content.Intent(this, TradeAgentActivity.class)));
            android.widget.FrameLayout.LayoutParams afp = new android.widget.FrameLayout.LayoutParams(dp(92), dp(42));
            afp.gravity = android.view.Gravity.START | android.view.Gravity.BOTTOM;
            afp.setMargins(dp(12), dp(8), dp(8), dp(18));
            frame.addView(agent, afp);
'''
    main = main.replace(anchor, anchor + insert, 1)

# Release identity. Historical protocol labels inside prompts are intentionally retained.
ana = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.68', ana)
ana = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.68', ana)
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.68', main)
main = re.sub(r'v9\.5(?:\.\d+)+', 'v9.5.68', main)
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.68', mon)
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091508', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.68'", bf, count=1)

ANALYSIS.write_text(ana)
MAIN.write_text(main)
MON.write_text(mon)
BUILD.write_text(bf)

checks = {
    'agent source': AGENT.exists() and 'V9568_FREE_FIRST_TRADE_AGENT' in AGENT.read_text(),
    'free-only filter': 'x.startsWith("oc/")' in AGENT.read_text() and 'x.startsWith("kr/")' in AGENT.read_text(),
    'no auto order': 'never places, edits or closes an order' in AGENT.read_text(),
    'market context': 'fapi.binance.com' in AGENT.read_text() and 'L2_IMBALANCE' in AGENT.read_text(),
    'deep committee': 'deepAnswer(' in AGENT.read_text() and 'diverse(models, 3)' in AGENT.read_text(),
    'deep mode persists': 'getBoolean("deep_mode", false)' in AGENT.read_text() and 'putBoolean("deep_mode", deepMode)' in AGENT.read_text(),
    'launcher': 'V9568_TRADE_AGENT_LAUNCH' in MAIN.read_text(),
    'manifest activity': 'TradeAgentActivity' in MANIFEST.read_text(),
    'same-chat retained': 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' in ANALYSIS.read_text(),
    'plan-only retained': 'V9564_PLAN_CODE_ONLY_CONTRACT' in ANALYSIS.read_text(),
    'version main': 'v9.5.68' in MAIN.read_text(),
    'version build': "versionName '9.5.68'" in BUILD.read_text() and 'versionCode 26091508' in BUILD.read_text(),
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.68 sanity failed: '+', '.join(bad))
for name,src in (('TradeAgentActivity',AGENT.read_text()),('MainActivity',MAIN.read_text()),('AnalysisPackActivity',ANALYSIS.read_text()),('MonitorService',MON.read_text())):
    ok,why=java_lex_sanity(src); print(('OK   ' if ok else 'FAIL '),'java lexical '+name,why)
    if not ok: raise SystemExit('v9.5.68 Java lexical mismatch: '+name+' — '+why)

print('v9.5.68 OK: free-only 9Router trade chat agent + Binance numeric context + optional multi-model committee added; no automatic order execution; v9.5.67 same-chat/gallery flow retained.')
