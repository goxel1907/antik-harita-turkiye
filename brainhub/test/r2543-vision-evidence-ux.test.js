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

test('chart evidence stays optional and mainline is deterministic without GPU/VLM', () => {
  const ids = SOVEREIGN_EVIDENCE.map(([id]) => id);
  assert.deepEqual(ids, [
    'TRADINGVIEW_5M', 'TRADINGVIEW_15M', 'TIMING_1M', 'TIMING_3M', 'ORDER_FLOW_CVD',
    'DEPTH_L2', 'DERIVATIVES', 'OBSERVED_LIQUIDATIONS', 'HIGHER_TF_CONTEXT', 'HISTORY_OUTCOME'
  ]);
  for (const id of ['TRADINGVIEW_5M', 'TRADINGVIEW_15M']) {
    const [, desc] = SOVEREIGN_EVIDENCE.find(([x]) => x === id);
    assert.match(desc, /deterministic/i, id + ' deterministik ana hattı söylemeli');
    assert.match(desc, /same closed-candle numeric truth/i, id + ' aynı kapanmış mum sayısal gerçeğine dayanmalı');
    assert.match(desc, /does not require GPU/i, id + ' ana hatta GPU/VLM gerektirmemeli');
    assert.match(desc, /can never override numeric truth/i, id + ' görsel audit sayısal gerçeği ezmemeli');
  }
});

test('PASS-1 brief tells JEV chart evidence is deterministic mainline and Vision is audit-on-demand', () => {
  assert.match(SRC, /fulfilled in the mainline by deterministic closed-candle chartNarrative/);
  assert.match(SRC, /without GPU/);
  assert.match(SRC, /audit-on-demand only/);
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

test('office panel: approve -> intent -> safety is explicit and Ollama readiness is not a false alarm', () => {
  assert.ok(OFFICE.includes("setGate('gJev', approved>0, `JEV MARKET_NOW onayı ${approved}`);"));
  assert.ok(OFFICE.includes("setGate('gIntent', intentBuilt>0, `Niyet ${intentBuilt} • güvenlik ${safety}`);"));
  assert.match(OFFICE, /hazır • model bellekte değil \(ilk istekte yüklenir\)/);
  assert.doesNotMatch(OFFICE, /s\.ollama\?\.ok\?'model yüklü değil'/);
});

test('office panel: other-close label and vision badge are explicit', () => {
  assert.match(OFFICE, /OTHER_CLOSE:'Diğer kapanış — neden doğrulanmadı \(manuel\/borsa olabilir\)'/);
  assert.match(OFFICE, /id="chipVision"/);
  assert.match(OFFICE, /chip\('#chipVision'/);
  assert.ok(OFFICE.includes("'GRAFİK DETERMINİSTİK • GPU '+(vOllama?'AUDIT HAZIR':'AUDIT KAPALI')"));
  // Kullanıcı manuel kapanış karşılığı hâlâ mevcut ve yeniden sınıflandırma yapılmadı.
  assert.match(OFFICE, /USER_MANUAL:'Kullanıcı manuel kapattı'/);
});

test('office panel shows the deterministic chart reading that JEV receives', () => {
  assert.match(OFFICE, /id="mirrorNarrative"/);
  assert.match(OFFICE, /const narr=p\?\.chartNarrative\|\|null;/);
  assert.match(OFFICE, /GRAFİK OKUMA — GÜNCEL SAYISAL BAĞLAM/);
  assert.match(OFFICE, /Son JEV kararının gönderilmiş paketi ve zamanı aşağıda ayrıdır/);
  assert.match(OFFICE, /motor henüz R2543 chart-narrator sürümünü yüklemedi/);
});
