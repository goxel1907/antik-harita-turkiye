from pathlib import Path

JAVA = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app')
ATTN = JAVA / 'V9542AttentionRadar.java'
if not ATTN.exists():
    raise SystemExit('v9.5.42b attention engine missing: ' + str(ATTN))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/': block_comment = False; i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/': line_comment = True; i += 1
            elif c == '/' and n == '*': block_comment = True; i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

src = ATTN.read_text()
b = method_bounds(src, '    private void notifyCandidate(Candidate c,boolean risk)')
if not b:
    raise SystemExit('v9.5.42b notifyCandidate anchor missing')
a, _, e = b
native = r'''    // V9542B_NATIVE_NOTIFICATION_NO_ANDROIDX
    private void notifyCandidate(Candidate c,boolean risk){
        try{
            android.app.NotificationManager nm=(android.app.NotificationManager)app.getSystemService(android.content.Context.NOTIFICATION_SERVICE);if(nm==null)return;
            String ch="v9542_early_attention";
            if(android.os.Build.VERSION.SDK_INT>=26){android.app.NotificationChannel nc=new android.app.NotificationChannel(ch,"Erken İlgi / Haber Radarı",android.app.NotificationManager.IMPORTANCE_DEFAULT);nc.setDescription("Sosyal, haber ve teknik öncü keşif uyarıları; işlem sinyali değildir.");nm.createNotificationChannel(nc);}
            android.content.Intent in=new android.content.Intent(app,V9542AttentionActivity.class);in.setAction("v9542."+c.t.symbol+"."+System.currentTimeMillis());in.putExtra("v9542_symbol",c.t.symbol);in.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags=android.app.PendingIntent.FLAG_UPDATE_CURRENT;if(android.os.Build.VERSION.SDK_INT>=23)flags|=android.app.PendingIntent.FLAG_IMMUTABLE;
            android.app.PendingIntent pi=android.app.PendingIntent.getActivity(app,22000+Math.abs(c.t.symbol.hashCode()%7000),in,flags);
            String title=(risk?"⚠️ ERKEN RİSK • ":"🧠 ERKEN İLGİ • ")+c.t.symbol+" — "+c.talkScore+"/100";
            String body="Hız "+f2(c.velocity)+"x • "+c.sourceConfidence+"/100 kaynak • "+c.preMoveState+" • işlem sinyali değil, 15m teyit bekleniyor";
            android.app.Notification.Builder nb;
            if(android.os.Build.VERSION.SDK_INT>=26)nb=new android.app.Notification.Builder(app,ch);else nb=new android.app.Notification.Builder(app);
            nb.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body)
                    .setStyle(new android.app.Notification.BigTextStyle().bigText(body+"\n"+c.whyNow+"\n"+c.headline))
                    .setAutoCancel(true).setContentIntent(pi);
            if(android.os.Build.VERSION.SDK_INT<26)nb.setPriority(android.app.Notification.PRIORITY_DEFAULT);
            nm.notify(22000+Math.abs(c.t.symbol.hashCode()%7000),nb.build());
        }catch(Throwable ignored){}
    }'''
src = src[:a] + native + src[e:]
ATTN.write_text(src)

out=ATTN.read_text()
checks={
    'native marker':'V9542B_NATIVE_NOTIFICATION_NO_ANDROIDX' in out,
    'native builder':'android.app.Notification.Builder' in out,
    'no NotificationCompat':'androidx.core.app.NotificationCompat' not in out,
    'alert channel retained':'v9542_early_attention' in out,
    '15m safety text retained':'15m teyit bekleniyor' in out,
}
for name,ok in checks.items():print(('OK   ' if ok else 'FAIL '),name)
bad=[name for name,ok in checks.items() if not ok]
if bad:raise SystemExit('v9.5.42b sanity failed: '+', '.join(bad))
print('v9.5.42b OK: attention alerts use native Android Notification APIs; no AndroidX notification dependency required.')
