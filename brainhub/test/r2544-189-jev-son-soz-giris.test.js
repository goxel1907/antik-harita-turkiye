'use strict';
// R2544.189 (kullanıcı 17.11, 1000LUNC LONG -0,99R): JEV açıkken girişte de son söz JEV'in; JEV + KURUL dahil.
// JEV cevap verip "girme" derse işlem açılmaz. JEV cevap veremezse (kredi bitti / zaman aşımı / hata) kural açar (sabit kural 3: gecikme yok).
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');

test('R2544.189 jevSaysNo yalnız JEV\'in gerçek cevabını "hayır" sayar', () => {
  const m = lc.match(/function jevSaysNo\(j\)\{([^}]*)\}/);
  assert.ok(m, 'jevSaysNo tanımlı');
  const jevSaysNo = new Function('j', m[1]);
  assert.equal(jevSaysNo({ ok: true, called: true, decision: 'REJECT_ENTRY', reason: 'LATE_OR_CROWDED' }), true);
  assert.equal(jevSaysNo({ ok: true, called: true, decision: 'APPROVE_ENTRY' }), false);
  assert.equal(jevSaysNo({ ok: false, called: true, decision: 'REJECT_ENTRY', reason: 'OPENROUTER_402' }), false, 'kredisiz JEV hayır değildir');
  assert.equal(jevSaysNo({ ok: false, called: false, decision: 'REJECT_ENTRY', reason: 'timeout' }), false, 'cevapsız JEV hayır değildir');
  assert.equal(jevSaysNo(null), false);
});

test('R2544.189 İlk 3 ve ZİRVE-5: JEV + KURUL modunda JEV reddi girişi durdurur', () => {
  assert.match(lc, /res\.jev=ev;ef\.jevVote=ev;if\(!\(jev\?\.ok===true&&jev\.decision==='APPROVE_ENTRY'\)&&\(!jevKurul\(cfg\)\|\|jevSaysNo\(jev\)\)\)\{res\.reason='TOP3_JEV_NOT_APPROVED';continue;\}/);
  assert.match(lc, /ef\.jevVote=ev;if\(!\(jev\?\.ok===true&&jev\.decision==='APPROVE_ENTRY'\)&&\(!jevKurul\(cfg\)\|\|jevSaysNo\(jev\)\)\)\{z5Note\(z,\{symbol:sym,side,opened:false,reason:'ZIRVE5_JEV_NOT_APPROVED'/);
  assert.ok(!/&&!jevKurul\(cfg\)\)\{/.test(lc), 'eski "JEV + KURUL\'da JEV yalnız oy" dalı kalmadı');
});
