'use strict';
// R2544.193 (kullanıcı 17.11): olay akışı "Gölge tahmin sonuçlandı" satırlarıyla dolu ve ne olduğunu söylemiyordu; RUN_CONTROL ham kod.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const M = require('../office-dashboard/office-server.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
const ev = (kind, payload, symbol = null) => M.summarizeJournal([{ ts: 1, kind, symbol, payload }]).events[0];
test('R2544.193 sunucu: tanımsız olay türleri gerçek alanlardan Türkçe ayrıntı taşır', () => {
  const k = ev('KESIF_OUTCOME', { model: 'PUSU:IZ:DUVAR', side: 'LONG', outcome: 'TARGET', R: 1.958 }, 'CYPHUSDT');
  assert.equal(k.detail, 'PUSU:IZ:DUVAR LONG → hedef +1.96R'); assert.equal(k.outcome, 'TARGET'); assert.equal(k.R, 1.958);
  assert.equal(ev('RUN_CONTROL', { action: 'GO_LIVE', available: 81.14733129 }).detail, 'CANLI’ya geç komutu • kullanılabilir 81.15 $');
  assert.equal(ev('LIVE_LANES', { normal: false, top3: true, zirve5: true }).detail, 'Seçim: Normal kapalı, İlk 3 açık, ZİRVE-5 açık (KEŞİF ayrı anahtarla)', 'KEŞİF kayıtta yoksa kapalı sanılmaz');
  assert.equal(ev('TOP3_JEV_REVIEW', { ok: true, called: true, decision: 'REJECT_ENTRY', reason: 'LATE_OR_CROWDED' }).detail, 'JEV GİRME • LATE_OR_CROWDED');
  assert.equal(ev('TOP3_JEV_REVIEW', { ok: false, decision: 'REJECT_ENTRY', reason: 'OPENROUTER_402' }).detail, 'JEV cevapsız (OPENROUTER_402)', 'cevapsızlık ret gibi yazılmaz');
  assert.match(ev('ZIRVE5_BLOCKED', { side: 'SHORT', reason: 'TOP3_ACCOUNT_UNAVAILABLE', result: { reasonDetail: 'BALANCE_ZERO' } }).detail, /açılmadı: TOP3_ACCOUNT_UNAVAILABLE \(BALANCE_ZERO\)/);
  assert.equal(ev('ZIRVE5_SCAN', { top: [{ zones: 2, signals: [] }, { zones: 1, signals: [{}] }] }).detail, '2 coin, 3 bölge, 1 sinyal');
  assert.equal(ev('UNKNOWN_KIND_X', { a: 1 }).detail, '', 'bilinmeyen tür boş kalır (uydurma yok)');
});
test('R2544.193 ekran: art arda gölge sonuçları tek satırda (hedef/stop sayısı + toplam R); ham kodlar Türkçe', () => {
  assert.match(html, /if\(kind==='KESIF_OUTCOME'\)\{const R=Number\(e\.R\),o=String\(e\.outcome\|\|''\);/);
  assert.match(html, /Gölge tahminler sonuçlandı \(para yok\): \$\{r\.n\} — \$\{parts\.join\(' \/ '\)\}, toplam/);
  for (const k of ['RUN_CONTROL', 'TOP3_SIGNAL', 'TOP3_JEV_REVIEW', 'ZIRVE5_JEV_REVIEW', 'TOP3_BLOCKED', 'ZIRVE5_BLOCKED', 'KESIF_SOZ_ENTRY'])
    assert.ok(/:\['[gsy]','/.test(html.slice(html.indexOf(k + ":['"), html.indexOf(k + ":['") + k.length + 8)) && html.includes(k + ":['"), k + ' Türkçe karşılık');
});
test('R2544.193 ekran toplama davranışı (gerçek renderFeed, yalıtılmış)', () => {
  const vm = require('vm');
  const a = html.indexOf('const EV188='), b = html.indexOf('function renderFeedOld');
  const box = { document: { getElementById: () => box.el }, el: { innerHTML: '' }, fmtTime: t => String(t), esc: x => String(x), trUi: x => x };
  vm.createContext(box); vm.runInContext(html.slice(a, b) + ';this.r=renderFeed;', box);
  const E = (ts, sym, o, R) => ({ ts, title: 'KESIF_OUTCOME ' + sym, detail: 'm LONG → x', outcome: o, R });
  box.r({ events: [E(5000, 'AUSDT', 'TARGET', 2), E(4000, 'BUSDT', 'STOP', -1), E(3000, 'CUSDT', 'STOP', -1), { ts: 2000, title: 'RUN_CONTROL ', detail: 'CANLI’ya geç komutu' }] });
  assert.match(box.el.innerHTML, /Gölge tahminler sonuçlandı \(para yok\): 3 — 1 hedef \/ 2 stop, toplam \+0\.00R/);
  assert.match(box.el.innerHTML, /A, B, C/); assert.match(box.el.innerHTML, /CANLI\/TEST komutu/); assert.ok(!/>RUN_CONTROL</.test(box.el.innerHTML));
});
