from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, ANALYSIS, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.28 missing: ' + str(p))

m = MAIN.read_text()
if 'V9527_TRADE_DASHBOARD_RECONCILE' not in m:
    raise SystemExit('v9.5.28 requires v9.5.27 dashboard/reconcile patch first')

# -----------------------------------------------------------------------------
# 1) Draft carries explicit target/planned/executed margin + notional and the
# actual TP split ratios. Requested margin is a hard execution target, not a
# suggestion. TP allocation only splits quantity after the full entry is filled.
# -----------------------------------------------------------------------------
if 'V9528_EXACT_MARGIN_FIELDS' not in m:
    pat = re.compile(r'(double r1, r2, r3, riskUsd, riskMarginPct, tp1FullUsd, tp2FullUsd, tp3FullUsd, splitAllTpUsd;\s*\n\s*)(int leverage; boolean hedge;)')
    repl = (r'\1// V9528_EXACT_MARGIN_FIELDS\n'
            r'        double targetNotional, plannedNotional, plannedMargin, marginToleranceUsd;\n'
            r'        double executedQty, executedAvgPrice, executedNotional, executedMargin;\n'
            r'        double splitP1, splitP2, splitP3;\n'
            r'        \2')
    m, n = pat.subn(repl, m, count=1)
    if n != 1:
        raise SystemExit('v9.5.28 draft field anchor missing')

# Helpers are inserted before the existing open-position check.
if 'private double v9528NearestQty(' not in m:
    anchor = '    private boolean v9522HasOpenPosition(org.json.JSONObject account, String symbol) {'
    if anchor not in m:
        raise SystemExit('v9.5.28 helper anchor missing')
    helper = r'''
    // V9528_EXACT_MARGIN_HELPERS
    private double v9528NearestQty(double targetNotional, double price, double step,
                                   double minQty, double maxQty) {
        if (!(targetNotional > 0) || !(price > 0)) return Double.NaN;
        double raw = targetNotional / price;
        if (!(step > 0)) return raw;
        double down = v9522Floor(raw, step);
        double up = down + step;
        boolean downOk = down >= minQty && down <= maxQty;
        boolean upOk = up >= minQty && up <= maxQty;
        if (!downOk && !upOk) return Double.NaN;
        if (!downOk) return up;
        if (!upOk) return down;
        double dd = Math.abs(down * price - targetNotional);
        double du = Math.abs(up * price - targetNotional);
        return du < dd ? up : down;
    }

    private double v9528MarginTolerance(double requestedMargin, double price, double step, int leverage) {
        double oneStepMargin = (step > 0 && price > 0 && leverage > 0) ? (step * price / leverage) : 0d;
        // Strict enough to prevent a 20 USDT request becoming 7 USDT, while
        // allowing unavoidable lot-size quantization and tiny market-fill drift.
        return Math.max(0.05d, requestedMargin * 0.01d + oneStepMargin * 0.55d);
    }

    private void v9528ApplyQtySplit(V9522OrderDraft d, double qty) throws Exception {
        if (!(qty > 0)) throw new Exception("Gerçekleşen pozisyon miktarı sıfır/geçersiz.");
        double p1 = d.splitP1 > 0 ? d.splitP1 : 0.33d;
        double p2 = d.splitP2 > 0 ? d.splitP2 : 0.33d;
        double q1 = v9522Floor(qty * p1, d.step);
        double q2 = v9522Floor(qty * p2, d.step);
        double q3 = v9522Floor(qty - q1 - q2, d.step);
        if (q1 < d.minQty || q2 < d.minQty || q3 < d.minQty)
            throw new Exception("Gerçekleşen pozisyon miktarı TP1/TP2/TP3'e güvenli bölünemiyor.");
        d.qtyText = v9522StepText(qty, d.step);
        d.q1Text = v9522StepText(q1, d.step);
        d.q2Text = v9522StepText(q2, d.step);
        d.q3Text = v9522StepText(q3, d.step);
    }

    private org.json.JSONObject v9528AccountSnapshot() throws Exception {
        try { return new org.json.JSONObject(v9522Http("GET", "/fapi/v3/account", null, true)); }
        catch (Throwable ignored) { return new org.json.JSONObject(v9522Http("GET", "/fapi/v2/account", null, true)); }
    }

    private org.json.JSONObject v9528Position(org.json.JSONObject account, V9522OrderDraft d) {
        org.json.JSONArray p = account.optJSONArray("positions");
        if (p == null) return null;
        for (int i = 0; i < p.length(); i++) {
            org.json.JSONObject x = p.optJSONObject(i);
            if (x == null || !d.symbol.equals(x.optString("symbol"))) continue;
            if (d.hedge && !d.positionSide.equals(x.optString("positionSide", ""))) continue;
            try {
                if (Math.abs(Double.parseDouble(x.optString("positionAmt", "0"))) > 0d) return x;
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private org.json.JSONObject v9528WaitPosition(V9522OrderDraft d) throws Exception {
        org.json.JSONObject last = null;
        for (int i = 0; i < 4; i++) {
            last = v9528Position(v9528AccountSnapshot(), d);
            if (last != null) return last;
            try { Thread.sleep(180L + i * 120L); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
        }
        return last;
    }

'''
    m = m.replace(anchor, helper + anchor, 1)

# -----------------------------------------------------------------------------
# 2) Pre-flight quantity uses the nearest legal Binance lot, then explicitly
# checks that implied margin is within the strict tolerance of what user typed.
# -----------------------------------------------------------------------------
old_qty = '''                double qty = v9522Floor((margin * leverage) / live, step);
                if (!(qty >= minQty) || qty > maxQty) throw new Exception("Hesaplanan miktar sözleşme min/max miktarına uymuyor.");'''
if 'V9528_MARGIN_TARGET_PREFLIGHT' not in m:
    if old_qty not in m:
        raise SystemExit('v9.5.28 quantity preflight anchor missing')
    new_qty = '''                // V9528_MARGIN_TARGET_PREFLIGHT
                double targetNotional = margin * leverage;
                double qty = v9528NearestQty(targetNotional, live, step, minQty, maxQty);
                if (Double.isNaN(qty) || !(qty >= minQty) || qty > maxQty)
                    throw new Exception("İstenen marj/kaldıraç için geçerli sözleşme miktarı hesaplanamadı.");
                double plannedNotional = qty * live;
                double plannedMargin = plannedNotional / leverage;
                double marginToleranceUsd = v9528MarginTolerance(margin, live, step, leverage);
                if (Math.abs(plannedMargin - margin) > marginToleranceUsd)
                    throw new Exception(String.format(java.util.Locale.US,
                            "İstenen marj %.2f USDT; sözleşme adımı nedeniyle %.2f USDT hesaplandı. İzin verilen fark ±%.2f USDT. Emir gönderilmedi.",
                            margin, plannedMargin, marginToleranceUsd));'''
    m = m.replace(old_qty, new_qty, 1)

# Store target/planned values + TP split ratios in the draft.
assign_anchor = '''                d.splitLabel=splitLabel; d.r1=r1; d.r2=r2; d.r3=r3;
                d.riskUsd=riskUsd; d.riskMarginPct=riskMarginPct;'''
if 'd.targetNotional=targetNotional' not in m:
    if assign_anchor not in m:
        raise SystemExit('v9.5.28 draft assignment anchor missing')
    assign_new = '''                d.splitLabel=splitLabel; d.r1=r1; d.r2=r2; d.r3=r3;
                d.splitP1=p1; d.splitP2=p2; d.splitP3=Math.max(0d, 1d-p1-p2);
                d.targetNotional=targetNotional; d.plannedNotional=plannedNotional;
                d.plannedMargin=plannedMargin; d.marginToleranceUsd=marginToleranceUsd;
                d.riskUsd=riskUsd; d.riskMarginPct=riskMarginPct;'''
    m = m.replace(assign_anchor, assign_new, 1)

# Final confirmation must make the exact target obvious before the user sends.
confirm_anchor = '                "\\nMiktar: " + d.qtyText +\n'
if 'HEDEF NOTIONAL' not in m:
    if confirm_anchor not in m:
        raise SystemExit('v9.5.28 final confirmation anchor missing')
    confirm_new = ('                "\\nMiktar: " + d.qtyText +\n'
                   '                "\\nHEDEF MARJ: " + String.format(java.util.Locale.US, "%.2f", d.margin) + " USDT • " + d.leverage + "x" +\n'
                   '                "\\nHEDEF NOTIONAL: " + String.format(java.util.Locale.US, "%.2f", d.targetNotional) + " USDT" +\n'
                   '                "\\nPLANLANAN MARJ: " + String.format(java.util.Locale.US, "%.2f", d.plannedMargin) + " USDT" +\n'
                   '                "\\nPLANLANAN NOTIONAL: " + String.format(java.util.Locale.US, "%.2f", d.plannedNotional) + " USDT" +\n'
                   '                "\\nMARJ DOĞRULAMA TOLERANSI: ±" + String.format(java.util.Locale.US, "%.2f", d.marginToleranceUsd) + " USDT" +\n')
    m = m.replace(confirm_anchor, confirm_new, 1)

# -----------------------------------------------------------------------------
# 3) Execution-time hardening. Confirm leverage response, refresh price and
# recompute legal quantity just before MARKET send. This blocks silent drift.
# -----------------------------------------------------------------------------
lev_old = '''                java.util.LinkedHashMap<String,String> lp = new java.util.LinkedHashMap<>();
                lp.put("symbol", d.symbol); lp.put("leverage", Integer.toString(d.leverage));
                v9522Http("POST", "/fapi/v1/leverage", lp, true);

                String entrySide = "LONG".equalsIgnoreCase(d.side) ? "BUY" : "SELL";'''
if 'V9528_EXECUTION_MARGIN_RECHECK' not in m:
    if lev_old not in m:
        raise SystemExit('v9.5.28 leverage execution anchor missing')
    lev_new = '''                java.util.LinkedHashMap<String,String> lp = new java.util.LinkedHashMap<>();
                lp.put("symbol", d.symbol); lp.put("leverage", Integer.toString(d.leverage));
                org.json.JSONObject levResp = new org.json.JSONObject(v9522Http("POST", "/fapi/v1/leverage", lp, true));
                int appliedLeverage = levResp.optInt("leverage", -1);
                if (appliedLeverage != d.leverage)
                    throw new Exception("Binance istenen kaldıraç değerini uygulamadı. İstenen " + d.leverage + "x, uygulanan " + appliedLeverage + "x. Emir gönderilmedi.");

                // V9528_EXECUTION_MARGIN_RECHECK
                java.util.LinkedHashMap<String,String> pxp = new java.util.LinkedHashMap<>(); pxp.put("symbol", d.symbol);
                double sendPrice = Double.parseDouble(new org.json.JSONObject(v9522Http("GET", "/fapi/v1/ticker/price", pxp, false)).getString("price"));
                double sendQty = v9528NearestQty(d.margin * d.leverage, sendPrice, d.step, d.minQty, Double.MAX_VALUE);
                if (Double.isNaN(sendQty) || sendQty < d.minQty) throw new Exception("Gönderim anında geçerli pozisyon miktarı hesaplanamadı.");
                double sendNotional = sendQty * sendPrice;
                double sendMargin = sendNotional / d.leverage;
                d.marginToleranceUsd = v9528MarginTolerance(d.margin, sendPrice, d.step, d.leverage);
                if (Math.abs(sendMargin - d.margin) > d.marginToleranceUsd)
                    throw new Exception(String.format(java.util.Locale.US,
                            "Gönderim anında hedef marj %.2f USDT iken %.2f USDT oluşacaktı. Tolerans ±%.2f USDT. Emir gönderilmedi.",
                            d.margin, sendMargin, d.marginToleranceUsd));
                d.live = sendPrice; d.plannedNotional = sendNotional; d.plannedMargin = sendMargin;
                v9528ApplyQtySplit(d, sendQty);

                String entrySide = "LONG".equalsIgnoreCase(d.side) ? "BUY" : "SELL";'''
    m = m.replace(lev_old, lev_new, 1)

# -----------------------------------------------------------------------------
# 4) After MARKET fill, TP sizes are recomputed from actual executedQty and the
# actual avg fill price is used to verify implied initial margin. If it differs
# materially from what user typed, emergency-close immediately instead of
# silently leaving a wrong-size position open.
# -----------------------------------------------------------------------------
post_old = '''                String exq = er.optString("executedQty", d.qtyText);
                try { if (Double.parseDouble(exq) > 0) filledQty = v9522StepText(Double.parseDouble(exq), d.step); } catch (Throwable ignored) {}
                entryFilled = true;
                v9527RecordEntry(d, signalTs, er, filledQty);
                sp.edit().putLong("v9522_order_sent_signal_" + d.symbol, signalTs).apply();'''
if 'V9528_POST_FILL_MARGIN_VERIFY' not in m:
    if post_old not in m:
        raise SystemExit('v9.5.28 post-fill anchor missing')
    post_new = '''                String exq = er.optString("executedQty", d.qtyText);
                double actualQty = 0d;
                try { actualQty = Double.parseDouble(exq); } catch (Throwable ignored) {}
                if (!(actualQty > 0d)) throw new Exception("Binance MARKET emri gerçekleşen miktarı sıfır döndürdü.");
                filledQty = v9522StepText(actualQty, d.step);
                entryFilled = true;

                // V9528_POST_FILL_MARGIN_VERIFY
                double avgFill = er.optDouble("avgPrice", 0d);
                if (!(avgFill > 0d)) {
                    double cq = er.optDouble("cumQuote", 0d);
                    if (cq > 0d) avgFill = cq / actualQty;
                }
                if (!(avgFill > 0d)) avgFill = d.live;
                double actualNotional = actualQty * avgFill;
                double actualMargin = actualNotional / d.leverage;
                d.executedQty = actualQty; d.executedAvgPrice = avgFill;
                d.executedNotional = actualNotional; d.executedMargin = actualMargin;
                v9528ApplyQtySplit(d, actualQty); // TP'ler yalnız GERÇEK fill miktarını böler.

                if (Math.abs(actualMargin - d.margin) > d.marginToleranceUsd) {
                    v9522EmergencyClose(d, filledQty);
                    throw new Exception(String.format(java.util.Locale.US,
                            "KRİTİK EMİR BOYUTU UYUŞMAZLIĞI: %.2f USDT marj istendi, gerçekleşen fill yaklaşık %.2f USDT marja denk geliyor. Güvenlik için pozisyonu piyasa emriyle kapatma denendi.",
                            d.margin, actualMargin));
                }

                org.json.JSONObject verifiedPos = v9528WaitPosition(d);
                if (verifiedPos != null) {
                    int actualLev = verifiedPos.optInt("leverage", d.leverage);
                    if (actualLev != d.leverage) {
                        v9522EmergencyClose(d, filledQty);
                        throw new Exception("KRİTİK KALDIRAÇ UYUŞMAZLIĞI: Binance pozisyonu " + actualLev + "x, istenen " + d.leverage + "x. Güvenlik için kapatma denendi.");
                    }
                    double reportedInitial = 0d;
                    try { reportedInitial = Double.parseDouble(verifiedPos.optString("positionInitialMargin", "0")); } catch (Throwable ignored) {}
                    if (reportedInitial > 0d && Math.abs(reportedInitial - d.margin) > Math.max(d.marginToleranceUsd, d.margin * 0.015d)) {
                        v9522EmergencyClose(d, filledQty);
                        throw new Exception(String.format(java.util.Locale.US,
                                "KRİTİK MARJ UYUŞMAZLIĞI: Binance positionInitialMargin %.2f USDT, istenen %.2f USDT. Güvenlik için kapatma denendi.",
                                reportedInitial, d.margin));
                    }
                }

                // Persist only after exact-size checks pass.
                v9527RecordEntry(d, signalTs, er, filledQty);
                sp.edit().putLong("v9522_order_sent_signal_" + d.symbol, signalTs).apply();'''
    m = m.replace(post_old, post_new, 1)

# Result dialog: make the verified opening size explicit.
old_success = '"EMİRLER HAZIR • Giriş gerçekleşti • STOP + TP1/TP2/TP3 gönderildi. Başlangıç marjı uygulama kayıtlarında korunur; TP kısmi kapanışlarından sonra Binance kalan marjı daha düşük gösterebilir. Binance\'ta pozisyonu kontrol edin."'
if 'DOĞRULANAN AÇILIŞ MARJI' not in m and old_success in m:
    new_success = ('"EMİRLER HAZIR • Giriş gerçekleşti • DOĞRULANAN AÇILIŞ MARJI ≈ " + '
                   'String.format(java.util.Locale.US, "%.2f", d.executedMargin) + " USDT • " + d.leverage + "x • NOTIONAL ≈ " + '
                   'String.format(java.util.Locale.US, "%.2f", d.executedNotional) + " USDT • STOP + TP1/TP2/TP3 gönderildi. " + '
                   '"TP kısmi kapanışlarından sonra Binance kalan marjı daha düşük gösterebilir; başlangıç marjı 24 saat kayıtlarında korunur."')
    m = m.replace(old_success, new_success, 1)

# Version/markers.
if 'V9528_EXACT_MARGIN_RECONCILE' not in m:
    p = m.find('\n', m.find('public class '))
    if p < 0: p = 0
    m = m[:p+1] + '    // V9528_EXACT_MARGIN_RECONCILE\n' + m[p+1:]
m = re.sub(r'15m Futures Alarm PRO\s*[•-]?\s*v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.28', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.28  •  MANUEL PRO', m)
m = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.28', m)
MAIN.write_text(m)

# Keep prompt/monitor visible version aligned; decision/liquidation weighting is unchanged.
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ\s*[•-]?\s*v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.28', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.28', a)
ANALYSIS.write_text(a)
mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.28', mon)
MON.write_text(mon)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 42', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.28'", b, count=1)
BUILD.write_text(b)

# Functional sanity checks after v9.5.27 + v9.5.28.
mf = MAIN.read_text(); af = ANALYSIS.read_text(); monf = MON.read_text(); bf = BUILD.read_text()
checks = [
    ('V9527_TRADE_DASHBOARD_RECONCILE' in mf and '24 SAAT • UYGULAMA İŞLEMLERİ' in mf, '24h dashboard retained'),
    ('v9527Signals(true)' in mf and 'Sinyal ' in mf, 'simultaneous signal board retained'),
    ('/fapi/v1/userTrades' in mf and 'realizedPnl' in mf and 'commissionUsdt' in mf, 'realized PnL ledger retained'),
    ('İŞLEM KAPANDI • Binance pozisyonu 0' in mf, 'Binance close reconciliation retained'),
    ('V9528_EXACT_MARGIN_RECONCILE' in mf, 'exact margin marker'),
    ('V9528_MARGIN_TARGET_PREFLIGHT' in mf and 'HEDEF MARJ:' in mf and 'HEDEF NOTIONAL:' in mf, 'margin target preflight and UI'),
    ('V9528_EXECUTION_MARGIN_RECHECK' in mf and 'appliedLeverage != d.leverage' in mf, 'leverage and send-time recheck'),
    ('V9528_POST_FILL_MARGIN_VERIFY' in mf and 'KRİTİK EMİR BOYUTU UYUŞMAZLIĞI' in mf, 'post-fill exact margin fail-safe'),
    ('v9528ApplyQtySplit(d, actualQty)' in mf, 'TP quantities based on actual fill'),
    ('positionInitialMargin' in mf and 'v9528WaitPosition' in mf, 'Binance account margin verification'),
    ('V9527_LIQUIDATION_WEIGHT_RULE' in af and 'LEVERAGE EVENT AİLESİ' in af, 'liquidation weighting retained'),
    ('versionCode 42' in bf and "versionName '9.5.28'" in bf, 'version'),
]
print('--- Final v9.5.28 checks ---')
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.28 sanity failed: ' + name)
print('v9.5.28 OK: exact user margin/leverage target + actual-fill TP sizing + Binance post-fill verification + v9.5.27 dashboard/history retained.')
