from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
AGENT = JAVA / 'TradeAgentActivity.java'
BRAIN = JAVA / 'BrainActivity.java'
AUTO = JAVA / 'AutoTradeEngine.java'
MAIN = JAVA / 'MainActivity.java'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
BUILD = APP / 'app/build.gradle'
for p in (AGENT, BRAIN, AUTO, MAIN, MANIFEST, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.77 missing ' + str(p))

client = Path(__file__).with_name('BrainHubClient.java').read_text()
if 'V9577_OPTIONAL_PC_BRAINHUB' not in client:
    raise SystemExit('v9.5.77 BrainHubClient marker missing')
(JAVA / 'BrainHubClient.java').write_text(client)

agent = AGENT.read_text()
anchor = '        return BrainCore.symbolSnapshot(this, s);'
replacement = '''        if (BrainHubClient.configured(this)) {
            try { return BrainHubClient.symbolSnapshot(this, s); }
            catch (Throwable e) { return "PC Brain Hub erişilemedi; telefon verisi kullanılıyor.\\n" + BrainCore.symbolSnapshot(this, s); }
        }
        return BrainCore.symbolSnapshot(this, s);'''
if agent.count(anchor) != 1:
    raise SystemExit('v9.5.77 agent snapshot anchor changed')
agent = agent.replace(anchor, replacement, 1)
anchor = '        TextView note=label("FREE-ONLY kilidi'
pos = agent.find(anchor)
if pos < 0:
    raise SystemExit('v9.5.77 settings anchor missing')
hub_fields = '''        EditText hubEp=new EditText(this);hubEp.setHint("PC Brain Hub: https://tailscale-adresi:8787");hubEp.setText(BrainHubClient.endpoint(this));hubEp.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);box.addView(hubEp);
        EditText hubToken=new EditText(this);hubToken.setHint("Brain Hub erişim tokenı (boşsa mevcut korunur)");hubToken.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);box.addView(hubToken);
'''
agent = agent[:pos] + hub_fields + agent[pos:]
anchor = '            prefs().edit().putString("endpoint",ep.getText()==null?"":ep.getText().toString().trim()).putString("api_key",key.getText()==null?"":key.getText().toString().trim()).apply(); refreshStatusAsync();'
replacement = '''            try { BrainHubClient.save(this,hubEp.getText()==null?"":hubEp.getText().toString(),hubToken.getText()==null?"":hubToken.getText().toString()); }
            catch(Exception ex) { Toast.makeText(this,"Brain Hub ayarı: "+ex.getMessage(),Toast.LENGTH_LONG).show();return; }
            prefs().edit().putString("endpoint",ep.getText()==null?"":ep.getText().toString().trim()).putString("api_key",key.getText()==null?"":key.getText().toString().trim()).apply(); refreshStatusAsync();'''
if anchor not in agent:
    raise SystemExit('v9.5.77 save settings anchor changed')
agent = agent.replace(anchor, replacement, 1)
AGENT.write_text(agent)

brain = BRAIN.read_text()
start = brain.find('    private void scan(){')
end = brain.find('    @Override protected void onDestroy', start)
if start < 0 or end < 0:
    raise SystemExit('v9.5.77 BrainActivity scan method changed')
new_scan = r'''    private String localSnapshot(){
        return "=== TELEFON GLOBAL REJİM ===\n"+BrainCore.global(this)
            +"\n\n=== TELEFON LİDER ADAYLARI ===\n"+BrainCore.leaders(this,10)
            +"\n\nTimeframe: 1m→3m→5m→15m→30m→1h→4h→1D. Handoff ilk riski genişletemez.";
    }
    private void scan(){
        status.setText("Piyasa bağlamı taranıyor…");body.setText("PC Brain Hub varsa bağlanılıyor; bağlantı kesilirse telefon taraması kullanılır.");
        io.execute(()->{
            String result;boolean pc=false;
            if(BrainHubClient.configured(this)){
                try{result=BrainHubClient.dashboard(this);pc=true;}
                catch(Throwable e){result="PC Brain Hub erişilemedi: "+e.getClass().getSimpleName()+"\n\n"+localSnapshot();}
            }else result=localSnapshot();
            final String shown=result;final boolean pcUsed=pc;
            ui.post(()->{body.setText(shown);status.setText((pcUsed?"PC Brain Hub":"Telefon fallback")+" • Brain journal: "+BrainCore.journalCount(this));});
        });
    }
'''
brain = brain[:start] + new_scan + brain[end:]
BRAIN.write_text(brain)

auto = AUTO.read_text()
start = auto.find('    public static void onSignal(Context c,String symbol){')
end = auto.find('    private static void run(Context c,String s)', start)
if start < 0 or end < 0:
    raise SystemExit('v9.5.77 AutoTradeEngine entry anchor changed')
dry = '''    // V9577_DRY_RUN_LOCK: this release cannot invoke the private live order path.
    public static void onSignal(Context c,String symbol){
        if(c==null||symbol==null||symbol.trim().isEmpty())return;
        Context app=c.getApplicationContext();String s=symbol.trim().toUpperCase(Locale.US);
        SharedPreferences p=app.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
        p.edit().putBoolean("v9576_auto_enabled",false).putString("v9576_auto_last_status","DRY_RUN_ONLY • gerçek otomatik emir kilitli").apply();
        long now=System.currentTimeMillis(),ts=p.getLong("v9518_signal_time_"+s,0L);
        String verdict=p.getBoolean("v9518_signal_active_"+s,false)&&ts>0&&now>=ts&&now-ts<=120000L
            ? "DRY_RUN_CANDIDATE • "+s+" • signalAgeMs="+(now-ts)
            : "DRY_RUN_REJECT • "+s+" • inactive_or_stale_signal";
        BrainLearning.recordExecution(app,s,verdict);
    }

'''
auto = auto[:start] + dry + auto[end:]
AUTO.write_text(auto)

main = MAIN.read_text()
needle = 'boolean v9576On=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE).getBoolean("v9576_auto_enabled",false);'
if needle not in main: raise SystemExit('v9.5.77 live UI state anchor missing')
main = main.replace(needle, 'boolean v9576On=false;', 1)
needle = 'en.setChecked(sp.getBoolean("v9576_auto_enabled",false));'
if needle not in main: raise SystemExit('v9.5.77 live checkbox anchor missing')
main = main.replace(needle, 'en.setChecked(false);en.setEnabled(false);en.setText("Canlı otomatik emir testler bitene kadar kilitli");', 1)
needle = '.putBoolean("v9576_auto_enabled",en.isChecked())'
if needle not in main: raise SystemExit('v9.5.77 live save anchor missing')
main = main.replace(needle, '.putBoolean("v9576_auto_enabled",false)', 1)
main = main.replace('"CANLI OTO: KAPALI"','"DRY-RUN: AÇIK"',1)
MAIN.write_text(main)

build = BUILD.read_text()
build = re.sub(r'versionCode\s+\d+', 'versionCode 26091517', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.77'", build, count=1)
BUILD.write_text(build)

checks = {
    'PC client copied': (JAVA/'BrainHubClient.java').exists(),
    'PC to mobile read-only': 'BrainHubClient.dashboard(this)' in BRAIN.read_text() and 'BrainHubClient.symbolSnapshot(this, s)' in AGENT.read_text(),
    'local fallback': 'BrainCore.symbolSnapshot(this, s)' in AGENT.read_text() and 'localSnapshot()' in BRAIN.read_text(),
    'live entry disabled': 'IO.execute(()->run(app,s))' not in AUTO.read_text() and 'V9577_DRY_RUN_LOCK' in AUTO.read_text(),
    'live UI disabled': 'en.setEnabled(false)' in MAIN.read_text() and '.putBoolean("v9576_auto_enabled",false)' in MAIN.read_text(),
    'identity': "versionName '9.5.77'" in BUILD.read_text() and 'versionCode 26091517' in BUILD.read_text(),
}
for name, ok in checks.items(): print(('OK   ' if ok else 'FAIL '), name)
if not all(checks.values()): raise SystemExit('v9.5.77 integration check failed')
print('v9.5.77 OK: optional authenticated PC Brain Hub read path with local mobile fallback; live automatic order trigger locked to dry-run.')
