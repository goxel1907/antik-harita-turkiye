from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists(): raise SystemExit('v9.5.22c MainActivity missing')
m=MAIN.read_text()

# Correct the human-readable deviation formatting.
m=m.replace('"Canlı fiyat giriş referansından %%.2f uzaklaştı (sınır %%0.50). Fiyat kovalanmadı.", dev',
            '"Canlı fiyat giriş referansından %.2f%% uzaklaştı (sınır %%0.50). Fiyat kovalanmadı.", dev')

# Validate Binance MIN_NOTIONAL before any signed order is sent.
anchor='''                double qty = v9522Floor((margin * leverage) / live, step);
                if (!(qty >= minQty) || qty > maxQty) throw new Exception("Hesaplanan miktar sözleşme min/max miktarına uymuyor.");'''
if 'V9522_MIN_NOTIONAL_GUARD' not in m:
    if anchor not in m: raise SystemExit('v9.5.22c quantity anchor missing')
    repl=anchor+'''\n                // V9522_MIN_NOTIONAL_GUARD
                org.json.JSONObject minN = v9522Filter(si, "MIN_NOTIONAL");
                if (minN != null) {
                    double minNotional = 0.0;
                    try { minNotional = Double.parseDouble(minN.optString("notional", minN.optString("minNotional", "0"))); }
                    catch (Throwable ignored) {}
                    if (minNotional > 0 && qty * live < minNotional)
                        throw new Exception("Pozisyon büyüklüğü sözleşmenin minimum notional sınırının altında.");
                }'''
    m=m.replace(anchor,repl,1)

# Put a visible connection-test button inside API settings instead of hiding the
# action behind a tap on the status text.
anchor2='''        box.addView(key, ep); box.addView(sec, ep);

        android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)'''
if 'V9522_VISIBLE_API_TEST' not in m:
    if anchor2 not in m: raise SystemExit('v9.5.22c API dialog anchor missing')
    test='''        box.addView(key, ep); box.addView(sec, ep);
        // V9522_VISIBLE_API_TEST
        Button apiTest = button("API BAĞLANTISINI TEST ET\\nEmir göndermeden kayıtlı anahtarı kontrol et", Color.rgb(30, 83, 121));
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, dp(50));
        tp.setMargins(0, dp(10), 0, 0);
        box.addView(apiTest, tp);
        apiTest.setOnClickListener(v -> v9522TestApi());

        android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)'''
    m=m.replace(anchor2,test,1)

# Remove the now-obscure status-tap instruction, while leaving it harmless if a
# previous patch already added the click listener.
m=m.replace('        Toast.makeText(this, "Bağlantı testi için KAYIT satırına dokunabilirsiniz.", Toast.LENGTH_LONG).show();\n','')

if 'V9522C_API_HARDENING' not in m:
    p=m.find('\n',m.find('public class ')); p=0 if p<0 else p
    m=m[:p+1]+'    // V9522C_API_HARDENING\n'+m[p+1:]
MAIN.write_text(m)

f=MAIN.read_text()
checks=[
 ('V9522C_API_HARDENING' in f,'marker'),
 ('V9522_MIN_NOTIONAL_GUARD' in f,'min notional'),
 ('V9522_VISIBLE_API_TEST' in f,'visible API test'),
 ('%.2f%% uzaklaştı' in f,'deviation format'),
]
for ok,name in checks:
 print(('OK   ' if ok else 'FAIL '),name)
 if not ok: raise SystemExit('v9.5.22c sanity failed: '+name)
print('v9.5.22c OK: min-notional guard + explicit API test + corrected deviation display.')
