from pathlib import Path

ENGINE = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/V9538MarketRadarEngine.java')

if not ENGINE.exists():
    raise SystemExit('v9.5.38b missing generated radar engine: ' + str(ENGINE))

src = ENGINE.read_text()

old = '''    private org.json.JSONArray getArray(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return new org.json.JSONArray(r.body().string());}
    }
    private org.json.JSONObject getObject(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return new org.json.JSONObject(r.body().string());}
    }
'''

new = '''    private org.json.JSONArray getArray(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){
            if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            String body=r.body().string();
            try{return new org.json.JSONArray(body);}
            catch(org.json.JSONException e){throw new java.io.IOException("Invalid JSON array from "+p,e);}
        }
    }
    private org.json.JSONObject getObject(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){
            if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            String body=r.body().string();
            try{return new org.json.JSONObject(body);}
            catch(org.json.JSONException e){throw new java.io.IOException("Invalid JSON object from "+p,e);}
        }
    }
'''

if old not in src:
    if 'catch(org.json.JSONException e)' in src:
        print('v9.5.38b already applied.')
    else:
        raise SystemExit('v9.5.38b JSON method anchor not found')
else:
    src = src.replace(old, new, 1)
    ENGINE.write_text(src)

out = ENGINE.read_text()
checks = {
    'array JSON checked exception wrapped': 'Invalid JSON array from' in out,
    'object JSON checked exception wrapped': 'Invalid JSON object from' in out,
    'two JSONException catches': out.count('catch(org.json.JSONException e)') >= 2,
    'radar engine retained': 'BINANCE_TOP3_PLUS_5' in out,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)

bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.38b sanity failed: ' + ', '.join(bad))

print('v9.5.38b OK: Android org.json checked JSONException is wrapped as IOException.')
