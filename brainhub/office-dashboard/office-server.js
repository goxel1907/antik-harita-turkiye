'use strict';
// BrainHub Trade Office - salt-okunur (read-only) izleme sunucusu.
// Brain Hub'a yalnız GET istekleri atar, hiçbir ayarı/emri değiştirmez.
// Token tarayıcıya gönderilmez; yalnız bu süreçte bellekte tutulur.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OFFICE_VERSION = '1.1.0-CLAUDE-V109';
const HERE = __dirname;
const BRAIN_ROOT = process.env.BRAINHUB_ROOT || 'C:\\BrainHub';
const BACKUP_ROOT = process.env.BRAINHUB_BACKUP_ROOT || 'C:\\BrainHubBackups';
const BRAIN_URL = (process.env.BRAINHUB_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const ROUTER_URL = (process.env.ROUTER_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
const HOST = process.env.OFFICE_HOST || '127.0.0.1';
const PORT = Number(process.env.OFFICE_PORT || 8790);
const TOKEN = String(process.env.BRAINHUB_CLIENT_TOKEN || '').trim();
const OFFICE_KEY = String(process.env.OFFICE_KEY || '').trim();
const DEMO = process.env.OFFICE_DEMO === '1';
const ACCOUNT_ENABLED = process.env.OFFICE_ACCOUNT !== '0';
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'].includes(HOST);

if (!LOOPBACK && OFFICE_KEY.length < 24) {
  console.error('OFFICE_HOST loopback değilse en az 24 karakterlik OFFICE_KEY zorunludur.');
  process.exit(2);
}

// Brain Hub tarafında yalnız bu GET yollarına izin var.
const ALLOWED_BRAIN_PATHS = new Set([
  '/health', '/live/status', '/vision/progress', '/jev/budget', '/models/healthy', '/live/account', '/journal'
]);

const cache = new Map();
const SECRETISH = /(api[-_]?key|secret|token|password|authorization|signature|privatekey|listenkey)/i;

function nowIso() { return new Date().toISOString(); }
function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function clip(v, n = 240) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n); }

function scrub(value, depth = 0) {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.slice(0, 400).map(x => scrub(x, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRETISH.test(k)) continue;
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    // Olası anahtar biçimlerini maskele (sk-or-v1-..., uzun hex/base64 dizileri)
    return value.replace(/sk-or-v1-[A-Za-z0-9]+/g, 'sk-or-v1-***').replace(/\b[A-Za-z0-9_-]{48,}\b/g, '***');
  }
  return value;
}

async function getJson(url, { timeoutMs = 8000, headers = {} } = {}) {
  const started = Date.now();
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: clip(text, 300) }; }
    return { ok: r.ok, status: r.status, data, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, error: clip(e?.cause?.code || e?.message || e, 160), ms: Date.now() - started };
  }
}

function brainGet(p, query = '') {
  if (!ALLOWED_BRAIN_PATHS.has(p)) throw new Error('BRAIN_PATH_NOT_ALLOWED');
  const headers = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  return getJson(BRAIN_URL + p + (query ? '?' + query : ''), { headers, timeoutMs: p === '/live/account' ? 15000 : 9000 });
}

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  const t = Date.now();
  if (hit && t - hit.at < ttlMs) return hit.value;
  if (hit && hit.pending) return hit.value;
  const entry = hit || { at: 0, value: null };
  entry.pending = true;
  cache.set(key, entry);
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value, pending: false });
    return value;
  } catch (e) {
    entry.pending = false;
    return entry.value;
  }
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function tailFile(file, maxBytes = 96 * 1024) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return { ok: true, size: st.size, mtime: st.mtime.toISOString(), lines: buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-260) };
  } catch (e) {
    return { ok: false, error: clip(e?.code || e?.message, 80), lines: [] };
  }
}

function listBackups() {
  try {
    const rows = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const full = path.join(BACKUP_ROOT, d.name);
        let mtime = null;
        try { mtime = fs.statSync(full).mtime.toISOString(); } catch {}
        return { name: d.name, mtime };
      })
      .sort((a, b) => String(b.name).localeCompare(String(a.name)));
    return { ok: true, root: BACKUP_ROOT, count: rows.length, latest: rows.slice(0, 8) };
  } catch (e) {
    return { ok: false, root: BACKUP_ROOT, error: clip(e?.code || e?.message, 80), count: 0, latest: [] };
  }
}

// Log satırlarını olaylara çevir (brainpub.log). Hassas veri içermez; yine de kısaltılır.
const LOG_RULES = [
  [/COMMITTEE LOCAL_DIRECT OK/, 'vision', 'Yerel görsel analiz tamamlandı'],
  [/VISION FREE QUOTA FAILOVER OK/, 'vision', 'Kiro free-quota görsel kurtarma başarılı'],
  [/VISION FREE QUOTA FAILOVER FAIL/, 'vision', 'Kiro free-quota görsel kurtarma başarısız'],
  [/PLAN WORKER ERROR/, 'workers', 'Plan worker hatası'],
  [/PLAN WORKER symbol=/, 'workers', 'Plan worker kararı'],
  [/LEADER AUTO ORDER/, 'exec', 'CANLI EMİR GÖNDERİLDİ'],
  [/LEADER AUTO BLOCK/, 'exec', 'OTO yürütme engellendi'],
  [/POSITION REVIEW/, 'positions', 'Açık pozisyon değerlendirmesi'],
  [/COMMITTEE OK/, 'workers', 'Ücretsiz komite yanıt verdi'],
  [/ASK FAIL|no healthy model|HTTP 4\d\d|HTTP 5\d\d/, 'workers', 'Model/rota hatası'],
  [/listening on/, 'brain', 'Brain Hub başlatıldı']
];
function parseLog(lines) {
  const out = [];
  for (const line of lines) {
    const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2];
    const rule = LOG_RULES.find(([re]) => re.test(text));
    if (!rule) continue;
    out.push({ ts: Date.parse(m[1]), source: 'log', desk: rule[1], title: rule[2], detail: clip(scrub(text), 220) });
  }
  return out.slice(-80);
}

function waitIsFake(wait) {
  // brainhub/wait-condition.js ile aynı kural (v9.5.109).
  const z = String(wait || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR');
  if (!z) return true;
  if (/^(?:NONE|YOK|N\/A|-|—)(?:\b|\s|[—\-–(:;,.]|$)/u.test(z)) return true;
  return /SOMUT BEKLEME KOŞULU ÜRETMEDİ|SONRAKİ TAZE VERİDE YENİDEN DEĞERLENDİR|YENİDEN İNCELEME GEREKLİ/u.test(z);
}

// Journal kayıtlarını kısa olaylara dönüştür (ağır payload tarayıcıya gitmez).
function summarizeJournal(items) {
  const events = [];
  const plans = [];
  let lastJev = null;
  let lastRisk = null;
  for (const it of Array.isArray(items) ? items : []) {
    const p = it.payload || {};
    const base = { ts: Number(it.ts) || null, kind: it.kind, symbol: it.symbol || null, source: 'journal' };
    if (it.kind === 'PLAN') {
      const plan = p.plan || {};
      const jd = plan.jevDecision || null;
      const row = {
        ...base,
        desk: 'brain',
        status: String(plan.status || ''),
        previousStatus: plan.previousStatus || null,
        side: plan.side || null,
        originTF: plan.originTF || null,
        ownerTF: plan.ownerTF || null,
        confidence: finite(plan.confidence),
        waitFor: clip(plan.waitFor, 200),
        fakeWait: String(plan.status || '').toUpperCase() === 'WATCH' && waitIsFake(plan.waitFor),
        reason: plan.reason || null,
        supportTFs: plan.supportTFs || [],
        vetoTFs: plan.vetoTFs || [],
        visionAttached: finite(p.vision?.attached),
        trigger: plan.triggerSpec ? { valid: plan.triggerSpec.valid === true, tf: plan.triggerSpec.tf || null, id: plan.triggerSpec.triggerLevelId || null, price: finite(plan.triggerSpec.triggerPrice), autoSelected: plan.triggerSpec.autoSelected === true } : null,
        claudeDt: plan.claudeDeterministicTrigger ? { wouldQualify: plan.claudeDeterministicTrigger.wouldQualify === true, applied: plan.claudeDeterministicTrigger.applied === true, tf: plan.claudeDeterministicTrigger.tf || null } : null,
        riskReasons: (p.riskGate?.reasons || []).slice(0, 8),
        jev: jd ? { called: jd.called === true, veto: jd.veto === true, reasons: (jd.vetoReasons || []).slice(0, 8), reason: jd.reason || null, probabilities: jd.probabilities || null, timeframeConflicts: jd.timeframeConflicts || null, costUsd: finite(jd.costUsd), roleWeightedVeto: jd.claudeRoleWeighted ? jd.claudeRoleWeighted.veto === true : null } : null
      };
      plans.push(row);
      if (row.jev && row.jev.called && !lastJev) lastJev = { ...row.jev, symbol: row.symbol, ts: row.ts, side: row.side };
      if (!lastRisk && row.riskReasons.length) lastRisk = { symbol: row.symbol, ts: row.ts, reasons: row.riskReasons };
      events.push({ ...base, desk: 'brain', title: `${row.symbol || '?'} ${row.side || ''} → ${row.status || '?'}`, detail: row.fakeWait ? 'Bekleme koşulu sahte (NONE...)' : clip(row.waitFor || row.reason || '', 160) });
    } else if (it.kind === 'JEV_SHADOW') {
      const dsn = p.decision || {};
      if (dsn.called && !lastJev) lastJev = { called: true, veto: dsn.veto === true, reasons: (dsn.vetoReasons || []).slice(0, 8), probabilities: dsn.probabilities || null, timeframeConflicts: dsn.timeframeConflicts || null, symbol: it.symbol, ts: base.ts, side: p.side || null, shadow: true, roleWeightedVeto: dsn.claudeRoleWeighted ? dsn.claudeRoleWeighted.veto === true : null };
      events.push({ ...base, desk: 'jev', title: `Jev gölge (WATCH) ${it.symbol || ''}: ${dsn.veto ? 'veto ederdi' : 'geçirirdi'}${dsn.claudeRoleWeighted ? ' • RW ' + (dsn.claudeRoleWeighted.veto ? 'veto' : 'geçer') : ''}`, detail: clip((dsn.vetoReasons || []).join(', '), 160) });
    } else if (it.kind === 'SHADOW_TRIGGER') {
      events.push({ ...base, desk: 'workers', title: `Gölge tetik ${it.symbol || ''} ${p.side || ''} • ${p.triggerTF || ''} ${p.triggerLevelId || ''}`, detail: `giriş ${finite(p.entryPrice) ?? '?'} • seviye ${finite(p.triggerPrice) ?? '?'}` });
    } else if (it.kind === 'SHADOW_OUTCOME_15M' || it.kind === 'SHADOW_OUTCOME_60M') {
      events.push({ ...base, desk: 'learning', title: `Gölge sonuç ${it.kind.endsWith('15M') ? '15 dk' : '60 dk'} ${it.symbol || ''}: ${finite(p.outcomePct) ?? '?'}%`, detail: `${p.side || ''} ${p.triggerTF || ''} ${p.triggerLevelId || ''}` });
    } else if (it.kind === 'CLAUDE_V109_DT') {
      events.push({ ...base, desk: 'brain', title: `Kod-tetik ${it.symbol || ''} ${p.side || ''}: ${p.applied ? 'QUALIFIED yaptı' : 'QUALIFIED olurdu (gölge)'}`, detail: `${p.tf || ''} kapanış kırılımı • seviye ${finite(p.level) ?? '?'}` });
    } else if (it.kind === 'PLAN_WORKER_REVIEW') {
      events.push({ ...base, desk: 'workers', title: `Worker ${p.symbol || it.symbol || ''}: ${p.state || '?'}`, detail: clip(p.reason || '', 160), state: p.state || null, workerSource: p.source || null });
    } else if (it.kind === 'PLAN_COMMITTEE_FALLBACK') {
      events.push({ ...base, desk: 'vision', title: `${it.symbol || ''} görsel komite yanıt vermedi`, detail: clip(p.detail || p.reason || '', 160) });
    } else if (it.kind === 'PLAN_REJECT') {
      events.push({ ...base, desk: 'brain', title: `${it.symbol || ''} plan reddedildi`, detail: clip(p.reason || '', 160) });
    } else if (it.kind === 'LEADER_LIFECYCLE') {
      events.push({ ...base, desk: 'brain', title: `${it.symbol || ''} takip: ${p.previousState || '—'} → ${p.state || '?'}`, detail: clip(p.detail || '', 140) });
    } else if (it.kind === 'LEADER_AUTO_ATTEMPT' || it.kind === 'LIVE_EXECUTION') {
      const r = p.result || {};
      events.push({ ...base, desk: 'exec', title: `${it.symbol || ''} yürütme: ${r.orderPlaced ? 'EMİR GÖNDERİLDİ' : (r.execution || 'emir yok')}`, detail: clip((r.reasons || []).join(', '), 160), orderPlaced: r.orderPlaced === true });
    } else if (it.kind === 'POSITION_REVIEW') {
      events.push({ ...base, desk: 'positions', title: `${it.symbol || ''} pozisyon: ${p.actionTr || p.action || ''}`, detail: clip(p.reasonTr || '', 160) });
    } else if (it.kind === 'POSITION_CLOSED') {
      events.push({ ...base, desk: 'positions', title: `${it.symbol || ''} pozisyon kapandı`, detail: `PnL ${finite(p.realizedPnl) ?? '?'} USDT` });
    } else {
      events.push({ ...base, desk: 'brain', title: `${it.kind} ${it.symbol || ''}`, detail: '' });
    }
  }
  return { events, plans, lastJev, lastRisk };
}

function derive(snap) {
  const st = snap.status?.data || {};
  const la = st.leaderAuto || {};
  const h = la.health || {};
  const rows = la.analysisLifecycle?.rows || [];
  const deep = Number(h.deepAnalyses || 0);
  const unique = Number(h.uniqueAnalyzedSymbols || 0);
  const wr = Number(h.workerReviews || 0);
  const wref = Number(h.workerRefreshes || 0);
  const vu = Number(h.visionUnavailable || 0);
  const blockers = [];
  const add = (level, code, title, detail) => blockers.push({ level, code, title, detail });

  if (!snap.status?.ok) add('critical', 'BRAIN_UNREACHABLE', 'Brain Hub yanıt vermiyor', snap.status?.error || ('HTTP ' + (snap.status?.status || 0)));
  if (st && snap.status?.ok) {
    if (la.enabled !== true) add('critical', 'AUTO_DISABLED', 'OTO işlem kapalı', 'Leader AUTO etkin değil; hiçbir aday yürütmeye gitmez.');
    if (st.armed !== true) add('critical', 'LIVE_DISARMED', 'LIVE kapalı (analiz modu)', 'Plan QUALIFIED olsa bile emir gönderilmez. PC yeniden başlarsa LIVE otomatik kapanır.');
    const fv = String(snap.health?.data?.featureVersion || st.featureVersion || '');
    const v109 = /9\.5\.109-CLAUDE/.test(fv);
    const cv = h.claudeV109 || {};
    if (!v109) add('warning', 'VERSION_OLD', `PC sürümü ${fv || '?'}`, "v9.5.109-CLAUDE yüklenmemiş: sahte WAIT, worker döngüsü ve boş tetik adayı düzeltmeleri PC'de yok.");
    if (deep >= 3 && Number(h.preJevQualified || 0) === 0) add('serious', 'NO_QUALIFIED', 'Görsel analiz hiç işlem adayı üretmedi', v109
      ? `${deep} derin analizde 0 QUALIFIED. Kod-tetik ${cv.dtWouldQualify ?? 0} planda "QUALIFIED olurdu" dedi (gölge).`
      : `${deep} derin analizde 0 QUALIFIED. Prompt her TF için WAIT/FORMING yazdırdığı için model WATCH'ta kalıyor.`);
    if (v109) {
      const hrs = finite(h.shadowEvidenceHours) ?? 0;
      add(h.shadowReady24h ? 'ok' : 'info', 'SHADOW', h.shadowReady24h ? 'Gölge kanıt 24 saati doldu' : `Gölge ölçüm sürüyor (${hrs.toFixed(1)}/24 sa)`,
        `Sayısal tetikli plan ${h.shadowPlans ?? 0} • gölge tetik ${h.shadowTriggers ?? 0} • 15 dk ort ${finite(h.shadowAvg15mPct) ?? '—'}% • 60 dk ort ${finite(h.shadowAvg60mPct) ?? '—'}%`);
      if (Number(cv.chaseBlocked || 0) > 0) add('warning', 'CHASE', 'Kovalama kapısı giriş engelledi', `${cv.chaseBlocked} kez fiyat tetikten ATR sınırından fazla uzaklaştı veya içeri döndü.`);
    }
    if (wr >= 10 && wref / Math.max(1, wr) >= 0.8) add('serious', 'WORKER_LOOP', 'Plan worker döngüsü', `${wr} incelemenin ${wref}'i "9TF yenile" (%${Math.round(100 * wref / wr)}). Aynı coinler tekrar tekrar analiz ediliyor.`);
    if (deep >= 6 && unique / Math.max(1, deep) < 0.5) add('warning', 'COVERAGE', 'Kapsam daralması', `${deep} derin analiz yalnız ${unique} farklı coinde.`);
    if (deep >= 3 && vu / Math.max(1, deep) >= 0.25) add('serious', 'VISION_DOWN', 'Görsel analiz sık düşüyor', `${vu}/${deep} analizde görsel komite yanıt vermedi.`);
    const fake = rows.filter(r => (String(r.state || '').toUpperCase() === 'WATCH' || String(r.planStatus || '').toUpperCase() === 'WATCH') && r.waitFor !== undefined && waitIsFake(r.waitFor));
    if (fake.length) add('warning', 'FAKE_WAIT', 'Sahte bekleme koşulu', `${fake.length} takipte bekleme metni "NONE ..." ile başlıyor; somut tetik yok.`);
    if (Number(h.qualified || 0) > 0 && Number(h.intentReady || 0) === 0) add('warning', 'NO_INTENT', 'QUALIFIED var, emir niyeti yok', 'Risk/intent kapısı (fiyat sapması, stop, maliyet) engelliyor olabilir.');
    if (Number(h.intentReady || 0) > 0 && Number(h.ordersPlaced || 0) === 0) add('warning', 'NO_ORDER', 'Niyet hazır, emir yok', 'Yürütme kapısı (LIVE, bakiye, fiyat sapması, grant) engelliyor.');
    if (Number(h.jevCalled || 0) >= 3 && Number(h.jevVetoed || 0) / Math.max(1, Number(h.jevCalled)) >= 0.7) add('warning', 'JEV_VETO', 'Jev çoğu planı veto ediyor', `${h.jevVetoed}/${h.jevCalled} veto.`);
    if (finite(h.avgAnalysisMs) !== null && h.avgAnalysisMs > 240000) add('warning', 'SLOW', 'Derin analiz yavaş', `Ortalama ${(h.avgAnalysisMs / 1000).toFixed(0)} sn; 1m/3m/5m kurulumları için geç.`);
    if (Number(h.skippedBusy || 0) > 60) add('info', 'BUSY', 'Turların çoğu atlanıyor', `${h.skippedBusy} tur yoğunluk nedeniyle atlandı (tek GPU, tek analiz).`);
  }
  const funnel = [
    { key: 'universe', label: 'Binance evreni', value: finite(h.latestLightweightUniverseCount) ?? finite(h.latestUniverseCount) },
    { key: 'target', label: 'Hedef evren', value: finite(la.diagnostics?.universeCount) },
    { key: 'shortlist', label: 'Derin kısa liste', value: finite(h.latestShortlistCount) },
    { key: 'eligible', label: 'Ön filtre uygun', value: finite(h.latestEligibleCount) },
    { key: 'deep', label: 'Derin 9TF analiz', value: deep },
    { key: 'preJev', label: 'QUALIFIED (Jev öncesi)', value: finite(h.preJevQualified) ?? 0 },
    { key: 'jev', label: 'Jev çağrısı', value: finite(h.jevCalled) ?? 0 },
    { key: 'qualified', label: 'Jev sonrası aday', value: finite(h.qualified) ?? 0 },
    { key: 'intent', label: 'Canlı niyet', value: finite(h.intentReady) ?? 0 },
    { key: 'orders', label: 'Açılan emir', value: finite(h.ordersPlaced) ?? 0 }
  ];
  const vp = snap.visionProgress?.data || st.visionProgress || {};
  const stage = String(vp.stage || 'IDLE');
  const desks = {
    scanner: { busy: Number(h.scanRuns || 0) > 0, text: `Evren ${funnel[0].value ?? '?'} → hedef ${funnel[1].value ?? '?'} → uygun ${funnel[3].value ?? '?'}` },
    vision: { busy: !/^(IDLE|DETAIL_RUN_COMPLETE|PIXEL_RUN_COMPLETE|DETAIL_RUN_ERROR|PIXEL_RUN_ERROR)$/.test(stage), stage, text: stage },
    workers: { busy: la.planWorkers?.busy === true, text: `inceleme ${wr} • bekle ${h.workerWaits ?? 0} • tetik ${h.workerTriggers ?? 0} • yenile ${wref}` },
    jev: { busy: false, text: `bugün ${st.jev?.budget?.calls ?? 0} çağrı • $${Number(st.jev?.budget?.spentUsd || 0).toFixed(4)}` },
    exec: { busy: la.busy === true, text: String(la.lastExecution || '—') },
    positions: { busy: st.positionManager?.busy === true, text: String(st.positionManager?.lastReview?.actionTr || '—') }
  };
  return { blockers, funnel, desks, stage };
}

let DEMO_SCENARIO = 'base';
async function buildSnapshot() {
  if (DEMO) {
    const demoFile = DEMO_SCENARIO === 'sim' ? 'demo-sim-v109.json' : 'demo-snapshot.json';
    const demo = readJsonFile(path.join(HERE, demoFile));
    if (demo) {
      // Demo zaman damgalarını "şimdi"ye kaydır; böylece LIVE kalan süre ve 60 dk grafiği canlı görünür.
      const delta = Date.now() - Number(demo.demoBaseTs || Date.now());
      const shift = v => {
        if (Array.isArray(v)) return v.map(shift);
        if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = shift(x); return o; }
        if (typeof v === 'number' && v > 1.7e12 && v < 2.2e12) return v + delta;
        if (typeof v === 'string' && /^20\d\d-\d\d-\d\dT[\d:.]+Z$/.test(v)) return new Date(Date.parse(v) + delta).toISOString();
        return v;
      };
      const snap = { ...shift(demo), generatedAt: nowIso(), demo: true };
      snap.derived = derive(snap);
      return snap;
    }
  }
  const [health, status, visionProgress, journal, models, ollama, account] = await Promise.all([
    cached('health', 15000, () => brainGet('/health')),
    cached('status', 4000, () => brainGet('/live/status')),
    cached('vision', 2500, () => brainGet('/vision/progress')),
    cached('journal', 15000, () => brainGet('/journal', 'limit=80')),
    cached('models', 20000, () => brainGet('/models/healthy')),
    cached('ollama', 10000, () => getJson(OLLAMA_URL + '/api/ps', { timeoutMs: 3000 })),
    ACCOUNT_ENABLED ? cached('account', 30000, () => brainGet('/live/account')) : Promise.resolve(null)
  ]);
  const router = await cached('router', 30000, () => getJson(ROUTER_URL + '/', { timeoutMs: 3000 }).then(r => ({ ok: r.status > 0 && r.status < 500, status: r.status, ms: r.ms, error: r.error || null })));
  const logTail = await cached('log', 8000, async () => tailFile(path.join(BRAIN_ROOT, 'logs', 'brainpub.log')));
  const backups = await cached('backups', 60000, async () => listBackups());
  const jevUsage = await cached('jevUsage', 15000, async () => readJsonFile(path.join(BRAIN_ROOT, 'data', 'jev-usage.json')));
  const journalSummary = summarizeJournal(journal?.data?.items || []);
  const logEvents = parseLog(logTail?.lines || []);
  const events = [...journalSummary.events, ...logEvents]
    .filter(e => Number.isFinite(e.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 120);
  const snap = {
    officeVersion: OFFICE_VERSION,
    generatedAt: nowIso(),
    demo: false,
    config: { brainUrl: BRAIN_URL, brainRoot: BRAIN_ROOT, backupRoot: BACKUP_ROOT, tokenConfigured: Boolean(TOKEN), accountEnabled: ACCOUNT_ENABLED },
    health: { ok: health?.ok === true, status: health?.status, ms: health?.ms, data: scrub(health?.data), error: health?.error || null },
    status: { ok: status?.ok === true, status: status?.status, ms: status?.ms, data: scrub(status?.data), error: status?.error || null },
    visionProgress: { ok: visionProgress?.ok === true, data: scrub(visionProgress?.data) },
    models: { ok: models?.ok === true, data: scrub(models?.data) },
    account: account ? { ok: account.ok === true, data: scrub(account.data), error: account.error || null } : { ok: false, disabled: true },
    ollama: { ok: ollama?.ok === true, data: scrub(ollama?.data), error: ollama?.error || null },
    router,
    backups,
    jevUsage: scrub(jevUsage),
    plans: journalSummary.plans.slice(0, 40),
    lastJev: journalSummary.lastJev,
    lastRisk: journalSummary.lastRisk,
    events,
    log: { ok: logTail?.ok === true, mtime: logTail?.mtime || null, error: logTail?.error || null }
  };
  snap.derived = derive(snap);
  return snap;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, {
    'content-type': type,
    'content-length': buf.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  });
  res.end(buf);
}

function keyOk(req, u) {
  if (!OFFICE_KEY) return true;
  const supplied = String(u.searchParams.get('key') || req.headers['x-office-key'] || '');
  if (supplied.length !== OFFICE_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(OFFICE_KEY));
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'read-only' });
    if (!keyOk(req, u)) return send(res, 401, { ok: false, error: 'office key required' });
    if (u.pathname === '/' || u.pathname === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'public', 'office.html')), 'text/html; charset=utf-8');
    }
    if (u.pathname === '/api/snapshot') { DEMO_SCENARIO = u.searchParams.get('demo') === 'sim' ? 'sim' : 'base'; return send(res, 200, await buildSnapshot()); }
    if (u.pathname === '/api/ping') return send(res, 200, { ok: true, officeVersion: OFFICE_VERSION, demo: DEMO, time: nowIso() });
    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: clip(e?.message || e, 160) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`BrainHub Trade Office ${OFFICE_VERSION} → http://${HOST}:${PORT}/  (demo=${DEMO ? 'evet' : 'hayır'}, brain=${BRAIN_URL}, token=${TOKEN ? 'var' : 'yok'})`);
  });
}

module.exports = { derive, summarizeJournal, parseLog, waitIsFake, scrub };
