'use strict';
// R2544.192 (17.11 "işlem açılmıyor" teşhisi): yalnız doğruluk/izlenebilirlik - giriş kuralı, JEV reddi, hesap kontrolü, risk sınırı DEĞİŞMEZ.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const jd = fs.readFileSync(path.join(__dirname, '..', 'jev-decision.js'), 'utf8');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
test('R2544.192 JEV\'e "giriş zaten yapılacak" denmez: R2544.189 sonrası JEV\'in girme kararı uygulanır (İlk 3 + ZİRVE-5 kaldıraç soruları)', () => {
  assert.ok(!jd.includes('the entry is taken anyway'), 'yanlış cümle kalmadı');
  const n = (jd.match(/choose the leverage that will be used IF the entry happens \(your REJECT_ENTRY stops it\)/g) || []).length;
  assert.equal(n, 3, 'İlk 3 (v1, v2) ve ZİRVE-5 kaldıraç soruları doğru cümleyi taşır');
});
test('R2544.192 hesap reddi kaydı nedenini taşır; karar (giriş yok) aynı', () => {
  assert.match(lc, /reasonDetail:acct\?\.ok\?'BALANCE_ZERO':'ACCOUNT_READ_FAILED'/);
  assert.match(lc, /if\(!acct\?\.ok\|\|!\(avail>0\)\)return \{ok:false,reason:'TOP3_ACCOUNT_UNAVAILABLE'/, 'eşik ve karar değişmedi');
});
