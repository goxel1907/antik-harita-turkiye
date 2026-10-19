package com.futuresalarm.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

public final class AutoStore {
    private static final String KEY = "auto_high_accuracy_snapshots_v6";
    private AutoStore() {}

    private static JSONObject all(Context c) {
        SharedPreferences p = c.getSharedPreferences(MonitorService.PREFS, Context.MODE_PRIVATE);
        String raw = p.getString(KEY, "{}");
        try { return new JSONObject(raw); } catch (Exception e) { return new JSONObject(); }
    }

    public static AutoSnapshot get(Context c, String symbol) {
        try {
            JSONObject a = all(c);
            JSONObject o = a.optJSONObject(symbol.toUpperCase());
            return o == null ? null : AutoSnapshot.fromJson(o);
        } catch (Exception e) { return null; }
    }

    public static void put(Context c, AutoSnapshot s) {
        try {
            JSONObject a = all(c);
            a.put(s.symbol.toUpperCase(), s.toJson());
            c.getSharedPreferences(MonitorService.PREFS, Context.MODE_PRIVATE).edit().putString(KEY, a.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static void clear(Context c, String symbol) {
        try {
            JSONObject a = all(c);
            a.remove(symbol.toUpperCase());
            c.getSharedPreferences(MonitorService.PREFS, Context.MODE_PRIVATE).edit().putString(KEY, a.toString()).apply();
        } catch (Exception ignored) {}
    }
}
