'use strict';
// R2544.190 (17.11 Office kopmaları): canonicalPositions her snapshot'ta 150 bin günlük satırını baştan okuyordu (~1,1 sn eşzamanlı),
// Office sekme başına yarım çekirdek yiyor, çekirdek istekleri UND_ERR_SOCKET/ECONNRESET ile düşüyordu.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r190-'));
fs.mkdirSync(path.join(root, 'data'));
const dbFile = path.join(root, 'data', 'brainhub.sqlite');
const w = new DatabaseSync(dbFile);
w.exec('CREATE TABLE journal (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, symbol TEXT, payload TEXT NOT NULL, outcome TEXT)');
const ins = w.prepare('INSERT INTO journal (id,ts,kind,symbol,payload) VALUES (?,?,?,?,?)');
const T0 = Date.now() - 3 * 24 * 3600e3;
let n = 0;
const close = (ts, sym, R, usd) => ins.run('c' + (++n), ts, 'POSITION_CLOSED', sym, JSON.stringify({ symbol: sym, side: 'LONG', rMultiple: R, netPnl: usd, closedAt: new Date(ts).toISOString(), tradingMode: 'LIVE' }));
for (let i = 0; i < 40; i++) close(T0 + i * 3600e3, 'AAAUSDT', i % 3 ? 1 : -1, i % 3 ? 5 : -5);
ins.run('x1', T0 + 5, 'SOMETHING_ELSE', 'ZZZUSDT', '{}');
process.env.BRAINHUB_ROOT = root;
const M = require('../office-dashboard/office-server.js');
const P = require('../office-performance.js');

function full(data) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const recs = db.prepare("SELECT id,ts,kind,symbol,payload FROM journal WHERE kind IN ('POSITION_CLOSED','R2542_OFFICE_EVENT','LIVE_EXECUTION','JEV_POSITION_EXECUTION','CLOSE_EXIT_EVIDENCE') ORDER BY ts ASC").all().map(x => ({ ...x, payload: JSON.parse(x.payload) }));
  db.close();
  return { closed: P.enrichCloses(data.closed || [], recs), perfN: P.performanceReport(recs, data.open || []) };
}
const cmp = o => JSON.stringify({ closed: o.closed, perf: o.performance ?? o.perfN }, (k, v) => (['generatedAt', 'asOf', 'now'].includes(k) ? undefined : v));

test('R2544.190 ilk okuma = eski tam okuma; aynı pozisyon verisi önbellekten (veritabanı yeniden okunmaz)', () => {
  const data = { open: [], closed: [] };
  const a = M.canonicalPositions(data);
  assert.equal(a.reportingOverlay, 'READ_ONLY_SQLITE_CANONICAL', a.reportingOverlayError);
  assert.equal(cmp(a), cmp(full(data)));
  assert.strictEqual(M.canonicalPositions(data), a, 'aynı veri nesnesi 15 sn içinde: aynı sonuç, yeniden hesap yok');
});

test('R2544.190 artımlı okuma yeni kapanışı kaçırmaz, tekrar saymaz; geç yazılan (eski zamanlı) satır 10 dk örtüşmeyle alınır', () => {
  const last = T0 + 39 * 3600e3;
  close(last + 60e3, 'BBBUSDT', 2, 20);          // yeni
  close(last - 5 * 60e3, 'CCCUSDT', -1, -7);     // 10 dk içinde geç yazılmış
  const data = { open: [], closed: [] };         // yeni pozisyon verisi -> yeniden hesap
  const b = M.canonicalPositions(data);
  assert.equal(cmp(b), cmp(full(data)), 'artımlı sonuç = tam okuma');
  const again = M.canonicalPositions({ open: [], closed: [] });
  assert.equal(cmp(again), cmp(full(data)), 'üçüncü okuma: aynı satırlar iki kez sayılmaz');
});

test('R2544.190 kaynak: sorgu zaman sınırlı, ham tam okuma kalmadı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'office-server.js'), 'utf8');
  assert.match(src, /WHERE ts>=\? AND kind IN \('POSITION_CLOSED'/);
  assert.match(src, /if\(canonOut\.src===data&&Date\.now\(\)-canonOut\.at<CANON_TTL_MS\)return canonOut\.val;/);
  assert.ok(!/WHERE kind IN \('POSITION_CLOSED','R2542_OFFICE_EVENT','LIVE_EXECUTION','JEV_POSITION_EXECUTION','CLOSE_EXIT_EVIDENCE'\) ORDER BY ts ASC"\)\.all\(\)/.test(src));
});

test('R2544.190 Office: kâr/zarar ve pozisyon masası sağ sütunda; OTO rozeti yalnız Normal sistemi anlatır', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
  const r = html.indexOf('id="ccRight"'), pl = html.indexOf('id="plCard"'), pos = html.indexOf('id="ccPos"'), now = html.indexOf('id="ccNow"');
  assert.ok(r > 0 && pl > r && pos > pl && now > pos, 'plCard ve ccPos sağ sütunun içinde, ccNow öncesinde');
  assert.match(html, /#ccRight \.pl-tiles\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(html, /#ccRight \.ps-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(html, /\(la\.enabled\?'Normal OTO AKTİF':'Normal OTO KAPALI'\)/);
});

test.after(() => { w.close(); });
