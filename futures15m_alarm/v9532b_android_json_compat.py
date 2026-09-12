from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
CTX = APP / 'app/src/main/java/com/futuresalarm/app/V9531DecisionContext.java'

if not CTX.exists():
    raise SystemExit('v9.5.32b missing V9531DecisionContext.java')

s = CTX.read_text()

old_array = '            return new org.json.JSONArray(res.body().string());'
new_array = '''            String payload = res.body().string();
            try {
                return new org.json.JSONArray(payload);
            } catch (org.json.JSONException jsonError) {
                throw new java.io.IOException("Invalid Binance JSON array", jsonError);
            }'''

old_object = '            return new org.json.JSONObject(res.body().string());'
new_object = '''            String payload = res.body().string();
            try {
                return new org.json.JSONObject(payload);
            } catch (org.json.JSONException jsonError) {
                throw new java.io.IOException("Invalid Binance JSON object", jsonError);
            }'''

if old_array in s:
    s = s.replace(old_array, new_array, 1)
elif 'Invalid Binance JSON array' not in s:
    raise SystemExit('v9.5.32b JSONArray anchor missing')

if old_object in s:
    s = s.replace(old_object, new_object, 1)
elif 'Invalid Binance JSON object' not in s:
    raise SystemExit('v9.5.32b JSONObject anchor missing')

if 'V9532B_ANDROID_JSON_CHECKED_EXCEPTION_FIX' not in s:
    marker = 'final class V9531DecisionContext {'
    s = s.replace(marker, marker + '\n    // V9532B_ANDROID_JSON_CHECKED_EXCEPTION_FIX', 1)

CTX.write_text(s)

final = CTX.read_text()
checks = {
    'array parse wrapped': 'Invalid Binance JSON array' in final and 'catch (org.json.JSONException jsonError)' in final,
    'object parse wrapped': 'Invalid Binance JSON object' in final,
    'raw checked parse removed': 'return new org.json.JSONArray(res.body().string());' not in final and 'return new org.json.JSONObject(res.body().string());' not in final,
    'marker': 'V9532B_ANDROID_JSON_CHECKED_EXCEPTION_FIX' in final,
}
failed = [k for k,v in checks.items() if not v]
for k,v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
if failed:
    raise SystemExit('v9.5.32b sanity failed: ' + ', '.join(failed))

print('v9.5.32b OK: Android org.json checked exceptions are wrapped as IOException.')
