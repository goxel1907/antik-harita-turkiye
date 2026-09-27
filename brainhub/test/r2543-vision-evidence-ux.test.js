'use strict';
// CLAUDE_R2543_VISION_UX: grafik kanıtının JEV'e görünür olması + Office panelindeki 6 UX kusuru.
// Ağ yok, gerçek JEV/Ollama çağrısı yok: yalnız sözleşme ve arayüz metni doğrulanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOVEREIGN_EVIDENCE } = require('../jev-decision');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'jev-decision.js'), 'utf8');
const OFFICE = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');

test('chart evidence stays optional but is described truthfully to PASS-1', () => {
  const ids = SOVEREIGN_EVIDENCE.map(([id]) => id);
  // Yeni bir kanıt türü eklenmedi, hiçbiri kaldırılmadı: JEV'in seçenek kümesi aynı.
  assert.deepEqual(ids, [
    'TRADINGVIEW_5M', 'TRADINGVIEW_15M', 'TIMING_1M', 'TIMING_3M', 'ORDER_FLOW_CVD',
    'DEPTH_L2', 'DERIVATIVES', 'OBSERVED_LIQUIDATIONS', 'HIGHER_TF_CONTEXT', 'HISTORY_OUTCOME'
  ]);
  for (const id of ['TRADINGVIEW_5M', 'TRADINGVIEW_15M']) {
    const [, desc] = SOVEREIGN_EVIDENCE.find(([x]) => x === id);
    assert.match(desc, /zero cost/i, id + ' bedelsiz olduğunu söylemeli');
    assert.match(desc, /locally on GPU/i, id + ' yerel GPU olduğunu söylemeli');
    assert.match(desc, /same closed candles as the numeric packet/i, id + ' aynı kapanmış mumlardan çizildiğini söylemeli');
    assert.match(desc, /never an override of numeric truth/i, id + ' sayısal gerçeği ezmediğini söylemeli');
  }
});

test('PASS-1 brief tells JEV chart evidence is free and never penalised', () => {
  assert.match(SRC, /Visual chart evidence \(TRADINGVIEW_5M \/ TRADINGVIEW_15M\) is drawn locally on GPU at zero cost/);
  assert.match(SRC, /requesting it is optional and is never penalised/);
  // Zorunluluk/kapı eklenmedi.
  assert.doesNotMatch(SRC, /must request TRADINGVIEW/i);
  assert.doesNotMatch(SRC, /always request the chart/i);
});

test('PASS-2 keeps numeric truth above visual interpretation', () => {
  assert.match(SRC, /Numeric Binance\/BrainHub truth outranks visual interpretation\./);
});

test('office panel: wait-reason flag is separated from the reason text', () => {
  assert.match(OFFICE, /⚠ KOŞUL YOK<\/span> • '/);
  assert.doesNotMatch(OFFICE, /⚠ KOŞUL YOK<\/span>':''\}\$\{esc/);
});

test('office panel: closed-trade list shows the day, not only the clock', () => {
  assert.match(OFFICE, /const fmtDayTime = ts =>/);
  assert.match(OFFICE, /c\.closedAt\?fmtDayTime\(Date\.parse\(c\.closedAt\)\):fmtDayTime\(Date\.parse\(c\.ts\)\)/);
  assert.match(OFFICE, /<th>Kapanış \(gg\.aa • ss:dd\)<\/th>/);
});

test('office panel: gate label fits and Ollama readiness is not a false alarm', () => {
  assert.match(OFFICE, /setGate\('gIntent', intent>0, `Güvenlik geçti \$\{intent\}`\);/);
  assert.doesNotMatch(OFFICE, /`Zorunlu güvenlik geçti \$\{intent\}`/);
  assert.match(OFFICE, /hazır • model bellekte değil \(ilk istekte yüklenir\)/);
  assert.doesNotMatch(OFFICE, /s\.ollama\?\.ok\?'model yüklü değil'/);
});

test('office panel: other-close label and vision badge are explicit', () => {
  assert.match(OFFICE, /OTHER_CLOSE:'Diğer kapanış — neden doğrulanmadı \(manuel\/borsa olabilir\)'/);
  assert.match(OFFICE, /id="chipVision"/);
  assert.match(OFFICE, /chip\('#chipVision'/);
  assert.match(OFFICE, /'GÖRSEL '\+\(vOllama\?trUi\(vStage\):'OLLAMA YOK'\)/);
  // Kullanıcı manuel kapanış karşılığı hâlâ mevcut ve yeniden sınıflandırma yapılmadı.
  assert.match(OFFICE, /USER_MANUAL:'Kullanıcı manuel kapattı'/);
});

test('office panel shows the deterministic chart reading that JEV receives', () => {
  assert.match(OFFICE, /id="mirrorNarrative"/);
  assert.match(OFFICE, /const narr=p\?\.chartNarrative\|\|null;/);
  assert.match(OFFICE, /GRAFİK OKUMA BEYNİ — JEV'e her turda giden metin/);
  assert.match(OFFICE, /motor henüz R2543 chart-narrator sürümünü yüklemedi/);
});
