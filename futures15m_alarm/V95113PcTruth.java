package com.futuresalarm.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

// CLAUDE_V113_ANDROID_LIVE_TRUTH
// The phone shows PC LIVE as AÇIK/KAPALI only when the PC itself confirmed it via
// GET /live/status within the last 45 s. A local SharedPreferences flag (for example
// v9576_auto_enabled) never implies "PC LIVE: KAPALI". If the PC cannot be reached the
// state is BİLİNMİYOR. Read-only helper: no order, cancel or close side effects.
public final class V95113PcTruth {
    public static final String MARKER = "CLAUDE_V113_ANDROID_LIVE_TRUTH";
    public static final long FRESH_MS = 45000L;
    public static final int MIN_FAILURES_BEFORE_UNHEALTHY = 3;

    public static final int UNKNOWN = 0;
    public static final int ARMED = 1;
    public static final int DISARMED = 2;

    public static final int POS_NOT_CONFIGURED = 0;
    public static final int POS_OK = 1;
    public static final int POS_UNREACHABLE = 2;

    public static final int COLOR_RED = 0xFFF87171;
    public static final int COLOR_GREEN = 0xFF4ADE80;
    public static final int COLOR_GRAY = 0xFFCBD5E1;
    public static final int COLOR_YELLOW = 0xFFFACC15;

    public static final String STOP_FAIL_UNREACHABLE =
        "PC'YE ULAŞILAMADI — PC'de LIVE AÇIK OLABİLİR. Telefonun Tailscale/VPN bağlantısını açın veya PC'de C:\\BrainHub\\_claude_v112\\LIVE-KAPAT.cmd çalıştırın.";
    public static final String STOP_FAIL_NOT_CONFIRMED =
        "PC LIVE KAPANMADI — PC hâlâ LIVE/OTO AÇIK bildiriyor. PC'de C:\\BrainHub\\_claude_v112\\LIVE-KAPAT.cmd çalıştırın.";

    // Last successful /live/status contact.
    private static final String K_OK_TS = "v95113_pc_truth_ok_ts";
    private static final String K_ARMED = "v95113_pc_truth_armed";
    private static final String K_EXPIRES = "v95113_pc_truth_expires_at";
    private static final String K_LEADER_KNOWN = "v95113_pc_truth_leader_known";
    private static final String K_LEADER = "v95113_pc_truth_leader_enabled";
    // Probe failures.
    private static final String K_FAIL_TS = "v95113_pc_truth_fail_ts";
    private static final String K_FAIL_ERR = "v95113_pc_truth_fail_error";
    private static final String K_FAIL_COUNT = "v95113_pc_truth_fail_count";
    // ACİL DURDUR / OTO KAPAT verification.
    private static final String K_STOP_STATE = "v95113_stop_state";
    private static final String K_STOP_TS = "v95113_stop_ts";
    private static final String K_STOP_REASON = "v95113_stop_reason";
    private static final String K_STOP_ATTEMPT = "v95113_stop_attempt";
    private static final String K_STOP_MSG = "v95113_stop_msg";
    // PC positions (compact copy of GET /live/positions).
    private static final String K_POS_JSON = "v95113_pc_positions_json";
    private static final String K_POS_OK_TS = "v95113_pc_positions_ok_ts";
    private static final String K_POS_FAIL_TS = "v95113_pc_positions_fail_ts";
    private static final String K_POS_FAIL_ERR = "v95113_pc_positions_fail_error";

    private V95113PcTruth() {}

    // ------------------------------------------------------------------ PC LIVE truth
    public static void recordStatus(SharedPreferences sp, JSONObject st, long now) {
        if (sp == null || st == null) return;
        boolean armed = st.has("armed") && !st.isNull("armed") && st.optBoolean("armed", false);
        JSONObject la = st.optJSONObject("leaderAuto");
        boolean leaderKnown = la != null && la.has("enabled");
        boolean leaderOn = la != null && la.optBoolean("enabled", false);
        SharedPreferences.Editor ed = sp.edit()
            .putLong(K_OK_TS, now)
            .putBoolean(K_ARMED, armed)
            .putString(K_EXPIRES, armed ? str(st, "expiresAt") : "")
            .putBoolean(K_LEADER_KNOWN, leaderKnown)
            .putBoolean(K_LEADER, leaderOn)
            .putInt(K_FAIL_COUNT, 0);
        // A red "stop not confirmed" line is resolved once the PC itself reports LIVE off;
        // a stale green "stopped" line is cleared once the PC reports LIVE on again.
        String stop = sp.getString(K_STOP_STATE, "");
        long stopTs = sp.getLong(K_STOP_TS, 0L);
        if (("FAILED".equals(stop) || "PENDING".equals(stop)) && !armed && !leaderOn && now >= stopTs) {
            ed.putString(K_STOP_STATE, "CONFIRMED").putLong(K_STOP_TS, now)
              .putString(K_STOP_MSG, "PC LIVE KAPANDI • PC onayladı " + hhmmss(now));
        } else if ("CONFIRMED".equals(stop) && armed) {
            ed.putString(K_STOP_STATE, "").putString(K_STOP_MSG, "");
        }
        ed.apply();
    }

    // PC /live/arm answered ok+armed: that is a PC confirmation too.
    public static void recordArm(SharedPreferences sp, JSONObject out, long now) {
        if (sp == null || out == null || !out.optBoolean("ok", false) || !out.optBoolean("armed", false)) return;
        SharedPreferences.Editor ed = sp.edit().putLong(K_OK_TS, now).putBoolean(K_ARMED, true)
            .putString(K_EXPIRES, str(out, "expiresAt")).putInt(K_FAIL_COUNT, 0);
        String stopState = sp.getString(K_STOP_STATE, "");
        if ("CONFIRMED".equals(stopState) || "FAILED".equals(stopState) || "PENDING".equals(stopState))
            ed.putString(K_STOP_STATE, "").putString(K_STOP_MSG, "");
        ed.apply();
    }

    public static void recordFailure(SharedPreferences sp, Throwable e, long now) {
        if (sp == null) return;
        sp.edit().putLong(K_FAIL_TS, now).putString(K_FAIL_ERR, err(e))
            .putInt(K_FAIL_COUNT, sp.getInt(K_FAIL_COUNT, 0) + 1).apply();
    }

    public static long lastContact(SharedPreferences sp) { return sp == null ? 0L : sp.getLong(K_OK_TS, 0L); }

    public static int failureCount(SharedPreferences sp) {
        return sp == null ? 0 : Math.max(0, sp.getInt(K_FAIL_COUNT, 0));
    }

    // Telemetry grace only: never turns LIVE on/off and never authorizes an order.
    // A single VPN/Wi-Fi jitter must not look like a PC disconnect. We only call
    // the link unhealthy after 3 consecutive failures AND 45 s without success.
    public static boolean shouldMarkProbeUnhealthy(SharedPreferences sp, long now) {
        long ts = lastContact(sp);
        boolean stale = ts <= 0L || now < ts || now - ts > FRESH_MS;
        return failureCount(sp) >= MIN_FAILURES_BEFORE_UNHEALTHY && stale;
    }

    public static boolean fresh(SharedPreferences sp, long now) {
        long ts = lastContact(sp);
        return ts > 0L && now >= ts && now - ts <= FRESH_MS;
    }

    public static int state(SharedPreferences sp, long now) {
        if (!fresh(sp, now)) return UNKNOWN;
        return sp.getBoolean(K_ARMED, false) ? ARMED : DISARMED;
    }

    public static long remainingMinutes(SharedPreferences sp, long now) {
        long exp = parseIso(sp == null ? "" : sp.getString(K_EXPIRES, ""));
        if (exp <= 0L) return -1L;
        return Math.max(0L, (exp - now) / 60000L);
    }

    public static String label(SharedPreferences sp, long now) {
        int s = state(sp, now);
        if (s == ARMED) {
            long m = remainingMinutes(sp, now);
            return "PC LIVE: AÇIK (kalan " + (m < 0 ? "?" : Long.toString(m)) + " dk)";
        }
        if (s == DISARMED) return "PC LIVE: KAPALI";
        long ts = lastContact(sp);
        return "PC LIVE: BİLİNMİYOR — PC'ye ulaşılamıyor (son bağlantı " + (ts > 0L ? hhmm(ts) : "yok") + ")";
    }

    public static int labelColor(SharedPreferences sp, long now) {
        int s = state(sp, now);
        return s == ARMED ? COLOR_GREEN : (s == DISARMED ? COLOR_GRAY : COLOR_RED);
    }

    // ------------------------------------------------------------------ stop verification state
    public static void markStopPending(SharedPreferences sp, String reason, long now) {
        if (sp == null) return;
        sp.edit().putString(K_STOP_STATE, "PENDING").putLong(K_STOP_TS, now).putString(K_STOP_REASON, reason == null ? "" : reason)
            .putInt(K_STOP_ATTEMPT, 0).putString(K_STOP_MSG, "PC LIVE KAPATILIYOR • PC onayı bekleniyor").apply();
    }

    public static void markStopAttempt(SharedPreferences sp, int attempt, int max) {
        if (sp == null) return;
        sp.edit().putInt(K_STOP_ATTEMPT, attempt)
            .putString(K_STOP_MSG, "PC LIVE KAPATILIYOR • PC onayı bekleniyor (deneme " + attempt + "/" + max + ")").apply();
    }

    public static String markStopConfirmed(SharedPreferences sp, long now) {
        String msg = "PC LIVE KAPANDI • PC onayladı " + hhmmss(now);
        if (sp != null) sp.edit().putString(K_STOP_STATE, "CONFIRMED").putLong(K_STOP_TS, now).putString(K_STOP_MSG, msg).apply();
        return msg;
    }

    public static String markStopFailed(SharedPreferences sp, boolean reached, String lastError, long now) {
        String msg = (reached ? STOP_FAIL_NOT_CONFIRMED : STOP_FAIL_UNREACHABLE);
        String shown = msg + "\nSon deneme " + hhmmss(now) + (lastError == null || lastError.trim().isEmpty() ? "" : " • " + lastError.trim());
        if (sp != null) sp.edit().putString(K_STOP_STATE, "FAILED").putLong(K_STOP_TS, now).putString(K_STOP_MSG, shown).apply();
        return msg;
    }

    public static String stopLine(SharedPreferences sp) {
        if (sp == null) return "";
        String state = sp.getString(K_STOP_STATE, "");
        if (state == null || state.isEmpty()) return "";
        String msg = sp.getString(K_STOP_MSG, "");
        return msg == null ? "" : msg;
    }

    public static int stopColor(SharedPreferences sp) {
        String state = sp == null ? "" : sp.getString(K_STOP_STATE, "");
        if ("CONFIRMED".equals(state)) return COLOR_GREEN;
        if ("FAILED".equals(state)) return COLOR_RED;
        return COLOR_YELLOW;
    }

    public static boolean stopFailed(SharedPreferences sp) {
        return sp != null && "FAILED".equals(sp.getString(K_STOP_STATE, ""));
    }

    public static boolean stopNeedsRetry(SharedPreferences sp) {
        if (sp == null) return false;
        String state = sp.getString(K_STOP_STATE, "");
        return "PENDING".equals(state) || "FAILED".equals(state);
    }

    public static boolean stopConfirmed(SharedPreferences sp) {
        return sp != null && "CONFIRMED".equals(sp.getString(K_STOP_STATE, ""));
    }

    // ------------------------------------------------------------------ PC positions (read-only)
    // Network: call from a background executor only.
    public static void fetchPositions(Context c, SharedPreferences sp) {
        if (c == null || sp == null) return;
        long now = System.currentTimeMillis();
        try {
            JSONObject src = BrainHubClient.livePositions(c);
            JSONObject out = new JSONObject();
            out.put("ok", src.optBoolean("ok", false));
            out.put("asOf", str(src, "asOf"));
            out.put("ledgerOk", src.optBoolean("ledgerOk", false));
            out.put("ledgerError", str(src, "ledgerError"));
            JSONArray open = src.optJSONArray("open"), compact = new JSONArray();
            String[] keys = {"symbol", "side", "entryPrice", "markPrice", "unrealizedPnl", "unrealizedR", "stopPrice", "runnerPhase", "openedBy"};
            if (open != null) for (int i = 0; i < Math.min(12, open.length()); i++) {
                JSONObject p = open.optJSONObject(i);
                if (p == null) continue;
                JSONObject q = new JSONObject();
                for (String k : keys) if (p.has(k) && !p.isNull(k)) q.put(k, p.get(k));
                compact.put(q);
            }
            out.put("open", compact);
            out.put("openCount", src.optInt("openCount", open == null ? 0 : open.length()));
            JSONObject sum = src.optJSONObject("summary");
            if (sum != null) {
                JSONObject s2 = new JSONObject();
                for (String k : new String[]{"closed", "wins", "losses", "netPnl"}) if (sum.has(k) && !sum.isNull(k)) s2.put(k, sum.get(k));
                out.put("summary", s2);
            }
            sp.edit().putString(K_POS_JSON, out.toString()).putLong(K_POS_OK_TS, now).apply();
        } catch (Throwable e) {
            sp.edit().putLong(K_POS_FAIL_TS, now).putString(K_POS_FAIL_ERR, err(e)).apply();
        }
    }

    public static int positionsState(SharedPreferences sp, long now, boolean configured) {
        if (!configured) return POS_NOT_CONFIGURED;
        long ts = sp == null ? 0L : sp.getLong(K_POS_OK_TS, 0L);
        return ts > 0L && now >= ts && now - ts <= FRESH_MS ? POS_OK : POS_UNREACHABLE;
    }

    // -1 = unknown (not reachable, or PC ledger itself not current); otherwise the PC-reported open count.
    public static int positionsOpenCount(SharedPreferences sp, long now, boolean configured) {
        if (positionsState(sp, now, configured) != POS_OK) return -1;
        JSONObject j = json(sp.getString(K_POS_JSON, ""));
        if (!j.optBoolean("ledgerOk", false)) return -1;
        JSONArray open = j.optJSONArray("open");
        return Math.max(j.optInt("openCount", 0), open == null ? 0 : open.length());
    }

    public static String positionsText(SharedPreferences sp, long now, boolean configured) {
        int state = positionsState(sp, now, configured);
        if (state == POS_NOT_CONFIGURED) return "";
        if (state == POS_UNREACHABLE) {
            long ts = sp == null ? 0L : sp.getLong(K_POS_OK_TS, 0L);
            return "PC pozisyonları alınamadı (son bağlantı " + (ts > 0L ? hhmm(ts) : "yok") + ")";
        }
        JSONObject j = json(sp.getString(K_POS_JSON, ""));
        StringBuilder b = new StringBuilder("🖥 PC POZİSYONLARI • BrainHub • salt-okunur");
        String asOf = str(j, "asOf");
        long asOfMs = parseIso(asOf);
        if (asOfMs > 0L) b.append(" • defter ").append(hhmmss(asOfMs));
        if (!j.optBoolean("ledgerOk", false)) {
            String e = str(j, "ledgerError");
            b.append("\n⚠ PC pozisyon defteri güncel değil").append(e.isEmpty() ? "" : " (" + e + ")")
             .append(asOf.isEmpty() ? " • henüz defter oluşmadı" : " • son geçerli liste gösteriliyor");
        }
        JSONArray open = j.optJSONArray("open");
        int shown = 0;
        if (open != null) for (int i = 0; i < open.length(); i++) {
            JSONObject p = open.optJSONObject(i);
            if (p == null) continue;
            shown++;
            double pnl = num(p, "unrealizedPnl"), r = num(p, "unrealizedR");
            String side = str(p, "side").toUpperCase(java.util.Locale.US);
            String phase = str(p, "runnerPhase");
            b.append("\n").append(str(p, "symbol")).append(" ").append(side.isEmpty() ? "?" : side)
             .append(" • giriş ").append(px(num(p, "entryPrice")))
             .append(" • anlık ").append(px(num(p, "markPrice")))
             .append(" • PnL ").append(Double.isNaN(pnl) ? "—" : String.format(java.util.Locale.US, "%+.2f USDT", pnl))
             .append(" (").append(Double.isNaN(r) ? "R —" : String.format(java.util.Locale.US, "%+.2fR", r)).append(")")
             .append(" • stop ").append(px(num(p, "stopPrice")))
             .append(" • runner ").append(phase.isEmpty() ? "—" : phase);
            if ("EXTERNAL".equalsIgnoreCase(str(p, "openedBy"))) b.append(" • BrainHub dışı");
        }
        if (shown == 0) b.append(j.optBoolean("ledgerOk", false) ? "\nPC'de açık pozisyon yok" : "\nPC açık pozisyon listesi yok");
        JSONObject sum = j.optJSONObject("summary");
        if (sum != null) {
            double net = num(sum, "netPnl");
            b.append("\nKapanan ").append(sum.optInt("closed", 0))
             .append(" • ").append(sum.optInt("wins", 0)).append(" kazanç / ").append(sum.optInt("losses", 0)).append(" kayıp")
             .append(" • net ").append(Double.isNaN(net) ? "—" : String.format(java.util.Locale.US, "%+.2f USDT", net));
        }
        return b.toString();
    }

    public static int positionsBackground(SharedPreferences sp, long now, boolean configured) {
        int state = positionsState(sp, now, configured);
        if (state == POS_UNREACHABLE) return 0xFF450A0A;
        return 0xFF10263A;
    }

    // ------------------------------------------------------------------ helpers
    public static String reasons(JSONObject j) {
        if (j == null) return "";
        JSONArray rs = j.optJSONArray("reasons");
        if (rs != null && rs.length() > 0) {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < Math.min(4, rs.length()); i++) { if (i > 0) b.append(", "); b.append(rs.optString(i, "")); }
            return b.toString();
        }
        String e = str(j, "error");
        if (!e.isEmpty()) return e;
        int http = j.optInt("_httpStatus", 0);
        return http > 0 ? "HTTP " + http : "PC_AUTO_CONFIG_REJECTED";
    }

    public static String err(Throwable e) {
        if (e == null) return "";
        String m = e.getMessage();
        String s = e.getClass().getSimpleName() + (m == null || m.trim().isEmpty() ? "" : ": " + m.trim());
        return s.length() > 160 ? s.substring(0, 160) + "…" : s;
    }

    public static String hhmm(long ts) {
        return new java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(new java.util.Date(ts));
    }

    public static String hhmmss(long ts) {
        return new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(new java.util.Date(ts));
    }

    static long parseIso(String iso) {
        if (iso == null || iso.trim().isEmpty() || "null".equals(iso.trim())) return 0L;
        try { return java.time.Instant.parse(iso.trim()).toEpochMilli(); } catch (Throwable ignored) { return 0L; }
    }

    static String px(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x) || x <= 0.0) return "—";
        try {
            return java.math.BigDecimal.valueOf(x).round(new java.math.MathContext(8, java.math.RoundingMode.HALF_UP))
                .stripTrailingZeros().toPlainString();
        } catch (Throwable ignored) { return String.valueOf(x); }
    }

    static double num(JSONObject j, String k) {
        if (j == null || !j.has(k) || j.isNull(k)) return Double.NaN;
        return j.optDouble(k, Double.NaN);
    }

    static String str(JSONObject j, String k) {
        if (j == null || !j.has(k) || j.isNull(k)) return "";
        String s = j.optString(k, "");
        return s == null || "null".equals(s) ? "" : s.trim();
    }

    static JSONObject json(String raw) {
        try { return new JSONObject(raw == null || raw.trim().isEmpty() ? "{}" : raw); } catch (Throwable e) { return new JSONObject(); }
    }
}
