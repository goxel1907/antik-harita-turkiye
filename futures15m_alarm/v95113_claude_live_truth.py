"""v9.5.113-CLAUDE (Claude, Anthropic): Android PC LIVE truth.

Runs LAST in the Android prepare chain (after v9597_auto_chat_review.py).

Why: when the phone lost its Tailscale link to the PC, the app showed
"PC LIVE: KAPALI" from the phone's LOCAL flag (v9576_auto_enabled) while the PC
was still armed, and ACİL DURDUR failed silently. This patch:
  a) shows PC LIVE AÇIK/KAPALI only when the PC confirmed it via GET /live/status
     within the last 45 s, otherwise "BİLİNMİYOR — PC'ye ulaşılamıyor" (red);
     probes on every resume (plus the existing 1.5 s UI loop / 5 s throttle);
  b) ACİL DURDUR: configureLeaderAuto(false) + liveDisarm, then verifies
     armed==false (and leaderAuto.enabled==false) by GET /live/status,
     5 attempts ~3 s apart; green confirmation or persistent red failure;
  c) settings save with OTO OFF also disarms + verifies; PC sync failures toast red;
  d) read-only PC positions (GET /live/positions) in the OTO status card;
  e) version identity 9.5.113 / 26092201 / "v9.5.113-CLAUDE".
No order / cancel / close action is added anywhere.
"""
from pathlib import Path
import re

MARKER = 'CLAUDE_V113_ANDROID_LIVE_TRUTH'
APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
CARD = JAVA / 'AutoDecisionCard.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
HERE = Path(__file__).resolve().parent
TRUTH_SRC = HERE / 'V95113PcTruth.java'

for p in (MAIN, ANALYSIS, CARD, CLIENT, BUILD, TRUTH_SRC):
    if not p.exists():
        raise SystemExit('v9.5.113 missing required file: ' + str(p))


def fail(msg):
    raise SystemExit('v9.5.113 ' + msg)


def rep(src, old, new, what):
    n = src.count(old)
    if n != 1:
        fail(('anchor missing' if n == 0 else 'anchor ambiguous (%dx)' % n) + ': ' + what)
    return src.replace(old, new, 1)


def java_balanced(src):
    """Brace/paren balance outside strings, chars and comments."""
    depth = {'{': 0, '(': 0}
    close = {'}': '{', ')': '('}
    i = 0
    ins = inc = esc = lc = bc = False
    while i < len(src):
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if lc:
            if c == '\n':
                lc = False
        elif bc:
            if c == '*' and n == '/':
                bc = False
                i += 1
        elif ins:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                ins = False
            elif c == '\n':
                return False, 'newline inside string literal near offset %d' % i
        elif inc:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                inc = False
        else:
            if c == '/' and n == '/':
                lc = True
                i += 1
            elif c == '/' and n == '*':
                bc = True
                i += 1
            elif c == '"':
                ins = True
            elif c == "'":
                inc = True
            elif c in depth:
                depth[c] += 1
            elif c in close:
                depth[close[c]] -= 1
                if depth[close[c]] < 0:
                    return False, 'unbalanced %s near offset %d' % (c, i)
        i += 1
    if ins or inc or bc:
        return False, 'unterminated literal/comment'
    if depth['{'] or depth['(']:
        return False, 'unbalanced braces/parens %r' % depth
    return True, ''


main = MAIN.read_text(encoding='utf-8')
if MARKER in main:
    fail('already applied to this build tree; start a clean prepare chain (prepare_v9523.sh recreates it).')
for need in ('V9582_VISIBLE_LIVE_STATUS_PANEL', 'V9589_MOBILE_REARM', 'V9597_AUTO_CHAT_REVIEW',
             'ANDROID_EMERGENCY_STOP', 'v9588_pc_auto_sync_ok', 'private void v9582MaybeProbePcLive()'):
    if need not in main:
        fail('requires v9579/v9597 MainActivity patches first (missing ' + need + ')')
client = CLIENT.read_text(encoding='utf-8')
if 'public static JSONObject livePositions(Context c)' not in client:
    fail('BrainHubClient.livePositions missing: futures15m_alarm/BrainHubClient.java must be the v9.5.113 copy (v9577 copies it).')

# V95113PcTruth: checked-in helper, copied like AutoDecisionCard.java (v9597).
TRUTH.write_text(TRUTH_SRC.read_text(encoding='utf-8'), encoding='utf-8')

# --------------------------------------------------------------------------- (a) OTO İŞLEM / BEYİN button
old_button = r'''        Button v9576Auto=button("🤖 OTO İŞLEM / BEYİN\n"+(v9576On?"CANLI OTO: AÇIK":"PC LIVE: "+(v9576On?"OTO AÇIK":"KAPALI"))+" • marj / kaldıraç / max pozisyon",v9576On?Color.rgb(22,101,52):Color.rgb(71,85,105));
        v9576Auto.setOnClickListener(v -> v9576ShowAutoSettings());'''
new_button = r'''        // CLAUDE_V113_ANDROID_LIVE_TRUTH: subtitle = PC-confirmed LIVE state only, never the local flag.
        Button v9576Auto=button(v95113OtoButtonLabel(System.currentTimeMillis()),v95113OtoButtonColor(System.currentTimeMillis()));
        v9576Auto.setMaxLines(3);v95113OtoButton=v9576Auto;v95113OtoButtonShown="";
        v9576Auto.setOnClickListener(v -> v9576ShowAutoSettings());'''
main = rep(main, old_button, new_button, 'OTO İŞLEM / BEYİN button (v9579 "PC LIVE: "+(v9576On?...) label)')

# --------------------------------------------------------------------------- (a) probe on every resume
old_resume = '''        // V9549_START_UI_LOOP
        v9549StartUiLoop();'''
new_resume = '''        // CLAUDE_V113_ANDROID_LIVE_TRUTH: every resume forces a fresh PC /live/status probe (network on v9522Io).
        try { v9582PcProbeAt = 0L; v9582MaybeProbePcLive(); } catch (Throwable ignored) {}
        // V9549_START_UI_LOOP
        v9549StartUiLoop();'''
main = rep(main, old_resume, new_resume, 'onResume V9549_START_UI_LOOP')

# --------------------------------------------------------------------------- (a) record probe success / failure
old_probe_ok = '''                org.json.JSONObject st=BrainHubClient.liveStatus(this);
                org.json.JSONObject la=st.optJSONObject("leaderAuto");'''
new_probe_ok = '''                org.json.JSONObject st=BrainHubClient.liveStatus(this);
                V95113PcTruth.recordStatus(sp,st,System.currentTimeMillis()); // CLAUDE_V113_ANDROID_LIVE_TRUTH
                org.json.JSONObject la=st.optJSONObject("leaderAuto");'''
main = rep(main, old_probe_ok, new_probe_ok, 'v9582 probe liveStatus success')

old_probe_acc = '''                }catch(Throwable accountError){
                    sp.edit().putBoolean("v9583_pc_account_ok",false)
                        .putString("v9583_pc_account_error",accountError.getClass().getSimpleName())
                        .putLong("v9583_pc_account_ts",System.currentTimeMillis()).apply();
                }'''
new_probe_acc = old_probe_acc + '''
                // CLAUDE_V113_ANDROID_LIVE_TRUTH: read-only PC position ledger (GET /live/positions), max every 10 s.
                if(System.currentTimeMillis()-v95113PosAttemptAt>=10000L){
                    v95113PosAttemptAt=System.currentTimeMillis();
                    V95113PcTruth.fetchPositions(this,sp);
                }'''
main = rep(main, old_probe_acc, new_probe_acc, 'v9582 probe liveAccount catch')

old_probe_fail = '''            }catch(Throwable e){
                sp.edit().putBoolean("v9582_pc_probe_ok",false)
                    .putString("v9582_pc_probe_error",e.getClass().getSimpleName())'''
new_probe_fail = '''            }catch(Throwable e){
                long v95113FailNow=System.currentTimeMillis();
                V95113PcTruth.recordFailure(sp,e,v95113FailNow); // CLAUDE_V113_ANDROID_LIVE_TRUTH
                boolean v95113HardStale=V95113PcTruth.shouldMarkProbeUnhealthy(sp,v95113FailNow);
                sp.edit().putBoolean("v9582_pc_probe_ok",v95113HardStale?false:sp.getBoolean("v9582_pc_probe_ok",false))
                    .putString("v9582_pc_probe_error",e.getClass().getSimpleName())'''
main = rep(main, old_probe_fail, new_probe_fail, 'v9582 probe failure branch')

# --------------------------------------------------------------------------- (a) status panel
old_head = '''        android.widget.TextView head=text("🤖 OTO İŞLEM DURUMU • SABİT",14f,android.graphics.Color.WHITE,true);
        box.addView(head,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));'''
new_head = old_head + '''
        // CLAUDE_V113_ANDROID_LIVE_TRUTH: PC LIVE line = PC-confirmed state (<=45 s) or BİLİNMİYOR (red).
        android.widget.TextView v95113Truth=text(V95113PcTruth.label(sp,now),13f,V95113PcTruth.labelColor(sp,now),true);
        v95113Truth.setPadding(dp(9),dp(6),dp(9),dp(4));
        box.addView(v95113Truth,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        String v95113Stop=V95113PcTruth.stopLine(sp);
        if(v95113Stop!=null&&!v95113Stop.isEmpty()){
            android.widget.TextView v95113StopTv=text(v95113Stop,12f,V95113PcTruth.stopColor(sp),true);
            v95113StopTv.setPadding(dp(9),dp(4),dp(9),dp(6));
            if(V95113PcTruth.stopFailed(sp))v95113StopTv.setBackgroundColor(android.graphics.Color.rgb(69,10,10));
            box.addView(v95113StopTv,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        v95113RefreshOtoButton();'''
main = rep(main, old_head, new_head, 'OTO İŞLEM DURUMU head')

old_live_line = r'''            st.append("\nPC CANLI İŞLEM: ").append(armed?"AÇIK":"KAPALI");
            if(armed)st.append(" • kalan ").append(v9582ArmRemaining(sp.getString("v9582_pc_expires_at","")));'''
new_live_line = r'''            st.append("\n").append(V95113PcTruth.label(sp,now)); // CLAUDE_V113_ANDROID_LIVE_TRUTH'''
main = rep(main, old_live_line, new_live_line, 'panel "PC CANLI İŞLEM" line (v9597 translation of "PC LIVE: ARMED/KAPALI")')

old_arm_text = '''        armButton.setText(armed?"✅ LIVE AÇIK":"▶ LIVE 24 SAAT BAŞLAT / YENİDEN BAŞLAT");'''
new_arm_text = '''        // CLAUDE_V113_ANDROID_LIVE_TRUTH: never imply "not armed" when the PC state is unknown.
        final int v95113ArmState=V95113PcTruth.state(sp,now);
        armButton.setText(v95113ArmState==V95113PcTruth.ARMED?"✅ "+V95113PcTruth.label(sp,now)
                :(v95113ArmState==V95113PcTruth.UNKNOWN?"⚠ "+V95113PcTruth.label(sp,now):"▶ LIVE 24 SAAT BAŞLAT / YENİDEN BAŞLAT"));
        if(v95113ArmState==V95113PcTruth.UNKNOWN){armButton.setTextColor(android.graphics.Color.rgb(220,38,38));armButton.setTextSize(12f);}'''
main = rep(main, old_arm_text, new_arm_text, 'armButton text')

old_alp = '''        android.widget.LinearLayout.LayoutParams alp=new android.widget.LinearLayout.LayoutParams(-1,dp(46));'''
new_alp = '''        android.widget.LinearLayout.LayoutParams alp=new android.widget.LinearLayout.LayoutParams(-1,v95113ArmState==V95113PcTruth.UNKNOWN?android.view.ViewGroup.LayoutParams.WRAP_CONTENT:dp(46));'''
main = rep(main, old_alp, new_alp, 'armButton layout params')

old_arm_ok = '''                    sp.edit().putBoolean("v9582_pc_probe_ok",true)
                        .putBoolean("v9582_pc_armed",true)'''
new_arm_ok = '''                    V95113PcTruth.recordArm(sp,out,System.currentTimeMillis()); // CLAUDE_V113_ANDROID_LIVE_TRUTH
                    sp.edit().putBoolean("v9582_pc_probe_ok",true)
                        .putBoolean("v9582_pc_armed",true)'''
main = rep(main, old_arm_ok, new_arm_ok, 'liveArm success prefs write')

# --------------------------------------------------------------------------- (d) PC positions in the OTO card
old_wait = '''        if(openShown==0){
            android.widget.TextView wait=text("Açık oto pozisyon yok • uygun sinyal oluşursa burada coin / yön / canlı PnL / STOP / TP durumları görünür.",
                    11.2f,android.graphics.Color.rgb(148,163,184),false);
            wait.setPadding(0,dp(6),0,0);
            box.addView(wait,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        }'''
new_wait = '''        // CLAUDE_V113_ANDROID_LIVE_TRUTH: PC (BrainHub) positions, read-only (GET /live/positions). No order/cancel/close.
        boolean v95113HubConfigured=BrainHubClient.configured(this);
        int v95113PosState=V95113PcTruth.positionsState(sp,now,v95113HubConfigured);
        int v95113PcOpen=V95113PcTruth.positionsOpenCount(sp,now,v95113HubConfigured);
        if(openShown==0&&(v95113PosState==V95113PcTruth.POS_NOT_CONFIGURED||v95113PcOpen==0)){
            android.widget.TextView wait=text("Açık oto pozisyon yok • uygun sinyal oluşursa burada coin / yön / canlı PnL / STOP / TP durumları görünür.",
                    11.2f,android.graphics.Color.rgb(148,163,184),false);
            wait.setPadding(0,dp(6),0,0);
            box.addView(wait,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        String v95113PosText=V95113PcTruth.positionsText(sp,now,v95113HubConfigured);
        if(v95113PosText!=null&&!v95113PosText.isEmpty()){
            boolean v95113PosBad=v95113PosState==V95113PcTruth.POS_UNREACHABLE;
            android.widget.TextView v95113PosTv=text(v95113PosText,11.6f,v95113PosBad?android.graphics.Color.rgb(248,113,113):android.graphics.Color.WHITE,v95113PosBad);
            v95113PosTv.setPadding(dp(9),dp(7),dp(9),dp(7));
            v95113PosTv.setBackgroundColor(V95113PcTruth.positionsBackground(sp,now,v95113HubConfigured));
            android.widget.LinearLayout.LayoutParams v95113PosLp=new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            v95113PosLp.setMargins(0,dp(7),0,0);box.addView(v95113PosTv,v95113PosLp);
        }'''
main = rep(main, old_wait, new_wait, '"Açık oto pozisyon yok" section')

# --------------------------------------------------------------------------- (b) ACİL DURDUR with verification
em_start_anchor = 'st.setText("SON DURUM: ACİL DURDUR • PC auto kapatılıyor ve LIVE disarm ediliyor");'
em_end_anchor = 'Toast.makeText(this,"ACİL DURDUR: yeni PC oto girişleri kapatılıyor ve LIVE disarm ediliyor.",Toast.LENGTH_LONG).show();'
if main.count(em_start_anchor) != 1 or main.count(em_end_anchor) != 1:
    fail('ACİL DURDUR (ANDROID_EMERGENCY_STOP) handler anchors missing/ambiguous')
a = main.find(em_start_anchor)
b = main.find(em_end_anchor, a)
if b < 0:
    fail('ACİL DURDUR handler end anchor precedes start')
b += len(em_end_anchor)
old_em = main[a:b]
for must in ('BrainHubClient.configureLeaderAuto(this,false,', 'BrainHubClient.liveDisarm(this,"ANDROID_EMERGENCY_STOP")', 'catch(Throwable ignored){}'):
    if must not in old_em:
        fail('ACİL DURDUR handler shape changed (missing ' + must + ')')
new_em = '''// CLAUDE_V113_ANDROID_LIVE_TRUTH: stop is sent AND confirmed by GET /live/status (5 tries, ~3 s apart).
                st.setText("SON DURUM: ACİL DURDUR • PC auto kapatılıyor ve LIVE disarm ediliyor • PC onayı bekleniyor");
                st.setTextColor(Color.rgb(250,204,21));
                v95113StopAndVerify("ANDROID_EMERGENCY_STOP",st);
                Toast.makeText(this,"ACİL DURDUR: yeni PC oto girişleri kapatılıyor ve LIVE disarm ediliyor. PC onayı bekleniyor…",Toast.LENGTH_LONG).show();'''
main = main[:a] + new_em + main[b:]
# The local flag reset right before the handler body must stay.
if 'setOnClickListener(v->{\n                sp.edit().putBoolean("v9576_auto_enabled",false).apply();en.setChecked(false);\n                // CLAUDE_V113_ANDROID_LIVE_TRUTH' not in main:
    fail('ACİL DURDUR local flag reset not retained')

# --------------------------------------------------------------------------- (c) settings save: red toast + OTO OFF disarm
old_save = '''                    v9522Io.execute(()->{
                        try{
                            org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,en.isChecked(),margin,lev,max,lng.isChecked(),sht.isChecked());
                            sp.edit().putBoolean("v9588_pc_auto_sync_ok",cfg.optBoolean("ok",false))
                              .putString("v9588_pc_auto_sync_error",cfg.optBoolean("ok",false)?"":cfg.optJSONArray("reasons")==null?cfg.optString("error","PC_AUTO_CONFIG_REJECTED"):cfg.optJSONArray("reasons").toString())
                              .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                        }catch(Throwable syncError){
                            sp.edit().putBoolean("v9588_pc_auto_sync_ok",false)
                              .putString("v9588_pc_auto_sync_error",syncError.getClass().getSimpleName())
                              .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                        }
                    });
                    Toast.makeText(this,"Oto işlem ayarı kaydedildi • "+(en.isChecked()?"CANLI AÇIK":"KAPALI"),Toast.LENGTH_LONG).show();dlg.dismiss();'''
new_save = '''                    // CLAUDE_V113_ANDROID_LIVE_TRUTH: PC sync failures are shown in red, never silent.
                    final boolean v95113AutoOn=en.isChecked();
                    final boolean v95113Hub=BrainHubClient.configured(this);
                    v9522Io.execute(()->{
                        try{
                            org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,v95113AutoOn,margin,lev,max,lng.isChecked(),sht.isChecked());
                            sp.edit().putBoolean("v9588_pc_auto_sync_ok",cfg.optBoolean("ok",false))
                              .putString("v9588_pc_auto_sync_error",cfg.optBoolean("ok",false)?"":cfg.optJSONArray("reasons")==null?cfg.optString("error","PC_AUTO_CONFIG_REJECTED"):cfg.optJSONArray("reasons").toString())
                              .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                            if(v95113Hub&&!cfg.optBoolean("ok",false)){
                                final String v95113Why=V95113PcTruth.reasons(cfg);
                                runOnUiThread(()->v95113RedToast("PC OTO SENKRON HATASI ("+(v95113AutoOn?"AÇMA":"KAPATMA")+"): PC ayarı reddetti • "+v95113Why));
                            }
                        }catch(Throwable syncError){
                            sp.edit().putBoolean("v9588_pc_auto_sync_ok",false)
                              .putString("v9588_pc_auto_sync_error",syncError.getClass().getSimpleName())
                              .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                            if(v95113Hub){
                                final String v95113Why=V95113PcTruth.err(syncError);
                                runOnUiThread(()->v95113RedToast("PC OTO SENKRON HATASI ("+(v95113AutoOn?"AÇMA":"KAPATMA")+"): PC'ye ulaşılamadı • "+v95113Why));
                            }
                        }
                    });
                    Toast.makeText(this,"Oto işlem ayarı kaydedildi • "+(en.isChecked()?"CANLI AÇIK":"KAPALI"),Toast.LENGTH_LONG).show();
                    // CLAUDE_V113_ANDROID_LIVE_TRUTH: OTO OFF in the app also stops PC LIVE and verifies it on the PC.
                    if(!v95113AutoOn&&v95113Hub)v95113StopAndVerify("ANDROID_AUTO_OFF",null);
                    dlg.dismiss();'''
main = rep(main, old_save, new_save, 'settings save v9588 PC leader-auto sync')

# --------------------------------------------------------------------------- (e) visible version identity
main = rep(main, 'st.append("\\nSürüm: v9.5.111-CLAUDE • ', 'st.append("\\nSürüm: v9.5.113-CLAUDE • ', 'visible "Sürüm: v9.5.111-CLAUDE" line (v9597)')
hdr = re.compile(r'(TextView v955Version = text\(")v9\.5(?:\.\d+)*(?:-CLAUDE)?(\s+•\s+MANUEL PRO")')
if len(hdr.findall(main)) != 1:
    fail('main header version label anchor missing/ambiguous')
main = hdr.sub(r'\g<1>v9.5.113-CLAUDE\g<2>', main, count=1)

# --------------------------------------------------------------------------- helpers
helpers = r'''
    // ============================================================
    // CLAUDE_V113_ANDROID_LIVE_TRUTH (Claude, Anthropic • v9.5.113-CLAUDE)
    // PC LIVE state on Android = what the PC confirmed via GET /live/status in the
    // last 45 s (V95113PcTruth). Stop / OTO-off intents are verified on the PC,
    // never assumed. PC positions are read-only (GET /live/positions).
    // No Binance order / cancel / close side effects here.
    // ============================================================
    private android.widget.Button v95113OtoButton;
    private String v95113OtoButtonShown="";
    private volatile long v95113PosAttemptAt=0L;
    // Dedicated worker (one per process, thread created lazily): an emergency stop must not
    // queue behind a slow status probe on v9522Io.
    private static final java.util.concurrent.ExecutorService v95113StopIo=java.util.concurrent.Executors.newSingleThreadExecutor();

    private String v95113OtoButtonLabel(long now){
        android.content.SharedPreferences sp=v9522Prefs();
        boolean localOn=sp.getBoolean("v9576_auto_enabled",false);
        return "🤖 OTO İŞLEM / BEYİN • telefon OTO "+(localOn?"AÇIK":"KAPALI")+"\n"+V95113PcTruth.label(sp,now);
    }

    private int v95113OtoButtonColor(long now){
        int s=V95113PcTruth.state(v9522Prefs(),now);
        if(s==V95113PcTruth.ARMED)return Color.rgb(22,101,52);
        if(s==V95113PcTruth.DISARMED)return Color.rgb(71,85,105);
        return Color.rgb(153,27,27);
    }

    // UI thread only (called from the 1.5 s UI loop via the OTO card and after stop verification).
    private void v95113RefreshOtoButton(){
        android.widget.Button b=v95113OtoButton;
        if(b==null)return;
        long now=System.currentTimeMillis();
        String label=v95113OtoButtonLabel(now);
        int color=v95113OtoButtonColor(now);
        String key=label+"|"+color;
        if(key.equals(v95113OtoButtonShown))return;
        v95113OtoButtonShown=key;
        b.setText(label);
        b.setBackground(v955Panel(color,Color.argb(72,255,255,255),12));
    }

    private void v95113RedToast(String msg){
        try{
            android.content.Context app=getApplicationContext();
            android.widget.TextView tv=new android.widget.TextView(app);
            tv.setText(msg);tv.setTextColor(Color.WHITE);tv.setTextSize(14f);tv.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
            tv.setPadding(dp(14),dp(10),dp(14),dp(10));
            tv.setBackground(v955Panel(Color.rgb(185,28,28),Color.argb(90,255,255,255),10));
            Toast t=new Toast(app);t.setDuration(Toast.LENGTH_LONG);t.setView(tv);t.show();
        }catch(Throwable e){
            try{Toast.makeText(getApplicationContext(),msg,Toast.LENGTH_LONG).show();}catch(Throwable ignored){}
        }
    }

    // Sends configureLeaderAuto(false) + liveDisarm(reason), then confirms armed==false
    // (and leaderAuto.enabled==false when exposed) via GET /live/status. 5 attempts, ~3 s apart.
    private void v95113StopAndVerify(final String reason,final android.widget.TextView dialogStatus){
        final android.content.SharedPreferences sp=v9522Prefs();
        V95113PcTruth.markStopPending(sp,reason,System.currentTimeMillis());
        try{v9549InstallRecentTradesCard();}catch(Throwable ignored){}
        v95113StopIo.execute(()->{
            final int maxAttempts=5;
            boolean confirmed=false,reached=false;
            String lastError="";
            for(int attempt=1;attempt<=maxAttempts&&!confirmed;attempt++){
                if(attempt>1){
                    try{Thread.sleep(3000L);}catch(InterruptedException ie){Thread.currentThread().interrupt();break;}
                }
                V95113PcTruth.markStopAttempt(sp,attempt,maxAttempts);
                reached=false;
                try{
                    double m=v9549Number(sp.getString("v9576_auto_margin","0"));if(Double.isNaN(m))m=0.0;
                    int l=1;try{l=Integer.parseInt(sp.getString("v9576_auto_leverage","1"));}catch(Throwable ignored){}
                    int mx=sp.getInt("v9576_auto_max_positions",1);
                    org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,false,m,l,mx,sp.getBoolean("v9576_auto_long",true),sp.getBoolean("v9576_auto_short",true));
                    if(!cfg.optBoolean("ok",false))lastError="Leader Auto kapatma reddedildi: "+V95113PcTruth.reasons(cfg);
                }catch(Throwable e){lastError="Leader Auto kapatma: "+V95113PcTruth.err(e);}
                try{
                    org.json.JSONObject d=BrainHubClient.liveDisarm(this,reason);
                    if(d.optInt("_httpStatus",200)>=400)lastError="LIVE disarm: "+V95113PcTruth.reasons(d);
                }catch(Throwable e){lastError="LIVE disarm: "+V95113PcTruth.err(e);}
                try{
                    org.json.JSONObject status=BrainHubClient.liveStatus(this);
                    V95113PcTruth.recordStatus(sp,status,System.currentTimeMillis());
                    reached=true;
                    boolean armedNow=!status.has("armed")||status.isNull("armed")||status.optBoolean("armed",true);
                    org.json.JSONObject la=status.optJSONObject("leaderAuto");
                    boolean leaderOn=la!=null&&la.optBoolean("enabled",false);
                    if(!armedNow&&!leaderOn)confirmed=true;
                    else lastError=armedNow?"PC hâlâ LIVE ARMED bildiriyor":"PC Leader Auto hâlâ açık bildiriyor";
                }catch(Throwable e){
                    V95113PcTruth.recordFailure(sp,e,System.currentTimeMillis());
                    lastError="PC durum doğrulaması: "+V95113PcTruth.err(e);
                }
            }
            final long doneAt=System.currentTimeMillis();
            final boolean ok=confirmed;
            final String toastMsg=ok?V95113PcTruth.markStopConfirmed(sp,doneAt):V95113PcTruth.markStopFailed(sp,reached,lastError,doneAt);
            final String lineMsg=V95113PcTruth.stopLine(sp);
            runOnUiThread(()->{
                try{
                    if(dialogStatus!=null){
                        dialogStatus.setText("SON DURUM: "+lineMsg);
                        dialogStatus.setTextColor(ok?Color.rgb(74,222,128):Color.rgb(248,113,113));
                    }
                }catch(Throwable ignored){}
                if(ok){try{Toast.makeText(getApplicationContext(),toastMsg,Toast.LENGTH_LONG).show();}catch(Throwable ignored){}}
                else v95113RedToast(toastMsg);
                try{v9582PcProbeAt=0L;v9549InstallRecentTradesCard();}catch(Throwable ignored){}
                try{v95113RefreshOtoButton();}catch(Throwable ignored){}
            });
        });
    }
'''
pos = main.rfind('}')
if pos < 0:
    fail('MainActivity closing brace missing')
main = main[:pos] + helpers + '\n' + main[pos:]

ok, why = java_balanced(main)
if not ok:
    fail('MainActivity balance check failed after patch: ' + why)
MAIN.write_text(main, encoding='utf-8')

# --------------------------------------------------------------------------- AutoDecisionCard: same truth label
card = CARD.read_text(encoding='utf-8')
card = rep(card, r'''        b.append("\nPC bağlı • CANLI İŞLEM ").append(sp.getBoolean("v9582_pc_armed",false)?"AÇIK":"KAPALI");''',
           r'''        b.append("\nPC bağlı • ").append(V95113PcTruth.label(sp,now)); // CLAUDE_V113_ANDROID_LIVE_TRUTH''',
           'AutoDecisionCard "PC bağlı • CANLI İŞLEM" line')
ok, why = java_balanced(card)
if not ok:
    fail('AutoDecisionCard balance check failed: ' + why)
CARD.write_text(card, encoding='utf-8')

# --------------------------------------------------------------------------- AnalysisPackActivity visible version
analysis = ANALYSIS.read_text(encoding='utf-8')
analysis = rep(analysis, 'CLAUDE ANALİZ PAKETİ • v9.5.111', 'CLAUDE ANALİZ PAKETİ • v9.5.113', 'AnalysisPackActivity title version')
ANALYSIS.write_text(analysis, encoding='utf-8')

# --------------------------------------------------------------------------- build identity
build = BUILD.read_text(encoding='utf-8')
if len(re.findall(r'versionCode\s+\d+', build)) != 1 or len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail('build.gradle versionCode/versionName anchors missing/ambiguous')
build = re.sub(r'versionCode\s+\d+', 'versionCode 26092201', build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.113'", build, count=1)
BUILD.write_text(build, encoding='utf-8')

# --------------------------------------------------------------------------- final checks
main = MAIN.read_text(encoding='utf-8')
card = CARD.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
checks = {
    'marker in MainActivity': MARKER in main,
    'marker in V95113PcTruth': MARKER in truth,
    'truth helper 45 s window': 'FRESH_MS = 45000L' in truth and 'MIN_FAILURES_BEFORE_UNHEALTHY = 3' in truth and 'shouldMarkProbeUnhealthy' in truth and 'PC LIVE: BİLİNMİYOR — PC\'ye ulaşılamıyor (son bağlantı ' in truth,
    'no local-flag PC LIVE label': '"PC LIVE: "+(v9576On?' not in main and '"CANLI OTO: AÇIK"' not in main,
    'button uses PC truth': 'v95113OtoButton=v9576Auto' in main and 'v95113RefreshOtoButton();' in main,
    'probe records success+failure': 'V95113PcTruth.recordStatus(sp,st,' in main and 'V95113PcTruth.recordFailure(sp,e,' in main,
    'probe on resume': 'v9582PcProbeAt = 0L; v9582MaybeProbePcLive();' in main,
    'panel truth line': 'V95113PcTruth.label(sp,now),13f' in main and '"\\nPC CANLI İŞLEM: "' not in main,
    'arm button truth': 'v95113ArmState==V95113PcTruth.UNKNOWN?"⚠ "' in main and 'LIVE 24 SAAT BAŞLAT / YENİDEN BAŞLAT' in main,
    'emergency verify': 'v95113StopAndVerify("ANDROID_EMERGENCY_STOP",st)' in main and 'BrainHubClient.liveDisarm(this,reason)' in main
                        and 'catch(Throwable ignored){}\n                    try{BrainHubClient.liveDisarm(this,"ANDROID_EMERGENCY_STOP");}catch(Throwable ignored){}' not in main,
    'emergency retries 5x3s': 'maxAttempts=5' in main and 'Thread.sleep(3000L)' in main and 'BrainHubClient.liveStatus(this)' in main,
    'emergency failure text': 'C:\\\\BrainHub\\\\_claude_v112\\\\LIVE-KAPAT.cmd' in truth and "PC'YE ULAŞILAMADI — PC'de LIVE AÇIK OLABİLİR." in truth,
    'emergency success text': 'PC LIVE KAPANDI • PC onayladı ' in truth,
    'local flag reset kept': 'sp.edit().putBoolean("v9576_auto_enabled",false).apply();en.setChecked(false);' in main,
    'OTO OFF disarms + verifies': 'v95113StopAndVerify("ANDROID_AUTO_OFF",null)' in main,
    'sync failure red toast': main.count('v95113RedToast("PC OTO SENKRON HATASI') == 2,
    'PC positions read-only': 'V95113PcTruth.fetchPositions(this,sp)' in main and 'BrainHubClient.livePositions(c)' in truth
                              and 'PC pozisyonları alınamadı (son bağlantı ' in truth and 'Kapanan ' in truth,
    'BrainHubClient livePositions GET': 'return get(c, "/live/positions");' in CLIENT.read_text(encoding='utf-8'),
    'no new order path': 'liveExecute' not in helpers and 'liveExecute' not in truth and '/live/execute' not in truth,
    'AutoDecisionCard truth label': 'V95113PcTruth.label(sp,now)' in card,
    'visible version': 'Sürüm: v9.5.113-CLAUDE' in main and 'v9.5.113-CLAUDE  •  MANUEL PRO' in main
                       and 'CLAUDE ANALİZ PAKETİ • v9.5.113' in ANALYSIS.read_text(encoding='utf-8'),
    'no stale 9.5.111 visible': 'v9.5.111' not in main,
    'identity': "versionName '9.5.113'" in build and 'versionCode 26092201' in build,
    'MainActivity balanced': java_balanced(main)[0],
    'V95113PcTruth balanced': java_balanced(truth)[0],
}
for name, good in checks.items():
    print(('OK   ' if good else 'FAIL '), name)
bad = [k for k, v in checks.items() if not v]
if bad:
    fail('integration check failed: ' + ', '.join(bad))
print('v9.5.113-CLAUDE OK: ' + MARKER + ' • PC LIVE shown only from PC-confirmed /live/status (<=45 s), '
      'ACİL DURDUR / OTO KAPAT verified on the PC, read-only PC positions; no order action added.')
