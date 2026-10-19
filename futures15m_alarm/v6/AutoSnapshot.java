package com.futuresalarm.app;

import org.json.JSONObject;

public final class AutoSnapshot {
    public final String symbol;
    public final long updatedAt;
    public final String regime;
    public final String summary;
    public final int longPullScore;
    public final int longBreakScore;
    public final int shortResScore;
    public final int shortBreakScore;
    public final boolean longPullConfirmed;
    public final boolean longBreakConfirmed;
    public final boolean shortResConfirmed;
    public final boolean shortBreakConfirmed;
    public final String longPullReason;
    public final String longBreakReason;
    public final String shortResReason;
    public final String shortBreakReason;
    public final TradePlan plan;

    public AutoSnapshot(String symbol, long updatedAt, String regime, String summary,
                        int longPullScore, int longBreakScore, int shortResScore, int shortBreakScore,
                        boolean longPullConfirmed, boolean longBreakConfirmed,
                        boolean shortResConfirmed, boolean shortBreakConfirmed,
                        String longPullReason, String longBreakReason,
                        String shortResReason, String shortBreakReason,
                        TradePlan plan) {
        this.symbol = symbol;
        this.updatedAt = updatedAt;
        this.regime = regime == null ? "" : regime;
        this.summary = summary == null ? "" : summary;
        this.longPullScore = longPullScore;
        this.longBreakScore = longBreakScore;
        this.shortResScore = shortResScore;
        this.shortBreakScore = shortBreakScore;
        this.longPullConfirmed = longPullConfirmed;
        this.longBreakConfirmed = longBreakConfirmed;
        this.shortResConfirmed = shortResConfirmed;
        this.shortBreakConfirmed = shortBreakConfirmed;
        this.longPullReason = nz(longPullReason);
        this.longBreakReason = nz(longBreakReason);
        this.shortResReason = nz(shortResReason);
        this.shortBreakReason = nz(shortBreakReason);
        this.plan = plan;
    }

    private static String nz(String s) { return s == null ? "" : s; }

    public int bestScore() {
        return Math.max(Math.max(longPullScore, longBreakScore), Math.max(shortResScore, shortBreakScore));
    }

    public String bestSetup() {
        int b = bestScore();
        if (b == longPullScore) return "LONG PULLBACK";
        if (b == longBreakScore) return "LONG BREAKOUT";
        if (b == shortResScore) return "SHORT DİRENÇ";
        return "SHORT BREAKDOWN";
    }

    public String grade(int score) {
        if (score >= 86) return "GÜÇLÜ SİNYAL";
        if (score >= 78) return "SİNYAL";
        if (score >= 68) return "TAKİP";
        return "İŞLEM YOK";
    }

    public JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("symbol", symbol); o.put("updatedAt", updatedAt); o.put("regime", regime); o.put("summary", summary);
            o.put("longPullScore", longPullScore); o.put("longBreakScore", longBreakScore);
            o.put("shortResScore", shortResScore); o.put("shortBreakScore", shortBreakScore);
            o.put("longPullConfirmed", longPullConfirmed); o.put("longBreakConfirmed", longBreakConfirmed);
            o.put("shortResConfirmed", shortResConfirmed); o.put("shortBreakConfirmed", shortBreakConfirmed);
            o.put("longPullReason", longPullReason); o.put("longBreakReason", longBreakReason);
            o.put("shortResReason", shortResReason); o.put("shortBreakReason", shortBreakReason);
            o.put("plan", plan.toJson());
        } catch (Exception ignored) {}
        return o;
    }

    public static AutoSnapshot fromJson(JSONObject o) throws Exception {
        return new AutoSnapshot(
                o.getString("symbol"), o.optLong("updatedAt", 0L), o.optString("regime", ""), o.optString("summary", ""),
                o.optInt("longPullScore", 0), o.optInt("longBreakScore", 0), o.optInt("shortResScore", 0), o.optInt("shortBreakScore", 0),
                o.optBoolean("longPullConfirmed", false), o.optBoolean("longBreakConfirmed", false),
                o.optBoolean("shortResConfirmed", false), o.optBoolean("shortBreakConfirmed", false),
                o.optString("longPullReason", ""), o.optString("longBreakReason", ""),
                o.optString("shortResReason", ""), o.optString("shortBreakReason", ""),
                TradePlan.fromJson(o.getJSONObject("plan"))
        );
    }
}
