from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'
CTX = JAVA / 'V9531DecisionContext.java'

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.31 missing required file: ' + str(p))

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

ctx = r'''package com.futuresalarm.app;

/**
 * v9.5.31 auxiliary market-context engine.
 *
 * Design goal: enrich decision context WITHOUT adding a new hard signal gate.
 * It uses only Binance USD-M public endpoints and keeps a stale-safe cache.
 *
 * Research references reviewed before this independent implementation:
 * - ta4j (MIT): explicit strategy/research separation and execution realism
 * - hftbacktest (MIT): order-book / microstructure realism
 * - Hummingbot (Apache-2.0): paper/live separation and connector resilience
 * - QuantConnect LEAN (Apache-2.0): risk/context separation
 *
 * No source code from those projects is copied here. Unlicensed/GPL/restricted
 * repositories were treated as research references only, not embedded.
 */
final class V9531DecisionContext {
    private static final String BASE = "https://fapi.binance.com";
    private static final long FRESH_MS = 75_000L;
    private static final long HARD_STALE_MS = 8L * 60L * 1000L;
    private static final int MAX_SYMBOLS = 16;
    private static volatile V9531DecisionContext INSTANCE;

    private final android.content.Context app;
    private final okhttp3.OkHttpClient client;
    private final java.util.concurrent.ExecutorService pool =
            java.util.concurrent.Executors.newFixedThreadPool(3);
    private final java.util.LinkedHashMap<String, State> states =
            new java.util.LinkedHashMap<String, State>(16, 0.75f, true);

    private static final class Candle {
        long openTime, closeTime;
        double o, h, l, c, quote, takerBuyQuote;
    }

    private static final class TfPack {
        final String label;
        final int familyBit;
        final double tfWeight;
        final java.util.List<Candle> bars;
        TfPack(String label, int familyBit, double tfWeight, java.util.List<Candle> bars) {
            this.label = label;
            this.familyBit = familyBit;
            this.tfWeight = tfWeight;
            this.bars = bars;
        }
    }

    private static final class Bucket {
        double visualSum;
        double weightedPrice;
        int familyMask;
        final java.util.LinkedHashSet<String> tfs = new java.util.LinkedHashSet<>();
        final java.util.HashMap<String, Double> tfMass = new java.util.HashMap<>();
        final java.util.HashMap<String, Integer> tfFamily = new java.util.HashMap<>();
        void add(double price, double weight, int familyBit, String tf) {
            if (!finite(price) || !finite(weight) || weight <= 0) return;
            visualSum += weight;
            weightedPrice += price * weight;
            familyMask |= familyBit;
            if (tf != null && !tf.isEmpty()) {
                tfs.add(tf);
                Double old = tfMass.get(tf);
                tfMass.put(tf, (old == null ? 0.0 : old) + weight);
                tfFamily.put(tf, familyBit);
            }
        }
        double effectiveSum() {
            java.util.HashMap<Integer, Double> fam = new java.util.HashMap<>();
            for (java.util.Map.Entry<String, Double> e : tfMass.entrySet()) {
                Integer bit = tfFamily.get(e.getKey());
                if (bit == null) continue;
                Double old = fam.get(bit);
                if (old == null || e.getValue() > old) fam.put(bit, e.getValue());
            }
            double x = 0;
            for (Double v : fam.values()) if (v != null && finite(v) && v > 0) x += v;
            return x;
        }
        double center() { return visualSum > 0 ? weightedPrice / visualSum : Double.NaN; }
        int familyCount() { return Integer.bitCount(familyMask); }
    }

    private static final class Cluster {
        boolean valid;
        boolean upper;
        double low, high, center;
        double raw;
        int score;
        int familyCount;
        String tfText = "";
    }

    private static final class Regime {
        String label = "YETERSIZ";
        String direction = "NEUTRAL";
        String vol = "N/A";
        double efficiency;
        double atrPct;
        double emaGapAtr;
    }

    private static final class Book {
        boolean valid;
        double mid, spreadBps, imbalance5, imbalance20, bidWall, askWall;
        String pressure = "N/A";
    }

    private static final class Snapshot {
        long updatedAt;
        String error = "";
        Cluster upper = new Cluster();
        Cluster lower = new Cluster();
        Regime regime = new Regime();
        Book book = new Book();
    }

    private static final class State {
        final String symbol;
        volatile boolean refreshing;
        volatile long lastAttempt;
        volatile Snapshot snap;
        State(String symbol) { this.symbol = symbol; }
    }

    static V9531DecisionContext get(android.content.Context context) {
        V9531DecisionContext x = INSTANCE;
        if (x == null) {
            synchronized (V9531DecisionContext.class) {
                x = INSTANCE;
                if (x == null) {
                    x = new V9531DecisionContext(context.getApplicationContext());
                    INSTANCE = x;
                }
            }
        }
        return x;
    }

    private V9531DecisionContext(android.content.Context app) {
        this.app = app;
        this.client = new okhttp3.OkHttpClient.Builder()
                .connectTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .callTimeout(35, java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
    }

    private static boolean finite(double x) {
        return !Double.isNaN(x) && !Double.isInfinite(x);
    }

    private static double clamp(double x, double lo, double hi) {
        return Math.max(lo, Math.min(hi, x));
    }

    private static String norm(String symbol) {
        if (symbol == null) return "";
        String s = symbol.trim().toUpperCase(java.util.Locale.US);
        return s.matches("[A-Z0-9_]{3,30}") ? s : "";
    }

    private State state(String symbol) {
        String s = norm(symbol);
        if (s.isEmpty()) return null;
        synchronized (states) {
            State st = states.get(s);
            if (st == null) {
                if (states.size() >= MAX_SYMBOLS) {
                    java.util.Iterator<java.util.Map.Entry<String, State>> it =
                            states.entrySet().iterator();
                    if (it.hasNext()) {
                        it.next();
                        it.remove();
                    }
                }
                st = new State(s);
                states.put(s, st);
            }
            return st;
        }
    }

    private void ensureFresh(State st) {
        if (st == null) return;
        long now = System.currentTimeMillis();
        Snapshot q = st.snap;
        if (q != null && now - q.updatedAt < FRESH_MS) return;
        synchronized (st) {
            if (st.refreshing) return;
            if (now - st.lastAttempt < 20_000L) return;
            st.refreshing = true;
            st.lastAttempt = now;
        }
        pool.execute(() -> {
            try {
                Snapshot next = load(st.symbol);
                if (next != null) st.snap = next;
            } catch (Throwable t) {
                Snapshot old = st.snap;
                if (old == null) {
                    Snapshot bad = new Snapshot();
                    bad.updatedAt = System.currentTimeMillis();
                    bad.error = t.getClass().getSimpleName();
                    st.snap = bad;
                }
            } finally {
                synchronized (st) { st.refreshing = false; }
            }
        });
    }

    private org.json.JSONArray getArray(String path) throws java.io.IOException {
        okhttp3.Request req = new okhttp3.Request.Builder().url(BASE + path).get().build();
        try (okhttp3.Response res = client.newCall(req).execute()) {
            if (!res.isSuccessful() || res.body() == null) {
                throw new java.io.IOException("HTTP " + res.code());
            }
            return new org.json.JSONArray(res.body().string());
        }
    }

    private org.json.JSONObject getObject(String path) throws java.io.IOException {
        okhttp3.Request req = new okhttp3.Request.Builder().url(BASE + path).get().build();
        try (okhttp3.Response res = client.newCall(req).execute()) {
            if (!res.isSuccessful() || res.body() == null) {
                throw new java.io.IOException("HTTP " + res.code());
            }
            return new org.json.JSONObject(res.body().string());
        }
    }

    private java.util.List<Candle> klines(String symbol, String interval, int limit)
            throws java.io.IOException {
        String path = "/fapi/v1/klines?symbol=" + symbol + "&interval=" + interval + "&limit=" + limit;
        org.json.JSONArray a = getArray(path);
        java.util.ArrayList<Candle> out = new java.util.ArrayList<>();
        long now = System.currentTimeMillis();
        for (int i = 0; i < a.length(); i++) {
            org.json.JSONArray r = a.optJSONArray(i);
            if (r == null || r.length() < 11) continue;
            Candle c = new Candle();
            c.openTime = r.optLong(0, 0L);
            c.o = num(r, 1);
            c.h = num(r, 2);
            c.l = num(r, 3);
            c.c = num(r, 4);
            c.closeTime = r.optLong(6, 0L);
            c.quote = num(r, 7);
            c.takerBuyQuote = num(r, 10);
            if (c.closeTime <= 0 || c.closeTime >= now) continue;
            if (!finite(c.o) || !finite(c.h) || !finite(c.l) || !finite(c.c)
                    || c.o <= 0 || c.h <= 0 || c.l <= 0 || c.c <= 0) continue;
            if (!finite(c.quote) || c.quote < 0) c.quote = 0;
            if (!finite(c.takerBuyQuote) || c.takerBuyQuote < 0) c.takerBuyQuote = c.quote * 0.5;
            out.add(c);
        }
        return out;
    }

    private static double num(org.json.JSONArray a, int idx) {
        try {
            Object v = a.opt(idx);
            if (v == null) return Double.NaN;
            return Double.parseDouble(String.valueOf(v));
        } catch (Throwable ignored) {
            return Double.NaN;
        }
    }

    private Snapshot load(String symbol) {
        Snapshot s = new Snapshot();
        Book book = safeBook(symbol);
        s.book = book;
        double current = book.valid ? book.mid : Double.NaN;

        java.util.List<Candle> m15 = safeKlines(symbol, "15m", 192);
        java.util.List<Candle> m30 = safeKlines(symbol, "30m", 120);
        java.util.List<Candle> m45 = aggregate(m15, 3);
        java.util.List<Candle> h1 = safeKlines(symbol, "1h", 120);
        java.util.List<Candle> h2 = safeKlines(symbol, "2h", 120);
        java.util.List<Candle> h4 = safeKlines(symbol, "4h", 120);
        java.util.List<Candle> d1 = safeKlines(symbol, "1d", 90);

        if (!finite(current) || current <= 0) {
            if (!m15.isEmpty()) current = m15.get(m15.size() - 1).c;
            else if (!h1.isEmpty()) current = h1.get(h1.size() - 1).c;
        }

        s.regime = regime(h1);
        java.util.ArrayList<TfPack> packs = new java.util.ArrayList<>();
        packs.add(new TfPack("15m", 1, 0.85, m15));
        packs.add(new TfPack("30m", 1, 0.95, m30));
        packs.add(new TfPack("45m_SYN", 1, 1.00, m45));
        packs.add(new TfPack("1H", 2, 1.05, h1));
        packs.add(new TfPack("2H", 2, 1.15, h2));
        packs.add(new TfPack("4H", 4, 1.35, h4));
        packs.add(new TfPack("1D", 8, 1.55, d1));

        Cluster[] cs = liquidationDensity(packs, current);
        s.lower = cs[0];
        s.upper = cs[1];
        s.updatedAt = System.currentTimeMillis();
        return s;
    }

    private Book safeBook(String symbol) {
        try { return loadBook(symbol); }
        catch (Throwable ignored) { return new Book(); }
    }

    private java.util.List<Candle> safeKlines(String symbol, String interval, int limit) {
        try { return klines(symbol, interval, limit); }
        catch (Throwable ignored) { return new java.util.ArrayList<>(); }
    }

    private static java.util.List<Candle> aggregate(java.util.List<Candle> src, int group) {
        java.util.ArrayList<Candle> out = new java.util.ArrayList<>();
        if (src == null || group <= 1 || src.size() < group) return out;
        int start = src.size() % group;
        for (int i = start; i + group <= src.size(); i += group) {
            Candle first = src.get(i);
            Candle last = src.get(i + group - 1);
            Candle x = new Candle();
            x.openTime = first.openTime;
            x.closeTime = last.closeTime;
            x.o = first.o;
            x.c = last.c;
            x.h = -Double.MAX_VALUE;
            x.l = Double.MAX_VALUE;
            for (int j = i; j < i + group; j++) {
                Candle c = src.get(j);
                x.h = Math.max(x.h, c.h);
                x.l = Math.min(x.l, c.l);
                x.quote += Math.max(0, c.quote);
                x.takerBuyQuote += Math.max(0, c.takerBuyQuote);
            }
            if (finite(x.h) && finite(x.l) && x.h > 0 && x.l > 0) out.add(x);
        }
        return out;
    }

    private Book loadBook(String symbol) throws java.io.IOException {
        org.json.JSONObject o = getObject("/fapi/v1/depth?symbol=" + symbol + "&limit=50");
        org.json.JSONArray bids = o.optJSONArray("bids");
        org.json.JSONArray asks = o.optJSONArray("asks");
        Book b = new Book();
        if (bids == null || asks == null || bids.length() == 0 || asks.length() == 0) return b;
        double bestBid = rowNum(bids.optJSONArray(0), 0);
        double bestAsk = rowNum(asks.optJSONArray(0), 0);
        if (!finite(bestBid) || !finite(bestAsk) || bestBid <= 0 || bestAsk <= bestBid) return b;
        b.mid = (bestBid + bestAsk) * 0.5;
        b.spreadBps = (bestAsk - bestBid) / b.mid * 10000.0;

        double bid5 = sideWeighted(bids, 5), ask5 = sideWeighted(asks, 5);
        double bid20 = sideWeighted(bids, 20), ask20 = sideWeighted(asks, 20);
        b.imbalance5 = imbalance(bid5, ask5);
        b.imbalance20 = imbalance(bid20, ask20);
        b.bidWall = wallShare(bids, 20);
        b.askWall = wallShare(asks, 20);
        double p = 0.65 * b.imbalance5 + 0.35 * b.imbalance20;
        if (p >= 0.18) b.pressure = "BID_PRESSURE";
        else if (p <= -0.18) b.pressure = "ASK_PRESSURE";
        else b.pressure = "DENGELI";
        b.valid = true;
        return b;
    }

    private static double rowNum(org.json.JSONArray row, int idx) {
        if (row == null) return Double.NaN;
        try { return Double.parseDouble(row.optString(idx, "")); }
        catch (Throwable ignored) { return Double.NaN; }
    }

    private static double sideWeighted(org.json.JSONArray side, int n) {
        double sum = 0;
        int lim = Math.min(n, side == null ? 0 : side.length());
        for (int i = 0; i < lim; i++) {
            org.json.JSONArray r = side.optJSONArray(i);
            double p = rowNum(r, 0), q = rowNum(r, 1);
            if (!finite(p) || !finite(q) || p <= 0 || q <= 0) continue;
            double w = 1.0 / (1.0 + 0.18 * i);
            sum += p * q * w;
        }
        return sum;
    }

    private static double wallShare(org.json.JSONArray side, int n) {
        double total = 0, max = 0;
        int lim = Math.min(n, side == null ? 0 : side.length());
        for (int i = 0; i < lim; i++) {
            org.json.JSONArray r = side.optJSONArray(i);
            double p = rowNum(r, 0), q = rowNum(r, 1);
            if (!finite(p) || !finite(q) || p <= 0 || q <= 0) continue;
            double x = p * q;
            total += x;
            if (x > max) max = x;
        }
        return total > 0 ? max / total : 0;
    }

    private static double imbalance(double bid, double ask) {
        double d = bid + ask;
        return d > 0 ? (bid - ask) / d : 0;
    }

    private static Regime regime(java.util.List<Candle> bars) {
        Regime r = new Regime();
        if (bars == null || bars.size() < 55) return r;
        int n = bars.size();
        double ema20 = bars.get(0).c, ema50 = bars.get(0).c;
        double a20 = 2.0 / 21.0, a50 = 2.0 / 51.0;
        java.util.ArrayList<Double> tr = new java.util.ArrayList<>();
        double prev = bars.get(0).c;
        for (int i = 1; i < n; i++) {
            Candle c = bars.get(i);
            ema20 += a20 * (c.c - ema20);
            ema50 += a50 * (c.c - ema50);
            double x = Math.max(c.h - c.l, Math.max(Math.abs(c.h - prev), Math.abs(c.l - prev)));
            if (finite(x) && x >= 0) tr.add(x);
            prev = c.c;
        }
        if (tr.size() < 20) return r;
        int atrN = Math.min(14, tr.size());
        double atr = 0;
        for (int i = tr.size() - atrN; i < tr.size(); i++) atr += tr.get(i);
        atr /= atrN;
        double last = bars.get(n - 1).c;
        r.atrPct = last > 0 ? atr / last * 100.0 : 0;
        r.emaGapAtr = atr > 0 ? Math.abs(ema20 - ema50) / atr : 0;

        int look = Math.min(20, n - 1);
        double net = Math.abs(bars.get(n - 1).c - bars.get(n - 1 - look).c);
        double path = 0;
        for (int i = n - look; i < n; i++) {
            path += Math.abs(bars.get(i).c - bars.get(i - 1).c);
        }
        r.efficiency = path > 0 ? net / path : 0;

        java.util.ArrayList<Double> sorted = new java.util.ArrayList<>(tr);
        java.util.Collections.sort(sorted);
        double medianTr = sorted.get(sorted.size() / 2);
        if (medianTr > 0 && atr > medianTr * 1.55) r.vol = "YUKSEK";
        else if (medianTr > 0 && atr < medianTr * 0.72) r.vol = "DUSUK";
        else r.vol = "NORMAL";

        r.direction = ema20 > ema50 ? "LONG" : (ema20 < ema50 ? "SHORT" : "NEUTRAL");
        if (r.efficiency >= 0.36 && r.emaGapAtr >= 0.55) r.label = "TREND";
        else if (r.efficiency <= 0.24 && r.emaGapAtr <= 0.45) r.label = "RANGE";
        else r.label = "GECIS";
        return r;
    }

    private static Cluster[] liquidationDensity(java.util.List<TfPack> packs, double current) {
        Cluster lower = new Cluster();
        Cluster upper = new Cluster();
        if (!finite(current) || current <= 0) return new Cluster[]{lower, upper};

        double atrRef = 0;
        for (TfPack p : packs) {
            if ("15m".equals(p.label) && p.bars.size() >= 15) {
                atrRef = atr(p.bars, 14);
                break;
            }
        }
        double bin = Math.max(current * 0.0030, finite(atrRef) && atrRef > 0 ? atrRef * 0.30 : 0);
        if (!finite(bin) || bin <= 0) bin = current * 0.0030;

        java.util.HashMap<Long, Bucket> lowerMap = new java.util.HashMap<>();
        java.util.HashMap<Long, Bucket> upperMap = new java.util.HashMap<>();
        final int[] lev = {5, 10, 20, 50};
        final double[] levW = {0.24, 0.34, 0.27, 0.15};
        final double mmr = 0.004;

        for (TfPack p : packs) {
            java.util.List<Candle> bars = p.bars;
            int n = bars == null ? 0 : bars.size();
            if (n < 12) continue;

            double[] suffixMin = new double[n];
            double[] suffixMax = new double[n];
            suffixMin[n - 1] = Double.POSITIVE_INFINITY;
            suffixMax[n - 1] = Double.NEGATIVE_INFINITY;
            double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
            for (int i = n - 2; i >= 0; i--) {
                Candle next = bars.get(i + 1);
                min = Math.min(min, next.l);
                max = Math.max(max, next.h);
                suffixMin[i] = min;
                suffixMax[i] = max;
            }

            double halfLifeBars = "1D".equals(p.label) ? 24.0 :
                    ("4H".equals(p.label) ? 30.0 : 42.0);

            for (int i = 0; i < n - 1; i++) {
                Candle c = bars.get(i);
                if (c.quote <= 0) continue;
                double entry = (c.o + c.h + c.l + c.c) * 0.25;
                if (!finite(entry) || entry <= 0) continue;

                double buyRatio = c.quote > 0 ? clamp(c.takerBuyQuote / c.quote, 0, 1) : 0.5;
                double longShare = clamp(0.15 + 0.70 * buyRatio, 0.15, 0.85);
                double shortShare = 1.0 - longShare;

                int ageBars = (n - 1) - i;
                double decay = Math.exp(-Math.log(2.0) * ageBars / halfLifeBars);
                double activity = Math.sqrt(Math.max(1.0, c.quote)) * decay * p.tfWeight;

                for (int k = 0; k < lev.length; k++) {
                    double L = lev[k];
                    double longLiq = entry * (1.0 - 1.0 / L + mmr);
                    double shortLiq = entry * (1.0 + 1.0 / L - mmr);

                    boolean longConsumed = suffixMin[i] <= longLiq;
                    boolean shortConsumed = suffixMax[i] >= shortLiq;

                    if (!longConsumed && longLiq < current && longLiq > current * 0.82) {
                        long key = Math.round(longLiq / bin);
                        Bucket b = lowerMap.get(key);
                        if (b == null) { b = new Bucket(); lowerMap.put(key, b); }
                        b.add(longLiq, activity * longShare * levW[k], p.familyBit, p.label);
                    }
                    if (!shortConsumed && shortLiq > current && shortLiq < current * 1.18) {
                        long key = Math.round(shortLiq / bin);
                        Bucket b = upperMap.get(key);
                        if (b == null) { b = new Bucket(); upperMap.put(key, b); }
                        b.add(shortLiq, activity * shortShare * levW[k], p.familyBit, p.label);
                    }
                }
            }
        }

        lower = bestCluster(lowerMap, bin, false);
        upper = bestCluster(upperMap, bin, true);
        return new Cluster[]{lower, upper};
    }

    private static Cluster bestCluster(java.util.Map<Long, Bucket> map, double bin, boolean upper) {
        Cluster out = new Cluster();
        if (map == null || map.isEmpty()) return out;
        Bucket best = null;
        java.util.ArrayList<Double> masses = new java.util.ArrayList<>();
        for (Bucket b : map.values()) {
            if (b == null || b.effectiveSum() <= 0) continue;
            masses.add(b.effectiveSum());
            if (best == null || adjusted(b) > adjusted(best)) best = b;
        }
        if (best == null || masses.isEmpty()) return out;
        java.util.Collections.sort(masses);
        double med = masses.get(masses.size() / 2);
        double eff = best.effectiveSum();
        double ratio = eff / Math.max(1e-12, eff + med);
        int score = (int)Math.round(clamp(35.0 + 45.0 * ratio + 5.0 * Math.min(4, best.familyCount()), 0, 99));
        out.valid = true;
        out.upper = upper;
        out.center = best.center();
        out.low = out.center - bin * 0.55;
        out.high = out.center + bin * 0.55;
        out.raw = best.effectiveSum();
        out.score = score;
        out.familyCount = best.familyCount();
        out.tfText = joinTfs(best.tfs);
        return out;
    }

    private static double adjusted(Bucket b) {
        return b.effectiveSum() * (1.0 + 0.10 * Math.max(0, b.familyCount() - 1));
    }

    private static String joinTfs(java.util.Set<String> tfs) {
        if (tfs == null || tfs.isEmpty()) return "-";
        StringBuilder b = new StringBuilder();
        for (String x : tfs) {
            if (b.length() > 0) b.append("+");
            b.append(x);
        }
        return b.toString();
    }

    private static double atr(java.util.List<Candle> bars, int n) {
        if (bars == null || bars.size() < n + 1) return Double.NaN;
        double sum = 0;
        int from = bars.size() - n;
        for (int i = from; i < bars.size(); i++) {
            Candle c = bars.get(i);
            double prev = bars.get(i - 1).c;
            sum += Math.max(c.h - c.l, Math.max(Math.abs(c.h - prev), Math.abs(c.l - prev)));
        }
        return sum / n;
    }

    private static String px(double x) {
        if (!finite(x) || x <= 0) return "-";
        try { return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString(); }
        catch (Throwable ignored) { return String.format(java.util.Locale.US, "%.8f", x); }
    }

    private static String pct(double x) {
        return String.format(java.util.Locale.US, "%.2f%%", x);
    }

    private static String clusterShort(Cluster c, double current) {
        if (c == null || !c.valid) return "yok";
        double d = current > 0 ? (c.center / current - 1.0) * 100.0 : 0;
        return px(c.low) + "-" + px(c.high) + " " + c.score + "/100 " +
                c.tfText + " (" + (d >= 0 ? "+" : "") + pct(d) + ")";
    }

    String runtimeSummary(String symbol) {
        State st = state(symbol);
        if (st == null) return "• Context intelligence: geçersiz sembol • PUANSIZ";
        ensureFresh(st);
        Snapshot s = st.snap;
        long now = System.currentTimeMillis();
        if (s == null) return "• Context intelligence: veri ısınıyor • PUANSIZ";
        long age = Math.max(0, now - s.updatedAt);
        if (age > HARD_STALE_MS) {
            return "• Context intelligence: veri bayat (" + (age / 1000L) + "sn) • PUANSIZ";
        }
        double current = s.book.valid ? s.book.mid :
                (s.lower.valid && s.upper.valid ? (s.lower.center + s.upper.center) * 0.5 : 0);
        StringBuilder b = new StringBuilder();
        b.append("• Context v9.5.31: ");
        b.append("LIQ_DENS ALT ").append(clusterShort(s.lower, current));
        b.append(" | UST ").append(clusterShort(s.upper, current));
        b.append(" | REGIME ").append(s.regime.label).append("/").append(s.regime.direction)
                .append(" vol=").append(s.regime.vol);
        if (s.book.valid) {
            b.append(" | BOOK ").append(s.book.pressure)
                    .append(" imb5=").append(String.format(java.util.Locale.US, "%+.0f%%", s.book.imbalance5 * 100.0))
                    .append(" spread=").append(String.format(java.util.Locale.US, "%.1fbp", s.book.spreadBps));
        }
        b.append(" • YARDIMCI/TIE-BREAK; hard gate değil");
        return b.toString();
    }

    String promptSummary(String symbol) {
        State st = state(symbol);
        if (st == null) return "V9.5.31 context: geçersiz sembol; PUANSIZ.";
        ensureFresh(st);
        Snapshot s = st.snap;
        if (s == null) {
            return "V9.5.31 context verisi henüz hazır değil. EKSİK VERİYİ PUANSIZ say; sinyali sırf bu yüzden engelleme.";
        }
        long age = Math.max(0, System.currentTimeMillis() - s.updatedAt);
        if (age > HARD_STALE_MS) {
            return "V9.5.31 context verisi bayat (" + (age / 1000L) + " sn). PUANSIZ say; yön aleyhine kanıt yapma.";
        }

        double current = s.book.valid ? s.book.mid :
                (s.lower.valid && s.upper.valid ? (s.lower.center + s.upper.center) * 0.5 : 0);
        StringBuilder b = new StringBuilder();
        b.append("V9.5.31 KARAR BAGLAMI — BU BOLUM YARDIMCI/TIE-BREAK'tir, YENI HARD GATE DEGILDIR.\n");
        b.append("LIQ_DENS modeli: Binance public tamamlanmis 15m/30m/45m(synthetic)/1H/2H/4H/1D mumlarindaki quote-volume + taker dengesini, ")
                .append("kaldirac sepetlerini ve yas decay'ini kullanarak UNSWEPT tahmini liquidation yogunlugu uretir. ")
                .append("Bireysel pozisyon/liquidation price bilmez; CoinGlass/Hyblock verisi degildir; skor olasilik degildir.\n");
        b.append("ALT LONG-liquidation tahmini küme: ").append(clusterShort(s.lower, current)).append(".\n");
        b.append("UST SHORT-liquidation tahmini küme: ").append(clusterShort(s.upper, current)).append(".\n");
        b.append("KUME KULLANIMI: hedef/TP yolu, sweep riski ve hangi tarafta daha yogun cekim alani oldugunu siralamak icindir. ")
                .append("Tek basina LONG/SHORT alarmi acamaz veya mevcut cekirdek mum teyidini iptal edemez. ")
                .append("Ayni fiyat farkli TF'lerde gorunuyorsa TF aileleri dedupe edilir; 15m+30m+45m tek INTRADAY, 1H+2H tek MID ailesidir; ayni ailede ayni fiyat kumesinde sadece en guclu TF katkisi sayilir.\n");

        b.append("REGIME 1H: ").append(s.regime.label).append(" / yon ").append(s.regime.direction)
                .append(" / vol ").append(s.regime.vol)
                .append(" / efficiency=").append(String.format(java.util.Locale.US, "%.2f", s.regime.efficiency))
                .append(" / EMA-gap=").append(String.format(java.util.Locale.US, "%.2f ATR", s.regime.emaGapAtr))
                .append(" / ATR=").append(String.format(java.util.Locale.US, "%.2f%%", s.regime.atrPct)).append(".\n");
        b.append("REGIME KULLANIMI: TREND uyumu sadece yumusak guven artisi; ters yon, eger plan reversal ise ve tamamlanmis mum reclaim/rejection veriyorsa veto degildir. ")
                .append("RANGE durumunda breakout icin kapanis teyidi daha onemli sayilir; regime tek basina yon secmez.\n");

        if (s.book.valid) {
            b.append("BOOK_MICRO: ").append(s.book.pressure)
                    .append(" | imb5=").append(String.format(java.util.Locale.US, "%+.1f%%", s.book.imbalance5 * 100.0))
                    .append(" | imb20=").append(String.format(java.util.Locale.US, "%+.1f%%", s.book.imbalance20 * 100.0))
                    .append(" | bidWall=").append(String.format(java.util.Locale.US, "%.0f%%", s.book.bidWall * 100.0))
                    .append(" | askWall=").append(String.format(java.util.Locale.US, "%.0f%%", s.book.askWall * 100.0))
                    .append(" | spread=").append(String.format(java.util.Locale.US, "%.2fbp", s.book.spreadBps)).append(".\n");
            b.append("BOOK KULLANIMI: order book hizli degisir; sadece entry timing/near-threshold tie-break icin kullan. ")
                    .append("15m/1H/4H yapiyi, STOP gecersizligini veya tamamlanmis mum teyidini override etme.\n");
        } else {
            b.append("BOOK_MICRO: yok/hatali; PUANSIZ.\n");
        }

        b.append("AILE TAVANI / CIFT SAYMAMA: OI + CVD + OBS_LIQ + LIQ_DENS ayni leverage/flow olayinin farkli yuzleri olabilir; ")
                .append("bunlari dort bagimsiz teyit gibi toplama. BOOK_MICRO execution ailesidir. REGIME context ailesidir. ")
                .append("Her aileden en fazla bir guclu oy degeri ver; eksik veya bayat veri PUANSIZDIR.\n");
        b.append("SINYALE ETKI SINIRI: V9.5.31 baglami tek basina ALARM VAR/YOK sonucunu degistirmesin. ")
                .append("Cekirdek plan + zorunlu kapanmis mum teyidi + invalidation + R/R kurallari zaten yeterliyse sinyali bogma; ")
                .append("yalniz celiskili ve sinira yakin durumlarda guveni bir kademe ayarla veya hedef yolunu sirala.");
        return b.toString();
    }
}
'''
CTX.write_text(ctx)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 26091202', b, count=1)
b = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.31'", b, count=1)
BUILD.write_text(b)

m = MAIN.read_text()
m = m.replace('v9.5.30', 'v9.5.31')
m = m.replace('v9.5.29', 'v9.5.31')
MAIN.write_text(m)

mon = MON.read_text()
if 'V9531DecisionContext.get(this).runtimeSummary(p.symbol)' not in mon:
    anchor = 'b.append(V9526LiquidationFeed.get(this).runtimeSummary(p.symbol)).append("\\n");'
    pos = mon.find(anchor)
    if pos >= 0:
        end = pos + len(anchor)
        mon = mon[:end] + '\n        b.append(V9531DecisionContext.get(this).runtimeSummary(p.symbol)).append("\\n");' + mon[end:]
    else:
        marker = 'append("/80  •  SHORT ").append(shortScore).append("/80\\n");'
        pos = mon.find(marker)
        if pos < 0:
            raise SystemExit('v9.5.31 monitor anchor missing')
        line_start = mon.rfind('\n', 0, pos) + 1
        mon = mon[:line_start] + '        b.append(V9531DecisionContext.get(this).runtimeSummary(p.symbol)).append("\\n");\n' + mon[line_start:]
if 'V9531_SOFT_CONTEXT_ONLY' not in mon:
    cp = mon.find('\n', mon.find('public class MonitorService'))
    if cp > 0:
        mon = mon[:cp+1] + '    // V9531_SOFT_CONTEXT_ONLY\n' + mon[cp+1:]
MON.write_text(mon)

a = ANALYSIS.read_text()
bounds = method_bounds(a, '    private String buildPrompt(')
if not bounds:
    raise SystemExit('v9.5.31 buildPrompt bounds missing')
start, brace, end = bounds
method = a[start:end]
if 'V9531DecisionContext.get(this).promptSummary(symbol)' not in method:
    ret = '        return sb.toString();\n'
    if ret not in method:
        raise SystemExit('v9.5.31 buildPrompt return missing')
    inject = r'''        sb.append("\n--- V9.5.31 YARDIMCI KARAR BAGLAMI ---\n");
        sb.append(V9531DecisionContext.get(this).promptSummary(symbol)).append("\n");
'''
    method = method.replace(ret, inject + ret, 1)
    a = a[:start] + method + a[end:]

if 'V9531_FAMILY_CAP_RULE' not in a:
    marker = 'ÇİFTE SAYMAMA / LEVERAGE EVENT AİLESİ'
    pos = a.find(marker)
    if pos >= 0:
        line_end = a.find('\n', pos)
        if line_end > 0:
            extra = r'''
        sb.append("V9.5.31 FAKTOR AILE TAVANI: Yapı/likidite, leverage/flow ve execution/microstructure ailelerini ayır. Aynı ailedeki korelasyonlu metrikleri bağımsız oy diye çoğaltma. LIQ_DENS/REGIME/BOOK_MICRO yalnız yardımcı bağlamdır; tek başına yeni veto üretmez. Eksik/bayat context PUANSIZ.\n");
'''
            a = a[:line_end+1] + extra + a[line_end+1:]
    cp = a.find('\n', a.find('public class '))
    if cp > 0:
        a = a[:cp+1] + '    // V9531_FAMILY_CAP_RULE\n' + a[cp+1:]
ANALYSIS.write_text(a)

checks = {
    'context java created': CTX.exists() and 'LIQ_DENS modeli' in CTX.read_text(),
    'orderbook soft context': 'BOOK KULLANIMI' in CTX.read_text(),
    'regime soft context': 'REGIME KULLANIMI' in CTX.read_text(),
    'family cap': 'AILE TAVANI / CIFT SAYMAMA' in CTX.read_text(),
    'monitor injection': 'V9531DecisionContext.get(this).runtimeSummary(p.symbol)' in MON.read_text(),
    'prompt injection': 'V9531DecisionContext.get(this).promptSummary(symbol)' in ANALYSIS.read_text(),
    'version code': 'versionCode 26091202' in BUILD.read_text(),
    'version name': "versionName '9.5.31'" in BUILD.read_text(),
}
failed = [k for k, v in checks.items() if not v]
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
if failed:
    raise SystemExit('v9.5.31 sanity failed: ' + ', '.join(failed))

print('v9.5.31 OK: MTF liquidation density + regime + orderbook microstructure as soft context only.')
