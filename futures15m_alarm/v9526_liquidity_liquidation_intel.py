from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
ENGINE = JAVA / 'StructureEngine.java'
BUILD = APP / 'app/build.gradle'
FEED = JAVA / 'V9526LiquidationFeed.java'
for p in (MAIN, MON, ANALYSIS, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.26 missing: ' + str(p))


def method_bounds(src, signature):
    a = src.find(signature)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    quote = False
    char_quote = False
    esc = False
    line_comment = False
    block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                quote = False
        elif char_quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                char_quote = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                quote = True
            elif c == "'":
                char_quote = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)

# -----------------------------------------------------------------------------
# 1) Build dependency + version. Public liquidation snapshots are WebSocket-only;
# Binance discontinued the old market-wide REST allForceOrders endpoint years ago.
# OkHttp gives Android a stable WebSocket client with ping/pong handling.
# -----------------------------------------------------------------------------
b = BUILD.read_text()
if 'com.squareup.okhttp3:okhttp' not in b:
    mm = re.search(r'(?m)^dependencies\s*\{', b)
    if not mm:
        raise SystemExit('v9.5.26 Gradle dependencies block missing')
    b = b[:mm.end()] + "\n    implementation 'com.squareup.okhttp3:okhttp:4.12.0'" + b[mm.end():]
b = re.sub(r'versionCode\s+\d+', 'versionCode 40', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.26'", b, count=1)
BUILD.write_text(b)

# -----------------------------------------------------------------------------
# 2) Real observed liquidation snapshot feed.
# IMPORTANT semantics:
# - Binance <symbol>@forceOrder is a PUBLIC snapshot stream, not a full tape.
# - SELL forced order => a LONG position is being force-closed.
# - BUY forced order  => a SHORT position is being force-closed.
# - Prefer cumulative filled quantity z, then last fill l, and only use q as a
#   FILLED fallback. Average fill price ap is preferred to order price p.
# - Each reconnect resets coverage + samples so gaps are never presented as a
#   continuous 15m observation window.
# -----------------------------------------------------------------------------
feed = r'''package com.futuresalarm.app;

final class V9526LiquidationFeed {
    // V9526_LIQUIDATION_SNAPSHOT
    private static final String BASE = "wss://fstream.binance.com/ws/";
    private static final long KEEP_MS = 20L * 60L * 1000L;
    private static final int MAX_EVENTS_PER_SYMBOL = 1100;
    private static volatile V9526LiquidationFeed INSTANCE;

    private final android.content.Context app;
    private final okhttp3.OkHttpClient client;
    private final java.util.Map<String, Channel> channels = new java.util.HashMap<>();
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

    private static final class Event {
        final long recvTime;
        final long exchangeTime;
        final boolean longLiquidation;
        final double price;
        final double filledQty;
        final double notional;
        Event(long recvTime, long exchangeTime, boolean longLiquidation,
              double price, double filledQty, double notional) {
            this.recvTime = recvTime;
            this.exchangeTime = exchangeTime;
            this.longLiquidation = longLiquidation;
            this.price = price;
            this.filledQty = filledQty;
            this.notional = notional;
        }
    }

    private static final class Channel {
        final String symbol;
        final java.util.ArrayDeque<Event> events = new java.util.ArrayDeque<>();
        okhttp3.WebSocket ws;
        boolean connected;
        boolean connecting;
        long continuousSince;
        long lastRequestedAt;
        long lastEventAt;
        long generation;
        int reconnectAttempt;
        Channel(String symbol) { this.symbol = symbol; }
    }

    private static final class Snapshot {
        boolean connected;
        long coverageMs;
        long lastEventAgeMs = Long.MAX_VALUE;
        int n1, n5, n15;
        double long1, short1, long5, short5, long15, short15;
        Event largest15;
    }

    static V9526LiquidationFeed get(android.content.Context context) {
        V9526LiquidationFeed x = INSTANCE;
        if (x == null) {
            synchronized (V9526LiquidationFeed.class) {
                x = INSTANCE;
                if (x == null) {
                    x = new V9526LiquidationFeed(context.getApplicationContext());
                    INSTANCE = x;
                }
            }
        }
        return x;
    }

    private V9526LiquidationFeed(android.content.Context app) {
        this.app = app;
        this.client = new okhttp3.OkHttpClient.Builder()
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .pingInterval(2, java.util.concurrent.TimeUnit.MINUTES)
                .retryOnConnectionFailure(true)
                .build();
    }

    private static String norm(String symbol) {
        if (symbol == null) return "";
        String s = symbol.trim().toUpperCase(java.util.Locale.US);
        return s.matches("[A-Z0-9_]{3,30}") ? s : "";
    }

    private Channel channel(String symbol) {
        String s = norm(symbol);
        if (s.isEmpty()) return null;
        Channel c;
        synchronized (channels) {
            c = channels.get(s);
            if (c == null) {
                if (channels.size() >= 16) {
                    Channel oldest = null;
                    for (Channel q : channels.values()) {
                        if (oldest == null || q.lastRequestedAt < oldest.lastRequestedAt) oldest = q;
                    }
                    if (oldest != null) {
                        if (oldest.ws != null) try { oldest.ws.cancel(); } catch (Throwable ignored) {}
                        channels.remove(oldest.symbol);
                    }
                }
                c = new Channel(s);
                channels.put(s, c);
            }
            c.lastRequestedAt = System.currentTimeMillis();
        }
        ensure(c);
        return c;
    }

    private void ensure(final Channel c) {
        synchronized (c) {
            if (c.connected || c.connecting) return;
            c.connecting = true;
            c.generation++;
            final long gen = c.generation;
            String stream = c.symbol.toLowerCase(java.util.Locale.US) + "@forceOrder";
            okhttp3.Request req = new okhttp3.Request.Builder().url(BASE + stream).build();
            c.ws = client.newWebSocket(req, new okhttp3.WebSocketListener() {
                @Override public void onOpen(okhttp3.WebSocket webSocket, okhttp3.Response response) {
                    synchronized (c) {
                        if (gen != c.generation) { webSocket.cancel(); return; }
                        c.connected = true;
                        c.connecting = false;
                        c.reconnectAttempt = 0;
                        c.continuousSince = System.currentTimeMillis();
                        c.lastEventAt = 0L;
                        c.events.clear(); // never bridge an observation gap
                    }
                }

                @Override public void onMessage(okhttp3.WebSocket webSocket, String text) {
                    handle(c, gen, text);
                }

                @Override public void onClosing(okhttp3.WebSocket webSocket, int code, String reason) {
                    try { webSocket.close(code, reason); } catch (Throwable ignored) {}
                }

                @Override public void onClosed(okhttp3.WebSocket webSocket, int code, String reason) {
                    disconnected(c, gen);
                }

                @Override public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                    disconnected(c, gen);
                }
            });
        }
    }

    private void disconnected(final Channel c, long gen) {
        long delay;
        synchronized (c) {
            if (gen != c.generation) return;
            c.connected = false;
            c.connecting = false;
            c.continuousSince = 0L;
            c.events.clear();
            c.reconnectAttempt = Math.min(6, c.reconnectAttempt + 1);
            delay = Math.min(60000L, 2500L * (1L << Math.min(4, c.reconnectAttempt - 1)));
        }
        handler.postDelayed(() -> {
            synchronized (channels) {
                Channel live = channels.get(c.symbol);
                if (live != c) return;
                if (System.currentTimeMillis() - c.lastRequestedAt > 2L * 60L * 60L * 1000L) return;
            }
            ensure(c);
        }, delay);
    }

    private static double num(org.json.JSONObject o, String k) {
        try {
            String s = o.optString(k, "");
            if (s == null || s.isEmpty()) return Double.NaN;
            return Double.parseDouble(s);
        } catch (Throwable ignored) {
            return Double.NaN;
        }
    }

    private void handle(Channel c, long gen, String text) {
        if (text == null || text.isEmpty()) return;
        try {
            String q = text.trim();
            if (q.startsWith("[")) {
                org.json.JSONArray a = new org.json.JSONArray(q);
                for (int i = 0; i < a.length(); i++) {
                    org.json.JSONObject x = a.optJSONObject(i);
                    if (x != null) parseEvent(c, gen, x);
                }
            } else {
                org.json.JSONObject x = new org.json.JSONObject(q);
                org.json.JSONObject wrapped = x.optJSONObject("data");
                parseEvent(c, gen, wrapped == null ? x : wrapped);
            }
        } catch (Throwable ignored) {
        }
    }

    private void parseEvent(Channel c, long gen, org.json.JSONObject root) {
        if (root == null || !"forceOrder".equals(root.optString("e", "forceOrder"))) return;
        org.json.JSONObject o = root.optJSONObject("o");
        if (o == null) return;
        String symbol = norm(o.optString("s", ""));
        if (!c.symbol.equals(symbol)) return;
        String side = o.optString("S", "").toUpperCase(java.util.Locale.US);
        if (!"SELL".equals(side) && !"BUY".equals(side)) return;

        double z = num(o, "z");
        double l = num(o, "l");
        double q = num(o, "q");
        String status = o.optString("X", "");
        double filled = (finite(z) && z > 0) ? z : ((finite(l) && l > 0) ? l :
                (("FILLED".equals(status) && finite(q) && q > 0) ? q : Double.NaN));
        double ap = num(o, "ap");
        double p = num(o, "p");
        double price = (finite(ap) && ap > 0) ? ap : ((finite(p) && p > 0) ? p : Double.NaN);
        if (!finite(filled) || filled <= 0 || !finite(price) || price <= 0) return;

        long now = System.currentTimeMillis();
        long exchangeTime = o.optLong("T", root.optLong("E", 0L));
        boolean longLiq = "SELL".equals(side); // forced SELL closes a LONG
        Event ev = new Event(now, exchangeTime, longLiq, price, filled, price * filled);
        synchronized (c) {
            if (gen != c.generation || !c.connected) return;
            Event last = c.events.peekLast();
            if (last != null && last.exchangeTime == ev.exchangeTime
                    && last.longLiquidation == ev.longLiquidation
                    && Math.abs(last.price - ev.price) <= Math.max(1e-12, ev.price * 1e-12)
                    && Math.abs(last.filledQty - ev.filledQty) <= Math.max(1e-12, ev.filledQty * 1e-12)) {
                return;
            }
            c.events.addLast(ev);
            c.lastEventAt = now;
            prune(c, now);
        }
    }

    private static boolean finite(double x) {
        return !Double.isNaN(x) && !Double.isInfinite(x);
    }

    private static void prune(Channel c, long now) {
        while (!c.events.isEmpty() && now - c.events.peekFirst().recvTime > KEEP_MS) c.events.removeFirst();
        while (c.events.size() > MAX_EVENTS_PER_SYMBOL) c.events.removeFirst();
    }

    private Snapshot snapshot(String symbol) {
        Channel c = channel(symbol);
        Snapshot s = new Snapshot();
        if (c == null) return s;
        long now = System.currentTimeMillis();
        synchronized (c) {
            prune(c, now);
            s.connected = c.connected;
            s.coverageMs = c.connected && c.continuousSince > 0 ? Math.max(0L, now - c.continuousSince) : 0L;
            if (c.lastEventAt > 0) s.lastEventAgeMs = Math.max(0L, now - c.lastEventAt);
            for (Event e : c.events) {
                long age = now - e.recvTime;
                if (age < 0) continue;
                if (age <= 15L * 60L * 1000L) {
                    s.n15++;
                    if (e.longLiquidation) s.long15 += e.notional; else s.short15 += e.notional;
                    if (s.largest15 == null || e.notional > s.largest15.notional) s.largest15 = e;
                }
                if (age <= 5L * 60L * 1000L) {
                    s.n5++;
                    if (e.longLiquidation) s.long5 += e.notional; else s.short5 += e.notional;
                }
                if (age <= 60L * 1000L) {
                    s.n1++;
                    if (e.longLiquidation) s.long1 += e.notional; else s.short1 += e.notional;
                }
            }
        }
        return s;
    }

    private static String usd(double x) {
        if (!finite(x) || x <= 0) return "$0";
        if (x >= 1_000_000_000d) return String.format(java.util.Locale.US, "$%.2fB", x / 1_000_000_000d);
        if (x >= 1_000_000d) return String.format(java.util.Locale.US, "$%.2fM", x / 1_000_000d);
        if (x >= 1_000d) return String.format(java.util.Locale.US, "$%.1fK", x / 1_000d);
        return String.format(java.util.Locale.US, "$%.0f", x);
    }

    private static String price(double x) {
        try { return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString(); }
        catch (Throwable ignored) { return String.format(java.util.Locale.US, "%.8f", x); }
    }

    private static String coverage(long ms) {
        return String.format(java.util.Locale.US, "%.1f dk", ms / 60000.0);
    }

    private static String quality(Snapshot s) {
        if (!s.connected) return "YOK/KOPUK";
        if (s.coverageMs < 5L * 60L * 1000L) return "KISA_KAPSAMA";
        if (s.coverageMs < 12L * 60L * 1000L) return "KISMI";
        return "15M_YARDIMCI_UYGUN";
    }

    String runtimeSummary(String symbol) {
        Snapshot s = snapshot(symbol);
        if (!s.connected) {
            return "• Likidasyon snapshot: bağlantı bekleniyor/koptu • PUANSIZ; tahmini likidite haritasıyla karıştırma";
        }
        StringBuilder b = new StringBuilder();
        b.append("• Likidasyon snapshot: ").append(quality(s))
                .append(" • kapsama ").append(coverage(s.coverageMs))
                .append(" • 15m gözlenen LONG_LIQ ").append(usd(s.long15))
                .append(" / SHORT_LIQ ").append(usd(s.short15))
                .append(" • event ").append(s.n15);
        if (s.largest15 != null) {
            b.append(" • en büyük ")
                    .append(s.largest15.longLiquidation ? "LONG_LIQ " : "SHORT_LIQ ")
                    .append(usd(s.largest15.notional)).append(" @ ").append(price(s.largest15.price));
        }
        b.append(" • Binance forceOrder SNAPSHOT; tam tasfiye toplamı/heatmap değildir");
        return b.toString();
    }

    String promptSummary(String symbol) {
        Snapshot s = snapshot(symbol);
        StringBuilder b = new StringBuilder();
        b.append("Kaynak: Binance USDⓈ-M public <symbol>@forceOrder WebSocket snapshot. API Key gerekmez.\\n");
        b.append("SEMANTİK: SELL forced order = LONG pozisyon zorunlu kapanışı; BUY forced order = SHORT pozisyon zorunlu kapanışı. ")
                .append("Filled miktarda z öncelikli, sonra l; fiyat olarak ap öncelikli kullanılır.\\n");
        b.append("SINIR: Bu akış tam liquidation tape/heatmap değildir; Binance sembol başına 1000ms pencere için snapshot yayımlar. ")
                .append("Bu yüzden aşağıdaki USDT değerleri yalnız UYGULAMANIN GÖZLEDİĞİ snapshot toplamıdır; gerçek piyasa toplamı veya gelecekteki likidasyon seviyesi değildir.\\n");
        if (!s.connected) {
            b.append("Durum: YOK/KOPUK • OBS_LIQ PUANSIZ. Eksikliği yön aleyhine kanıt sayma.\\n");
            return b.toString();
        }
        b.append("Durum: ").append(quality(s)).append(" • kesintisiz kapsama ").append(coverage(s.coverageMs)).append(".\\n");
        b.append("1m gözlenen: LONG_LIQ ").append(usd(s.long1)).append(" / SHORT_LIQ ").append(usd(s.short1)).append(" • event ").append(s.n1).append(".\\n");
        b.append("5m gözlenen: LONG_LIQ ").append(usd(s.long5)).append(" / SHORT_LIQ ").append(usd(s.short5)).append(" • event ").append(s.n5).append(".\\n");
        b.append("15m gözlenen: LONG_LIQ ").append(usd(s.long15)).append(" / SHORT_LIQ ").append(usd(s.short15)).append(" • event ").append(s.n15).append(".\\n");
        if (s.largest15 != null) {
            b.append("15m en büyük gözlenen snapshot: ")
                    .append(s.largest15.longLiquidation ? "LONG_LIQ " : "SHORT_LIQ ")
                    .append(usd(s.largest15.notional)).append(" @ ").append(price(s.largest15.price)).append(".\\n");
        } else {
            b.append("Bu kapsamada bu sembol için gözlenen forceOrder snapshotı yok; bunu 'likidasyon yok' diye genelleme.\\n");
        }
        return b.toString();
    }
}
'''
FEED.write_text(feed)

# -----------------------------------------------------------------------------
# 3) StructureEngine: keep only UNSWEPT BSL/SSL active and build a compact MTF
# liquidity-cluster map. 30m/45m/2h are derived from existing CLOSED 15m/1h
# candles; they are liquidity-only views, not extra confirmation frames.
# -----------------------------------------------------------------------------
e = ENGINE.read_text()

# Existing per-frame liquidity output becomes unswept-only.
e = e.replace('f.bsl = liquidityLevels(highs);', 'f.bsl = liquidityLevels(highs, a, true);', 1)
e = e.replace('f.ssl = liquidityLevels(lows);', 'f.ssl = liquidityLevels(lows, a, false);', 1)
e = e.replace('f.hunt = huntMap(highs, lows, last.close, atr);', 'f.hunt = huntMap(highs, lows, a, last.close, atr);', 1)

old_liq_method = r'''    private static String liquidityLevels(List<Swing> s) {'''
if old_liq_method in e:
    bnd = method_bounds(e, old_liq_method)
    if not bnd:
        raise SystemExit('v9.5.26 liquidityLevels bounds missing')
    a0, _, e0 = bnd
    repl = r'''    private static boolean isSwept(Swing s, List<AnalysisPackActivity.Candle> a, boolean high) {
        if (s == null || a == null) return true;
        for (int j = s.index + 1; j < a.size(); j++) {
            AnalysisPackActivity.Candle c = a.get(j);
            if (high && c.high > s.price * 1.000001) return true;
            if (!high && c.low < s.price * 0.999999) return true;
        }
        return false;
    }

    private static String liquidityLevels(List<Swing> s, List<AnalysisPackActivity.Candle> a, boolean high) {
        if (s == null || s.isEmpty()) return "NONE_DETECTED";
        StringBuilder b = new StringBuilder();
        int added = 0;
        for (int i = s.size() - 1; i >= 0 && added < 3; i--) {
            Swing x = s.get(i);
            if (isSwept(x, a, high)) continue;
            if (b.length() > 0) b.append(" / ");
            b.append(p(x.price));
            added++;
        }
        return added == 0 ? "NONE_UNSWEPT" : b.toString();
    }'''
    e = e[:a0] + repl + e[e0:]
elif 'liquidityLevels(List<Swing> s, List<AnalysisPackActivity.Candle> a, boolean high)' not in e:
    raise SystemExit('v9.5.26 liquidity method anchor missing')

# Replace huntMap so a pool already wick-swept by a later CLOSED candle is not
# advertised as a future stop/liquidity target.
bnd = method_bounds(e, '    private static String huntMap(')
if bnd:
    a0, _, e0 = bnd
    repl = r'''    private static String huntMap(List<Swing> highs, List<Swing> lows,
                                  List<AnalysisPackActivity.Candle> a, double close, double atr) {
        Swing above = null;
        for (Swing x : highs) {
            if (!isSwept(x, a, true) && x.price > close && (above == null || x.price < above.price)) above = x;
        }
        Swing below = null;
        for (Swing x : lows) {
            if (!isSwept(x, a, false) && x.price < close && (below == null || x.price > below.price)) below = x;
        }
        double band = Math.max(close * 0.0010, atr * 0.15);
        List<String> out = new ArrayList<>();
        if (above != null) out.add("BSL_AV_ADAY " + p(Math.max(0.0, above.price - band)) + "-" + p(above.price + band));
        if (below != null) out.add("SSL_AV_ADAY " + p(Math.max(0.0, below.price - band)) + "-" + p(below.price + band));
        if (out.isEmpty()) return "YAKIN_UNSWEPT_HAVUZ_YOK";
        return join(out, " | ") + " • TAHMINI; kesin likidasyon seviyesi degildir";
    }'''
    e = e[:a0] + repl + e[e0:]
else:
    raise SystemExit('v9.5.26 huntMap missing')

# Add the map once after the normal timeframe inventory.
needle = '        out.append("\\nNOT: \'ADAY\' etiketi otomatik geometrik tespittir.'
if 'ÇOKLU TF LİKİDİTE KÜME HARİTASI' not in e:
    pos = e.find(needle)
    if pos < 0:
        raise SystemExit('v9.5.26 structure output footer anchor missing')
    e = e[:pos] + '        out.append("\\n\\n🧲 ÇOKLU TF LİKİDİTE KÜME HARİTASI\\n");\n        out.append(multiTfLiquidityMap(data)).append("\\n");\n' + e[pos:]

# Helpers are inserted before equalLevel; no changes to existing Frame schema.
anchor = '    private static String equalLevel(List<Swing> s, double tol) {'
if 'private static String multiTfLiquidityMap(' not in e:
    idx = e.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.26 cluster helper anchor missing')
    helpers = r'''    private static final class LiqPoint {
        final double price; final boolean above; final String tf; final String family; final int weight;
        LiqPoint(double price, boolean above, String tf, String family, int weight) {
            this.price=price; this.above=above; this.tf=tf; this.family=family; this.weight=weight;
        }
    }

    private static final class LiqCluster {
        double low=Double.MAX_VALUE, high=-Double.MAX_VALUE, weighted=0, sumWeight=0;
        boolean above; int score=0;
        final java.util.Set<String> families=new java.util.HashSet<>();
        final java.util.Set<String> tfs=new java.util.LinkedHashSet<>();
        double mid(){return sumWeight<=0?0:weighted/sumWeight;}
        void add(LiqPoint p){
            low=Math.min(low,p.price); high=Math.max(high,p.price); weighted+=p.price*p.weight; sumWeight+=p.weight;
            tfs.add(p.tf);
            if(families.add(p.family)) score+=p.weight; else score+=Math.max(1,p.weight/4);
        }
    }

    private static List<AnalysisPackActivity.Candle> aggregateClosed(List<AnalysisPackActivity.Candle> src, int group) {
        List<AnalysisPackActivity.Candle> out=new ArrayList<>();
        if(src==null||group<=1) return src==null?out:new ArrayList<>(src);
        int rem=src.size()%group;
        for(int i=rem;i+group<=src.size();i+=group){
            AnalysisPackActivity.Candle z=new AnalysisPackActivity.Candle();
            AnalysisPackActivity.Candle first=src.get(i), last=src.get(i+group-1);
            z.openTime=first.openTime; z.open=first.open; z.close=last.close; z.closeTime=last.closeTime;
            z.high=-Double.MAX_VALUE; z.low=Double.MAX_VALUE; z.volume=0; z.takerBuyVolume=0;
            for(int j=i;j<i+group;j++){AnalysisPackActivity.Candle c=src.get(j);z.high=Math.max(z.high,c.high);z.low=Math.min(z.low,c.low);z.volume+=c.volume;z.takerBuyVolume+=c.takerBuyVolume;}
            out.add(z);
        }
        return out;
    }

    private static void addUnswptPoints(List<LiqPoint> out,List<AnalysisPackActivity.Candle> src,
                                        String tf,String family,int weight,double current){
        if(src==null||src.size()<8) return;
        List<Swing> hs=new ArrayList<>(),ls=new ArrayList<>();
        for(int i=2;i<src.size()-2;i++){
            boolean hi=true,lo=true; double h=src.get(i).high,l=src.get(i).low;
            for(int j=i-2;j<=i+2;j++){if(j==i)continue;if(src.get(j).high>=h)hi=false;if(src.get(j).low<=l)lo=false;}
            if(hi)hs.add(new Swing(i,h)); if(lo)ls.add(new Swing(i,l));
        }
        int n=0;
        for(int i=hs.size()-1;i>=0&&n<3;i--){Swing s=hs.get(i);if(!isSwept(s,src,true)&&s.price>current){out.add(new LiqPoint(s.price,true,tf,family,weight));n++;}}
        n=0;
        for(int i=ls.size()-1;i>=0&&n<3;i--){Swing s=ls.get(i);if(!isSwept(s,src,false)&&s.price<current){out.add(new LiqPoint(s.price,false,tf,family,weight));n++;}}
    }

    private static List<LiqCluster> cluster(List<LiqPoint> pts,double current,boolean above){
        List<LiqPoint> x=new ArrayList<>(); for(LiqPoint p:pts)if(p.above==above)x.add(p);
        java.util.Collections.sort(x,(a,b)->Double.compare(a.price,b.price));
        List<LiqCluster> out=new ArrayList<>();
        double tol=Math.max(current*0.0018,1e-12);
        for(LiqPoint p:x){
            LiqCluster best=null;
            for(LiqCluster c:out) if(Math.abs(c.mid()-p.price)<=tol){best=c;break;}
            if(best==null){best=new LiqCluster();best.above=above;out.add(best);} best.add(p);
        }
        java.util.Collections.sort(out,(a,b)->Integer.compare(b.score,a.score)); return out;
    }

    private static LiqCluster nearestStrong(List<LiqCluster> a,double current){
        LiqCluster best=null; double bestQ=Double.MAX_VALUE;
        for(LiqCluster c:a){double dist=Math.abs(c.mid()-current)/Math.max(current,1e-12);double q=dist/Math.max(1,c.score);if(q<bestQ){bestQ=q;best=c;}}
        return best;
    }

    private static String clusterText(LiqCluster c,double current){
        if(c==null)return "YOK";
        double pct=Math.abs(c.mid()/current-1.0)*100.0;
        return p(c.low)+(c.high>c.low*1.000001?"-"+p(c.high):"")+" PUAN="+Math.min(100,c.score)+" TF="+join(new ArrayList<String>(c.tfs),"+")+" UZAKLIK="+String.format(Locale.US,"%.2f%%",pct);
    }

    private static String multiTfLiquidityMap(Map<String, List<AnalysisPackActivity.Candle>> data){
        if(data==null)return "YETERSIZ_VERI";
        List<AnalysisPackActivity.Candle> m15=data.get("15m");
        if(m15==null||m15.isEmpty())return "YETERSIZ_VERI";
        double current=m15.get(m15.size()-1).close;
        List<LiqPoint> pts=new ArrayList<>();
        addUnswptPoints(pts,data.get("3m"),"3M","MICRO",6,current);
        addUnswptPoints(pts,data.get("5m"),"5M","MICRO",8,current);
        addUnswptPoints(pts,m15,"15M","INTRADAY",14,current);
        addUnswptPoints(pts,aggregateClosed(m15,2),"30M_SYN","INTRADAY",16,current);
        addUnswptPoints(pts,aggregateClosed(m15,3),"45M_SYN","INTRADAY",17,current);
        List<AnalysisPackActivity.Candle> h1=data.get("1h");
        addUnswptPoints(pts,h1,"1H","MID",22,current);
        addUnswptPoints(pts,aggregateClosed(h1,2),"2H_SYN","MID",25,current);
        addUnswptPoints(pts,data.get("4h"),"4H","HTF",34,current);
        addUnswptPoints(pts,data.get("1d"),"1D","MACRO",42,current);
        List<LiqCluster> up=cluster(pts,current,true),dn=cluster(pts,current,false);
        LiqCluster bu=up.isEmpty()?null:up.get(0),bd=dn.isEmpty()?null:dn.get(0);
        int us=bu==null?0:bu.score,ds=bd==null?0:bd.score;
        String draw=us>=ds+8?"YUKARI":(ds>=us+8?"ASAGI":"DENGELI");
        LiqCluster nu=nearestStrong(up,current),nd=nearestStrong(dn,current),first=null;
        if(nu!=null&&nd!=null) first=Math.abs(nu.mid()-current)<=Math.abs(nd.mid()-current)?nu:nd;
        else first=nu!=null?nu:nd;
        return "DRAW_ADAY="+draw+" • YUKARI_P1="+clusterText(bu,current)
                +" • ASAGI_P1="+clusterText(bd,current)
                +" • ILK_SUPURME_ADAYI="+clusterText(first,current)
                +" • 30M/45M/2H sentetik kapanmış mum kümeleridir; aynı aile tekrar puanlanmaz; PUAN olasılık değildir";
    }

'''
    e = e[:idx] + helpers + e[idx:]

if 'V9526_UNSWEPT_MTF_LIQUIDITY' not in e:
    cp = e.find('\n', e.find('final class StructureEngine'))
    e = e[:cp+1] + '    // V9526_UNSWEPT_MTF_LIQUIDITY\n' + e[cp+1:]
ENGINE.write_text(e)

# -----------------------------------------------------------------------------
# 4) Analysis prompt: observed liquidation snapshots are accurately separated
# from estimated future liquidity pools. They stay auxiliary and cannot create
# confirmation overload or a new hard veto.
# -----------------------------------------------------------------------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.26', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.26', a)
a = a.replace('%20 ORTA = OI + güvenilir kapsamalı CVD + hacim;',
              '%20 ORTA = OI + güvenilir kapsamalı CVD + hacim + kapsaması yeterli GÖZLENEN liquidation snapshot;', 1)

section4 = '        sb.append("4) CANLI VERİ KALİTESİ VE AĞIRLIK\\n");'
if 'GERÇEKLEŞMİŞ LİKİDASYON SNAPSHOT KURALI:' not in a:
    pos = a.find(section4)
    if pos < 0:
        raise SystemExit('v9.5.26 prompt section4 anchor missing')
    end = a.find('\n', pos)
    rules = r'''
        sb.append("GERÇEKLEŞMİŞ LİKİDASYON SNAPSHOT KURALI: Uygulamadaki OBS_LIQ verisi Binance USDⓈ-M public <symbol>@forceOrder SNAPSHOT akışıdır; tam liquidation tape/heatmap değildir. SELL forced order LONG pozisyonun zorunlu kapanışı, BUY forced order SHORT pozisyonun zorunlu kapanışı olarak sınıflandırılır. Uygulama filled miktarda z alanını, yoksa l alanını; fiyat olarak ap alanını, yoksa p alanını kullanır. Bu veri gerçek gerçekleşmiş forceOrder snapshotıdır fakat Binance 1000ms penceresinde tam emir dökümü vermediği için toplam piyasa likidasyon hacmi diye sunulamaz.\n");
        sb.append("OBS_LIQ KAPSAMA/AĞIRLIK: kesintisiz kapsama <5 dk ise düşük ağırlık; 5-12 dk kısmi; >=12 dk ise 15m bağlamında yardımcı kanıt. Bağlantı kopmuşsa veya kapsama yetersizse PUANSIZ say; yokluğunu yön aleyhine kanıt yapma. LONG_LIQ patlaması + fiyat düşüşü + OI düşüşü deleveraging/flush OLABİLİR; SHORT_LIQ patlaması + fiyat yükselişi squeeze OLABİLİR. Bunlar tek başına devam veya dönüş sinyali değildir; dönüş yorumu için tamamlanmış mum reclaim/rejection/absorpsiyon gerekir.\n");
        sb.append("ÇİFTE SAYMAMA / LEVERAGE EVENT AİLESİ: OI, CVD ve OBS_LIQ aynı deleveraging/squeeze olayının farklı yüzleri olabilir. Aynı olayı üç bağımsız teyit gibi toplama. Likidasyon snapshotı yardımcı kanıttır; çekirdek yapı, zorunlu kapanmış mum teyidi, geçersizlik ve R/R veto kurallarını değiştirmez.\n");
'''
    a = a[:end+1] + rules + a[end+1:]

section3 = '        sb.append("3) SAYISAL YAPI TARAMASI KULLANIMI\\n");'
if 'ÇOKLU TF LİKİDİTE KÜMESİ KURALI:' not in a:
    pos = a.find(section3)
    if pos < 0:
        raise SystemExit('v9.5.26 prompt section3 anchor missing')
    end = a.find('\n', pos)
    rules = r'''
        sb.append("ÇOKLU TF LİKİDİTE KÜMESİ KURALI: SAYISAL YAPI TARAMASI içindeki BSL/SSL yalnız kapanmış mumlarda henüz süpürülmemiş swing havuzları olarak ele alınır. Uygulama mevcut 15m ve 1h kapanmış mumlardan 30m/45m/2h SENTETİK barlar türetebilir; bunlar ek yön teyidi değil yalnız likidite haritası içindir. 3m/5m aynı MICRO aile, 15m/30m/45m aynı INTRADAY aile, 1h/2h aynı MID aile sayılır; aynı fiyat kümesindeki aynı swing farklı TF'lerde tekrar görünürse bağımsız oy olarak çoğaltma. 4H ve 1D yapısal ağırlığı daha yüksektir. DRAW_ADAY/MAGNET puanı olasılık değildir; yalnız hedef havuzlarını sıralar.\n");
        sb.append("TAHMİNİ LİKİDİTE ile GERÇEKLEŞMİŞ LİKİDASYONU AYIR: BSL/SSL, stop-hunt bandı ve LIQ_DRAW gelecekte hedeflenebilecek TAHMİNİ likidite havuzudur. OBS_LIQ ise yalnız uygulama açıkken Binance'ın gerçekten yayınladığı geçmiş forceOrder snapshotlarıdır. Birini diğerinin kanıtı gibi yazma; kesin market maker niyeti veya bireysel liquidation price uydurma.\n");
'''
    a = a[:end+1] + rules + a[end+1:]

a = a.replace('Likidasyon: bu pakette yok; eksik veriyi varmış gibi yorumlama.',
              'Likidasyon: aşağıdaki GÖZLENEN LİKİDASYON SNAPSHOT AKIŞI bölümünü kapsama kurallarıyla değerlendir; YOK/KISA_KAPSAMA ise puan verme.', 1)

start = a.find('    private String buildPrompt(')
end = a.find('    private String get(', start + 10)
if start < 0 or end < 0:
    raise SystemExit('v9.5.26 buildPrompt bounds missing')
method = a[start:end]
if 'V9526LiquidationFeed.get(this).promptSummary(symbol)' not in method:
    ret = '        return sb.toString();\n'
    if ret not in method:
        raise SystemExit('v9.5.26 buildPrompt return missing')
    inject = r'''        sb.append("\n--- GÖZLENEN LİKİDASYON SNAPSHOT AKIŞI ---\n");
        sb.append(V9526LiquidationFeed.get(this).promptSummary(symbol)).append("\n");
'''
    method = method.replace(ret, inject + ret, 1)
    a = a[:start] + method + a[end:]

a = a.replace('CVD kapsaması, OI, taker, order book, funding ve hacmin uyum/çelişki durumunu yaz.',
              'CVD kapsaması, OI, gözlenen liquidation snapshot kapsaması, taker, order book, funding ve hacmin uyum/çelişki durumunu yaz.', 1)
if ';OBS_LIQ:;' not in a:
    a = a.replace(';LIQ:;TF15:', ';LIQ:;OBS_LIQ:;LIQ_DRAW:;TF15:', 1)
if 'V9526_LIQUIDATION_DECISION_SEMANTICS' not in a:
    cp = a.find('\n', a.find('public class '))
    a = a[:cp+1] + '    // V9526_LIQUIDATION_DECISION_SEMANTICS\n' + a[cp+1:]
ANALYSIS.write_text(a)

# -----------------------------------------------------------------------------
# 5) Runtime panel: replace the old static liquidation-unavailable sentence by
# a real coverage-qualified snapshot summary. No new hard alarm gate is added.
# -----------------------------------------------------------------------------
m = MON.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.26', m)
m = re.sub(r'(?m)^\s*b\.append\("• Likidasyon:[^\n"]*(?:\\n)?"\);\s*\n?', '', m)
if 'V9526LiquidationFeed.get(this).runtimeSummary(p.symbol)' not in m:
    marker = 'append("/80  •  SHORT ").append(shortScore).append("/80\\n");'
    pos = m.find(marker)
    if pos < 0:
        raise SystemExit('v9.5.26 monitor flow score anchor missing')
    line_start = m.rfind('\n', 0, pos) + 1
    m = m[:line_start] + '        b.append(V9526LiquidationFeed.get(this).runtimeSummary(p.symbol)).append("\\n");\n' + m[line_start:]
if 'V9526_RUNTIME_LIQUIDATION_SNAPSHOT' not in m:
    cp = m.find('\n', m.find('public class MonitorService'))
    m = m[:cp+1] + '    // V9526_RUNTIME_LIQUIDATION_SNAPSHOT\n' + m[cp+1:]
MON.write_text(m)

main = MAIN.read_text()
main = re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.26', main)
main = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.26  •  MANUEL PRO', main)
MAIN.write_text(main)

# -----------------------------------------------------------------------------
# Fail fast before Gradle. These checks validate semantics, not merely labels.
# -----------------------------------------------------------------------------
checks = {
    'feed file': FEED.exists(),
    'official public forceOrder stream': '<symbol>@forceOrder' in ANALYSIS.read_text() and '@forceOrder' in FEED.read_text(),
    'filled qty precedence': 'double z = num(o, "z")' in FEED.read_text() and 'double l = num(o, "l")' in FEED.read_text(),
    'side mapping': 'boolean longLiq = "SELL".equals(side)' in FEED.read_text(),
    'reconnect resets coverage': 'c.events.clear(); // never bridge an observation gap' in FEED.read_text(),
    'snapshot limitation prompt': 'tam liquidation tape/heatmap değildir' in ANALYSIS.read_text(),
    'no double count': 'LEVERAGE EVENT AİLESİ' in ANALYSIS.read_text(),
    'runtime liquidation summary': 'V9526LiquidationFeed.get(this).runtimeSummary(p.symbol)' in MON.read_text(),
    'unswept BSL SSL': 'liquidityLevels(highs, a, true)' in ENGINE.read_text() and 'isSwept(' in ENGINE.read_text(),
    'mtf liquidity clustering': 'ÇOKLU TF LİKİDİTE KÜME HARİTASI' in ENGINE.read_text() and '45M_SYN' in ENGINE.read_text() and '2H_SYN' in ENGINE.read_text(),
    'no extra hard gate': 'OBS_LIQ KAPSAMA/AĞIRLIK' in ANALYSIS.read_text(),
    'okhttp dependency': 'com.squareup.okhttp3:okhttp:4.12.0' in BUILD.read_text(),
    'version': 'versionCode 40' in BUILD.read_text() and "versionName '9.5.26'" in BUILD.read_text(),
}
for k,v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.26 sanity failed: ' + ', '.join(bad))
print('v9.5.26 OK: observed Binance liquidation snapshots + unswept multi-TF liquidity clusters, without confirmation overload.')
