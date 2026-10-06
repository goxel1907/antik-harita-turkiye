'use strict';
// BrainHub Trade Office - salt-okunur (read-only) izleme sunucusu.
// Brain Hub'a yalnız GET istekleri atar, hiçbir ayarı/emri değiştirmez.
// Token tarayıcıya gönderilmez; yalnız bu süreçte bellekte tutulur.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OFFICE_VERSION = '2.5.31-R2544.51-JEV-Brain';
const HERE = __dirname;
const BRAIN_ROOT = process.env.BRAINHUB_ROOT || 'C:\\JEV-Brain\\runtime'; // CLAUDE_R2544_12_JEV_BRAIN
const BACKUP_ROOT = process.env.BRAINHUB_BACKUP_ROOT || 'C:\\JEV-Brain\\BrainHubBackups';
const BRAIN_URL = (process.env.BRAINHUB_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const ROUTER_URL = (process.env.ROUTER_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
const HEADROOM_URL = (process.env.HEADROOM_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
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
  '/health', '/live/status', '/live/burst', '/vision/progress', '/jev/budget', '/models/healthy', '/live/account', '/journal', '/live/positions', '/context/jev-live-mirror', '/chart/png',
  '/scanner/last', '/jev/knowledge', '/learning/case-memory' // R2544.19 read-only provenance/case memory
]);

const cache = new Map();
function canonicalPositions(data){
 if(!data)return data;
 let db;
 try{
   const {DatabaseSync}=require('node:sqlite');
   const perfPath=fs.existsSync(path.join(BRAIN_ROOT,'server','office-performance.js'))?path.join(BRAIN_ROOT,'server','office-performance.js'):path.join(HERE,'..','office-performance.js');
   const {enrichCloses,performanceReport}=require(perfPath);
   db=new DatabaseSync(path.join(BRAIN_ROOT,'data','brainhub.sqlite'),{readOnly:true});
   const records=db.prepare("SELECT id,ts,kind,symbol,payload FROM journal WHERE kind IN ('POSITION_CLOSED','R2542_OFFICE_EVENT','LIVE_EXECUTION','JEV_POSITION_EXECUTION','CLOSE_EXIT_EVIDENCE') ORDER BY ts ASC").all().map(x=>({...x,payload:JSON.parse(x.payload)}));
   return {...data,closed:enrichCloses(data.closed||[],records),performance:performanceReport(records,data.open||[]),reportingOverlay:'READ_ONLY_SQLITE_CANONICAL'};
 }catch(e){return {...data,reportingOverlayError:String(e.message).slice(0,160)};}
 finally{if(db)db.close();}
}

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

const CONTROL_ROUTES = { '/api/control/mode': '/live/mode', '/api/control/arm': '/live/arm', '/api/control/disarm': '/live/disarm', '/api/control/oto': '/live/leader-auto' };
// Only these fields ever reach the core; anything else in the Office request is dropped (OTO sizing, burst switch etc.
// stay with the user's existing config).
const CONTROL_BODY = {
  '/api/control/mode': b => {
    const out = { mode: String(b.mode || '').toUpperCase(), confirm: String(b.confirm || '').toUpperCase() };
    const bal = Number(b.testBalance);
    if (b.testBalance != null && Number.isFinite(bal) && bal > 0) out.testBalance = bal;
    return out;
  },
  '/api/control/arm': b => ({ confirm: String(b.confirm || '') }),
  '/api/control/disarm': () => ({ reason: 'OFFICE_USER' }),
  '/api/control/oto': b => ({ enabled: b.enabled === true })
};
function readSmallBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function brainPost(p, body) {
  if (!Object.values(CONTROL_ROUTES).includes(p)) return { ok: false, status: 400, error: 'BRAIN_PATH_NOT_ALLOWED' };
  const headers = { 'content-type': 'application/json', ...(TOKEN ? { authorization: 'Bearer ' + TOKEN } : {}) };
  try {
    const r = await fetch(BRAIN_URL + p, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
    let data = null; try { data = await r.json(); } catch { data = null; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 502, error: clip(e?.cause?.code || e?.message || e, 160) }; }
}
function brainGet(p, query = '') {
  if (!ALLOWED_BRAIN_PATHS.has(p)) throw new Error('BRAIN_PATH_NOT_ALLOWED');
  const headers = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  return getJson(BRAIN_URL + p + (query ? '?' + query : ''), { headers, timeoutMs: p === '/live/account' ? 15000 : 9000 });
}
async function brainBinary(p, query = '') {
  if (!ALLOWED_BRAIN_PATHS.has(p)) throw new Error('BRAIN_PATH_NOT_ALLOWED');
  const headers = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  const started = Date.now();
  try {
    const r = await fetch(BRAIN_URL + p + (query ? '?' + query : ''), { method:'GET', headers, signal:AbortSignal.timeout(12000) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok:r.ok, status:r.status, data:buf, type:String(r.headers.get('content-type')||'application/octet-stream'), ms:Date.now()-started };
  } catch (e) {
    return { ok:false, status:0, data:Buffer.alloc(0), type:'application/octet-stream', error:clip(e?.cause?.code || e?.message || e,160), ms:Date.now()-started };
  }
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

// CLAUDE_R2544_4_PACKET_HEALTH: JEV istek boyutu günlüğü (yalnız metadata; piyasa verisi/anahtar yok).
function readPacketHealth() {
  const t = tailFile(path.join(BRAIN_ROOT, 'logs', 'jev-request-size.log'), 256 * 1024);
  if (!t.ok) return { ok: false, error: t.error };
  const rows = [];
  for (const l of t.lines) { try { rows.push(JSON.parse(l)); } catch {} }
  const last = rows[rows.length - 1] || null;
  const since = Date.now() - 3600000;
  const recent = rows.filter(r => Date.parse(r.at) >= since);
  const byPass = {};
  for (const r of recent) { const k = String(r.pass); byPass[k] = byPass[k] || { calls: 0, blocked: 0, targetExceeded:0, maxBytes: 0, targetBytes:r.targetBytes??null }; byPass[k].calls++; if (r.blocked) byPass[k].blocked++; if(r.targetExceeded)byPass[k].targetExceeded++; byPass[k].maxBytes = Math.max(byPass[k].maxBytes, Number(r.bytes) || 0); if(r.targetBytes!=null)byPass[k].targetBytes=r.targetBytes; }
  return { ok: true, at: last?.at || null, pass: last?.pass ?? null, bytes: last?.bytes ?? null, beforeBytes: last?.beforeBytes ?? null, maxBytes: last?.maxBytes ?? 48000, targetBytes:last?.targetBytes??null, targetExceeded:last?.targetExceeded===true, coreTruthProtected:last?.coreTruthProtected!==false,
    blocked: last?.blocked === true, trimSteps: (last?.trimStepsApplied || []).slice(-8), fitOmitted: Array.isArray(last?.fitOmitted) ? last.fitOmitted.slice(0,8) : [], contextBudget:last?.contextBudget||null, sections:last?.sections||null, marketSectionsBefore:last?.marketSectionsBefore||null,marketSectionsAfter:last?.marketSectionsAfter||null,wireEncoding:last?.wireEncoding||null, last60: { calls: recent.length, blocked: recent.filter(r => r.blocked).length, byPass } };
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
    if ((it.kind === 'PLAN' || it.kind === 'PLAN_FAST')) {
      const plan = p.plan || {};
      const jd = p.jevFinal || plan.jevDecision || null;
      const row = {
        ...base,
        desk: 'brain',
        status: String(plan.status || ''),
        previousStatus: plan.previousStatus || null,
        side: plan.side || null,
        originTF: plan.originTF || null,
        ownerTF: plan.ownerTF || null,
        lane:(plan.tradeLane&&typeof plan.tradeLane==='object'?plan.tradeLane.name:plan.tradeLane)||plan.lane||null,
        setupFamily:plan.setupFamily||jd?.setupFamily||null,
        entryTiming:plan.entryTiming||jd?.entryTiming||null,
        waitReason:plan.waitReason||jd?.waitReason||null,
        releaseContract:p.releaseContract||plan.releaseContract||null,
        confidence: finite(plan.confidence),
        waitFor: clip(plan.waitFor, 200),
        fakeWait: String(plan.status || '').toUpperCase() === 'WATCH' && waitIsFake(plan.waitFor),
        reason: plan.reason || null,
        supportTFs: plan.supportTFs || [],
        vetoTFs: plan.vetoTFs || [],
        visionAttached: finite(p.vision?.attached),
        trigger: plan.triggerSpec ? { valid: plan.triggerSpec.valid === true, tf: plan.triggerSpec.tf || null, id: plan.triggerSpec.triggerLevelId || null, price: finite(plan.triggerSpec.triggerPrice), autoSelected: plan.triggerSpec.autoSelected === true } : null,
        claudeDt: plan.claudeDeterministicTrigger ? { wouldQualify: plan.claudeDeterministicTrigger.wouldQualify === true, applied: plan.claudeDeterministicTrigger.applied === true, tf: plan.claudeDeterministicTrigger.tf || null, lane: plan.claudeDeterministicTrigger.laneName || null } : null,
        claudeRevalidated: plan.claudeTriggerRevalidation ? plan.claudeTriggerRevalidation.ok === true : null,
        riskReasons: (p.riskGate?.reasons || []).slice(0, 8),
        jev: jd ? { called: jd.called === true, action:jd.action||null, entryTiming:jd.entryTiming||null, waitReason:jd.waitReason||null, veto: jd.veto === true, reasons: (jd.vetoReasons || []).slice(0, 8), reason: jd.reason || null, probabilities: jd.probabilities || null, timeframeConflicts: jd.timeframeConflicts || null, costUsd: finite(jd.costUsd), roleWeightedVeto: jd.claudeRoleWeighted ? jd.claudeRoleWeighted.veto === true : null } : null
      };
      plans.push(row);
      if (row.jev && row.jev.called && !lastJev) lastJev = { ...row.jev, symbol: row.symbol, ts: row.ts, side: row.side };
      // PLAN riskGate is pre-JEV/advisory context. Hard Safety masasını yalnız JEV_FINAL_AUTHORITY / live execution doldurur.
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
    } else if (it.kind === 'CLAUDE_V111_REVALIDATION') {
      // CLAUDE_V111: worker sayısal tetiği → saklanan 9TF planı Vision'sız yeniden doğrulandı mı?
      events.push({ ...base, desk: p.ok ? 'jev' : 'workers', title: `Tetik yeniden doğrulama ${it.symbol || ''} ${p.side || ''}: ${p.ok ? (p.applied ? 'QUALIFIED → Jev' : 'geçerdi (gölge)') : 'geçmedi'}`, detail: clip(p.ok ? `${p.triggerTF || ''} tetik ${finite(p.triggerPrice) ?? '?'} • ${p.info?.laneName || ''}` : (p.reasons || []).join(', '), 160) });
    } else if (it.kind === 'JEV_FINAL_AUTHORITY') {
      const ok=String(p.stage||'')==='HARD_SAFETY_READY'||String(p.stage||'')==='ORDER_PLACED';
      const detail=(p.reasons||[]).length ? (p.reasons||[]).join(', ') : ((p.softWarnings||[]).length ? 'soft uyarı: '+(p.softWarnings||[]).join(', ') : 'JEV onayı sonrası yalnız zorunlu güvenlik');
      events.push({ ...base, desk: ok?'exec':'risk', title:`JEV son karar ${it.symbol||''}: ${p.stage||'?'}`, detail:clip(detail,180) });
      if(!ok && (p.reasons||[]).length && !lastRisk) lastRisk={symbol:it.symbol,ts:base.ts,reasons:(p.reasons||[]).slice(0,8)};
    } else if (it.kind === 'CLAUDE_V112_FAST_LANE_SIGNAL') {
      events.push({ ...base, desk: 'workers', title: `Hızlı scalp ${it.symbol || ''} ${p.side || ''}: ${p.tf || ''} kırılım ${p.applied ? '→ JEV' : '(gölge kayıt)'}`, detail: clip(`seviye ${finite(p.level) ?? '?'} • canlı ${finite(p.livePrice) ?? '?'} • ${(p.momentum || []).join(',')}`, 160) });
    } else if (it.kind === 'VISION_BENCHMARK') {
      const sm = p.summary || {};
      events.push({ ...base, desk: 'vision', title: `Vision doğruluk testi: %${finite(sm.accuracyPct) ?? '?'} (${sm.matched ?? '?'}/${sm.cases ?? '?'})`, detail: clip(Object.entries(sm.byLabel || {}).map(([k, v]) => `${k} %${v.accuracyPct}`).join(' • '), 160) });
    } else if (it.kind === 'POSITION_CLOSED') {
      const net = finite(p.netPnl), r = finite(p.rMultiple);
      events.push({ ...base, desk: 'learning', title: `İşlem kapandı ${it.symbol || ''} ${p.side || ''}: ${net === null ? '?' : (net >= 0 ? '+' : '') + net.toFixed(2)} USDT${r === null ? '' : ' • ' + r.toFixed(2) + 'R'}`, detail: clip(`${p.exitType || ''} • ${p.holdMinutes ?? '?'} dk • ${p.entryContext?.why || ''}`, 180) });
    } else if (it.kind === 'CLAUDE_V112_POSITION_REST') {
      events.push({ ...base, desk: 'positions', title: p.stage === 'START' ? `Pozisyonlar dolu (${p.openPositions}/${p.maxOpenPositions}) — ajanlar dinleniyor` : `Yer açıldı (${p.openPositions}/${p.maxOpenPositions}) — ajanlar devam`, detail: '' });
    } else if (it.kind === 'CLAUDE_V111_RUNNER') {
      events.push({ ...base, desk: 'positions', title: `İz süren pozisyon ${it.symbol || ''}: ${p.kind || ''}${p.to != null ? ' → stop ' + p.to : (p.target != null ? ' → ' + p.target : '')}`, detail: clip(`${p.mode || ''} • faz ${p.phase || ''}${p.trailTf ? ' • iz TF ' + p.trailTf : ''}${p.reason ? ' • ' + p.reason : ''}`, 160) });
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
    } else if (it.kind === 'R2542_OFFICE_EVENT') {
      // CLAUDE_R2544_4_EVENT_FEED: 30 sn'lik TICK_RESULT telemetrisi akışı boğuyordu (2 saatte 289 satır, içeriksiz).
      // Emir yoksa akışa yazılmaz; diğer ofis olayları türü + nedeniyle okunur hale gelir.
      if (p.kind === 'TICK_RESULT' && p.orderPlaced !== true) continue;
      const rs = (p.reasons || p.blockedReasons || []).slice(0, 4).join(', ');
      events.push({ ...base, desk: 'brain', title: `Ofis olayı ${it.symbol || p.symbol || ''}: ${p.kind || p.stage || p.event || '?'}`, detail: clip(rs || p.execution || p.stage || '', 160) });
    } else if (it.kind === 'JEV_POSITION_EXECUTION') {
      const r = p.result || {};
      events.push({ ...base, desk: 'positions', title: `JEV pozisyon emri ${it.symbol || ''}: ${p.action || '?'}${p.fraction && p.fraction < 1 ? ' %' + Math.round(p.fraction * 100) : ''}`, detail: clip(`${r.orderPlaced ? 'gönderildi' : 'gönderilmedi'} • kalan ${r.remainingQty ?? '?'}`, 160) });
    } else if (it.kind === 'JEV_PARTIAL_DEFERRED') {
      const c = p.contract || {};
      events.push({ ...base, desk: 'positions', title: `JEV kısmi kâr ertelendi ${it.symbol || ''}`, detail: clip(`${c.reason || ''} • ilerleme ${c.progressR ?? '?'}R • alınan ${c.reviewPartialsTaken ?? 0}/${c.maxReviewPartials ?? '?'}`, 160) });
    } else if (it.kind === 'CLAUDE_R2544_PREMOVE_ATTENTION') {
      events.push({ ...base, desk: 'workers', title: `Ön-hareket radarı ${it.symbol || ''}: ${p.state || '?'} ${p.direction || ''}`, detail: clip(`${p.frame || ''} • ${(p.reasons || []).join(', ')}`, 160) });
    } else if (it.kind === 'JEV_LESSON') {
      events.push({ ...base, desk: 'learning', title: `JEV gölge dersi ${it.symbol || ''}: ${p.lessonFocus || ''}`, detail: clip(`${p.setupFamily || ''} • ${finite(p.rMultiple) === null ? '' : Number(p.rMultiple).toFixed(2) + 'R'} • ${p.lessonAction || ''}`, 160) });
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
  const pf = snap.positions?.data?.performance?.funnel;
  const execution = pf?.execution || { chains: [], reasonCounts: pf?.blockedReasons || {}, lastBlock: null };
  const rows = la.analysisLifecycle?.rows || [];
  const deep = Number(h.deepAnalyses || 0);
  const unique = Number(h.uniqueAnalyzedSymbols || 0);
  const wr = Number(h.workerReviews || 0);
  const wref = Number(h.workerRefreshes || 0);
  const vu = Number(h.visionUnavailable || 0);
  const approved = Number(h.claudeV111?.finalAuthorityApproved ?? h.qualified ?? 0);
  const intentBuilt = Number(h.claudeV111?.finalAuthorityIntentBuilt ?? h.intentBuilt ?? 0);
  const hardSafetyReady = Number(h.claudeV111?.finalAuthorityHardSafetyReady ?? h.safetyReady ?? h.intentReady ?? 0);
  const sovereign = st.jevSovereign?.enabled === true || snap.health?.data?.jevSovereign?.enabled === true;
  const pass1 = Number(h.sovereignPass1Calls || 0);
  const finalCalls = Number(h.sovereignFinalCalls || 0);
  const evidenceRequests = Number(h.sovereignEvidenceRequests || 0);
  // Operational budget truth wins over historical failure counters (including after UTC rollover).
  const budget = snap.jevBudget?.ok === true ? snap.jevBudget.data : st.jev?.budget;
  const budgetBlocked = budget?.budgetCallBlocked === true || budget?.canReserveNextCall === false;
  const providerError = st.jev?.provider?.lastError || null;
  const providerAccessBlocked = [401,403].includes(Number(providerError?.httpStatus));
  const blockers = [];
  const add = (level, code, title, detail) => blockers.push({ level, code, title, detail });
  const activeBlocker = execution.lastBlock || la.activeBlocker;
  if (activeBlocker) {
    const rawReasons = activeBlocker.reasons ?? activeBlocker.reason;
    const reasons = (Array.isArray(rawReasons) ? rawReasons : [rawReasons]).filter(Boolean).map(String);
    add('serious', 'EXECUTION_HARD_BLOCK', 'Son yürütme güvenlik engeli',
      [activeBlocker.symbol, ...reasons, activeBlocker.at || activeBlocker.ts || null].filter(Boolean).join(' • ') || 'Neden bildirilmedi');
  }

  if (!snap.status?.ok) add('critical', 'BRAIN_UNREACHABLE', 'Brain Hub yanıt vermiyor', snap.status?.error || ('HTTP ' + (snap.status?.status || 0)));
  if (st && snap.status?.ok) {
    if (la.enabled !== true) add('critical', 'AUTO_DISABLED', 'OTO işlem kapalı', 'Leader AUTO etkin değil; hiçbir aday yürütmeye gitmez.');
    if (st.armed !== true) add('critical', 'LIVE_DISARMED', 'LIVE kapalı (analiz modu)', 'Plan QUALIFIED olsa bile emir gönderilmez. PC yeniden başlarsa LIVE otomatik kapanır.');
    if (budgetBlocked) add('serious', 'JEV_DAILY_BUDGET_EXHAUSTED', 'JEV günlük çağrı bütçesi tükendi - UTC reset bekleniyor',
      `Kalan ${Number(budget.remainingUsd).toFixed(6)} USD • çağrı rezervi ${Number(budget.reservePerCallUsd).toFixed(6)} USD • günlük sınır ${budget.dailyCapUsd} USD • sıfırlanma ${budget.nextResetAt || 'bilinmiyor'}. Tarama devam eder; yeni JEV ağ çağrısı yapılmaz.`);
    if (providerAccessBlocked) add('critical','JEV_PROVIDER_ACCESS',`JEV sağlayıcı erişimi reddedildi (HTTP ${providerError.httpStatus})`,
      `${providerError.category || 'AUTH'}${providerError.code?' • '+providerError.code:''}${providerError.message?' • '+providerError.message:''}. Bu stratejik BEKLE veya yürütme engeli değildir; JEV PASS-1/PASS-2 ağ hattı yetkilendirilemediği için yeni karar oluşmaz.`);
    // R42: live 05.10 13:38-14:05 every JEV call failed with HTTP 402 (OpenRouter credits) but Office only showed JEV_HTTP_ERROR.
    if (Number(providerError?.httpStatus) === 402) add('critical', 'JEV_PROVIDER_CREDITS', 'OpenRouter kredisi yetersiz (HTTP 402)',
      `${providerError.message || 'Insufficient credits'}${providerError.at ? ' • ' + providerError.at : ''}. Kredi eklenene kadar JEV PASS-1/PASS-2/pozisyon kararları oluşmaz; bu stratejik BEKLE değildir.`);
    const fv = String(snap.health?.data?.featureVersion || st.featureVersion || '');
    const v109 = /9\.5\.(109-CLAUDE|11\d)/.test(fv); // CLAUDE_V112: 9.5.110+ (9.5.112-CLAUDE dahil)
    const cv = h.claudeV109 || {};
    if (!v109) add('warning', 'VERSION_OLD', `PC sürümü ${fv || '?'}`, "v9.5.109-CLAUDE yüklenmemiş: sahte WAIT, worker döngüsü ve boş tetik adayı düzeltmeleri PC'de yok.");
    if (!sovereign && deep >= 3 && Number(h.preJevQualified || 0) === 0) add('serious', 'NO_QUALIFIED', 'Görsel analiz hiç işlem adayı üretmedi', v109
      ? `${deep} derin analizde 0 QUALIFIED. Kod-tetik ${cv.dtWouldQualify ?? 0} planda "QUALIFIED olurdu" dedi (gölge).`
      : `${deep} derin analizde 0 QUALIFIED. Prompt her TF için WAIT/FORMING yazdırdığı için model WATCH'ta kalıyor.`);
    if (v109) {
      const hrs = finite(h.shadowEvidenceHours) ?? 0;
      add(h.shadowReady24h ? 'ok' : 'info', 'SHADOW', h.shadowReady24h ? 'Gölge kanıt 24 saati doldu' : `Gölge ölçüm sürüyor (${hrs.toFixed(1)}/24 sa)`,
        `Sayısal tetikli plan ${h.shadowPlans ?? 0} • gölge tetik ${h.shadowTriggers ?? 0} • 15 dk ort ${finite(h.shadowAvg15mPct) ?? '—'}% • 60 dk ort ${finite(h.shadowAvg60mPct) ?? '—'}%`);
      if (Number(cv.chaseBlocked || 0) > 0) add('info', 'CHASE', 'Kovalama ölçümü (JEV sonrası veto değil)', `${cv.chaseBlocked} eski/ölçüm olayı var. v111 JEV_FINAL_AUTHORITY modunda JEV onayından sonra stratejik veto olarak uygulanmaz.`);
    }
    if (!sovereign && wr >= 10 && wref / Math.max(1, wr) >= 0.8) add('serious', 'WORKER_LOOP', 'Plan worker döngüsü', `${wr} incelemenin ${wref}'i "9TF yenile" (%${Math.round(100 * wref / wr)}). Aynı coinler tekrar tekrar analiz ediliyor.`);
    const coverage=h.coverage;
    // R42: while all position slots are full, new-entry analysis rests by design; a stale attention queue is expected then.
    const restActive=h.claudeV112?.positionRest?.active===true;
    if(deep>=6&&coverage&&coverage.staleCount>=2&&coverage.oldestStaleMs>=10*60000)
      add(restActive?'info':'warning','COVERAGE',restActive?'İnceleme sırası bekliyor (pozisyonlar dolu)':'İnceleme sırası gecikiyor',`${coverage.targetCount} dikkat adayının ${coverage.staleCount} tanesi yeniden inceleme bekliyor; en eski ${Math.floor(coverage.oldestStaleMs/60000)} dk. Borsa evreni ile dikkat listesi farklıdır.`);
    else if(deep>=6&&unique/Math.max(1,deep)<0.5)
      add('info','REANALYSIS','Yeniden inceleme',`${deep} analiz / ${unique} farklı coin. Tekrar analiz tek başına kapsam daralması veya işlem engeli değildir.`);
    if (deep >= 3 && vu / Math.max(1, deep) >= 0.25) add('serious', 'VISION_DOWN', 'Görsel analiz sık düşüyor', `${vu}/${deep} analizde görsel komite yanıt vermedi.`);
    const fake = rows.filter(r => (String(r.state || '').toUpperCase() === 'WATCH' || String(r.planStatus || '').toUpperCase() === 'WATCH') && r.waitFor !== undefined && waitIsFake(r.waitFor));
    if (fake.length) add('warning', 'FAKE_WAIT', 'Sahte bekleme koşulu', `${fake.length} takipte bekleme metni "NONE ..." ile başlıyor; somut tetik yok.`);
    // CLAUDE_V113: Binance pozisyon defteri okunamıyorsa (anahtar/ağ) Office pozisyon ve sonuç göremez.
    const pos = snap.positions?.data || null;
    if (snap.positions && snap.positions.ok !== true && !snap.positions.disabled) add('warning', 'LEDGER_DOWN', 'Pozisyon defteri okunamıyor', 'Brain Hub /live/positions yanıt vermedi; açık pozisyon ve işlem sonuçları görünmez.');
    else if (pos && pos.ledgerOk === false) add('warning', 'LEDGER_DOWN', 'Binance pozisyonları okunamıyor', String(pos.ledgerError || 'bilinmiyor'));
    // CLAUDE_V112_POSITION_SLOTS_REST: pozisyonlar doluysa ajanlar bilinçli olarak dinlenir.
    const pr = h.claudeV112?.positionRest || null;
    if (pr?.active) add('ok', 'POSITION_REST', `Pozisyonlar dolu (${pr.openPositions}/${pr.maxOpenPositions}) — ajanlar dinleniyor`, `Yeni giriş analizi (Vision, hızlı hat/Jev, plan worker) ${pr.since ? new Date(pr.since).toLocaleTimeString('tr-TR') + "'den beri " : ''}durdu; Binance'e yeni emir gitmez. Açık pozisyonlar runner ve pozisyon yöneticisiyle yönetiliyor; yer açılınca kendiliğinden devam eder.`);
    // R42: live 05.10 every review of the open position ended without a JEV call while Office only said
    // "agents resting". An open position whose recent reviews never reached JEV is a visible blocker.
    const pm = st.positionManager || {};
    const openCount = Number(pm.ledger?.openCount ?? pos?.openCount ?? 0);
    const reviews = (Array.isArray(pm.history) ? pm.history : []).filter(r => r && r.jev && typeof r.jev === 'object');
    if (openCount > 0 && reviews.length >= 3 && reviews.every(r => r.jev.called !== true)) {
      const why = [...new Set(reviews.map(r => r.jev.reason).filter(Boolean))].join(', ') || 'neden kaydedilmedi';
      add('serious', 'JEV_POSITION_JUDGE_UNREACHED', `JEV pozisyon hakemine ulaşılamıyor (son ${reviews.length} inceleme)`,
        `${[reviews[0].symbol, reviews[0].side].filter(Boolean).join(' ')} • neden: ${why}. Pozisyon yalnız borsadaki stop/TP ve guard ile korunuyor; TUT • VERİYİ YENİDEN KONTROL ET bir JEV kararı değildir.`);
    }
    // CLAUDE_V112: LIVE kapalıyken Jev onayı hard safety'ye hiç gitmez; bu uyarı yalnız LIVE açıkken anlamlı.
    if (st.armed === true && !pr?.active && approved > 0 && intentBuilt === 0) add('warning', 'NO_INTENT', 'JEV onayı var, emir niyeti oluşmadı', 'JEV final kararından sonra intent üretimi hard-block nedenleriyle kesiliyor olabilir. leaderAuto.activeBlocker ve JEV_FINAL_AUTHORITY HARD_BLOCK nedenleri gösterilmelidir.');
    if (intentBuilt > 0 && hardSafetyReady === 0) add('warning', 'NO_SAFETY', 'Emir niyeti var, zorunlu güvenlik geçmedi', 'Stop/likidasyon geometrisi, bakiye/pozisyon limitleri, Binance filtreleri, taze fiyat, kill-switch, lease/lineage veya execution claim engeli olabilir.');
    if (hardSafetyReady > 0 && Number(h.ordersPlaced || 0) === 0) add('warning', 'NO_ORDER', 'Zorunlu güvenlik geçti, emir yok', 'Yürütme katmanı (LIVE yürütme yetkisi, Binance kural doğrulaması veya ağ) engelliyor olabilir.');
    if (sovereign && !budgetBlocked && deep >= 1 && pass1 === 0) add('serious','JEV_PASS1_MISSING','Radar/analiz JEV PASS-1’e ulaşmıyor',`${deep} değerlendirme var ama PASS-1 çağrısı yok. Scanner yalnız ATTENTION_ONLY olmalı ve stratejik kapı JEV’den önce çalışmamalı.`);
    if (sovereign && !budgetBlocked && !providerAccessBlocked && pass1 >= 2 && finalCalls === 0) add('warning','JEV_FINAL_MISSING','JEV kanıt istedi ama final karar oluşmadı',`PASS-1 ${pass1} • kanıt isteği ${evidenceRequests} • PASS-2/son karar 0. Kanıt ajanı veya JEV son karar çağrısı kontrol edilmeli.`);

    if (!sovereign && Number(h.jevCalled || 0) >= 3 && Number(h.jevVetoed || 0) / Math.max(1, Number(h.jevCalled)) >= 0.7) add('warning', 'JEV_VETO', 'Jev çoğu planı veto ediyor', `${h.jevVetoed}/${h.jevCalled} veto.`);
    if (!sovereign && Number(h.jevShadowCalled || 0) > 0 && Number(h.jevCalled || 0) === 0) add('info','JEV_SHADOW_ONLY','Jev WATCH planlarını gölgede inceliyor',`${h.jevShadowCalled} gölge inceleme var; bağlayıcı Jev yalnız QUALIFIED plan geldikten sonra devreye girer.`);
    if (!sovereign && Number(h.laneScalpPlans || 0) > 0) add(Number(h.laneScalpReady||0)>0?'ok':'info','SCALP_LANE',`Scalp momentum hattı ${Number(h.laneScalpReady||0)>0?'hazır aday taşıyor':'izliyor'}`,`${h.laneScalpPlans||0} scalp planı • hazır ${h.laneScalpReady||0}. Tek 1m/3m/5m final karar vermez; en az iki alt TF + 15m karşı-veto kontrolü gerekir.`);
    if (!sovereign && Number(h.laneMain15Plans || 0) > 0) add('info','MAIN_15M_LANE','15m ana işlem hattı aktif',`${h.laneMain15Plans||0} plan • 15m hazır ${h.laneMain15Ready||0}. 30m+ yapı/likidite/formasyon bağlamıdır.`);
    if (finite(h.avgAnalysisMs) !== null && h.avgAnalysisMs > 240000) add('warning', 'SLOW', 'Derin analiz yavaş', `Ortalama ${(h.avgAnalysisMs / 1000).toFixed(0)} sn; 1m/3m/5m kurulumları için geç.`);
    if (Number(h.skippedBusy || 0) > 60) add('info', 'BUSY', 'Turların çoğu atlanıyor', `${h.skippedBusy} tur analiz/pipeline yoğunluğu nedeniyle atlandı. GPU ana karar hattında zorunlu değildir; skippedPipelineBusy/skippedExecutorBusy ayrı izlenmelidir.`);
  }
  const funnel = sovereign ? [
    { key: 'universe', label: 'Binance evreni', value: finite(h.latestLightweightUniverseCount) ?? finite(h.latestUniverseCount) },
    { key: 'target', label: 'Radar hedef evreni', value: finite(la.diagnostics?.universeCount) },
    { key: 'shortlist', label: 'Radar dikkat listesi', value: finite(h.latestShortlistCount) },
    { key: 'deep', label: 'JEV değerlendirme', value: deep },
    { key: 'pass1', label: 'JEV PASS-1 • kanıt seçimi', value: pass1 },
    { key: 'evidence', label: 'JEV kanıt istekleri', value: evidenceRequests },
    { key: 'final', label: 'JEV PASS-2 • SON KARAR', value: finalCalls },
    { key: 'action', label: 'ALIŞ + SATIŞ son karar', value: Number(h.sovereignLong||0)+Number(h.sovereignShort||0) },
    { key: 'wait', label: 'JEV BEKLE', value: Number(h.sovereignWait||0) },
    { key: 'approved', label: 'JEV MARKET_NOW onayı', value: approved },
    { key: 'intentBuilt', label: 'Emir niyeti oluştu', value: intentBuilt },
    { key: 'hardBlocked', label: 'Yürütme güvenlik engeli', value: finite(pf?.hardBlocked) ?? 0 },
    { key: 'safety', label: 'Zorunlu güvenlik geçti', value: hardSafetyReady },
    { key: 'orders', label: 'Açılan emir', value: finite(h.ordersPlaced) ?? 0 }
  ] : [
    { key: 'universe', label: 'Binance evreni', value: finite(h.latestLightweightUniverseCount) ?? finite(h.latestUniverseCount) },
    { key: 'target', label: 'Hedef evren', value: finite(la.diagnostics?.universeCount) },
    { key: 'shortlist', label: 'Derin kısa liste', value: finite(h.latestShortlistCount) },
    { key: 'eligible', label: 'Ön filtre uygun', value: finite(h.latestEligibleCount) },
    { key: 'deep', label: 'Derin 9TF analiz', value: deep },
    { key: 'preJev', label: 'İŞLEM ADAYI (JEV öncesi)', value: finite(h.preJevQualified) ?? 0 },
    { key: 'jev', label: 'Jev çağrısı', value: finite(h.jevCalled) ?? 0 },
    { key: 'qualified', label: 'JEV ONAYI • son stratejik karar', value: finite(h.qualified) ?? 0 },
    { key: 'intent', label: 'Zorunlu güvenlik geçti', value: hardSafetyReady },
    { key: 'orders', label: 'Açılan emir', value: finite(h.ordersPlaced) ?? 0 }
  ];
  // Keep /live/status intact. Durable decision events reconcile the funnel only;
  // they must never replace scanner health or fabricate historical runtime calls.
  if (sovereign && pf) {
    const counts = { deep: pf.analyses, pass1: pf.pass1, final: pf.pass2,
      action: Number(pf.long || 0) + Number(pf.short || 0), wait: pf.wait,
      approved:pf.approved, intentBuilt:pf.intentBuilt, hardBlocked:pf.hardBlocked, safety:pf.safetyPassed, orders: pf.orders };
    for (const item of funnel) if (counts[item.key] != null) item.value = counts[item.key];
  }
  // One durable source for decision displays; raw scanner health stays intact.
  const decisionHealth = sovereign && pf ? {
    sovereignPass1Calls:Number(pf.pass1||0),sovereignFinalCalls:Number(pf.pass2||0),
    sovereignLong:Number(pf.long||0),sovereignShort:Number(pf.short||0),sovereignWait:Number(pf.wait||0),
    ordersPlaced:Number(pf.orders||0),qualified:Number(pf.approved||0),intentBuilt:Number(pf.intentBuilt||0),safetyReady:Number(pf.safetyPassed||0),intentReady:Number(pf.safetyPassed||0),
    claudeV111:{...h.claudeV111,finalAuthorityApproved:Number(pf.approved||0),finalAuthorityIntentBuilt:Number(pf.intentBuilt||0),finalAuthorityHardSafetyReady:Number(pf.safetyPassed||0)},
    decisionAnalyses:Number(pf.analyses||0),decisionUniqueCoins:Number(pf.uniqueCoverage||0)
  } : {};
  const vp = snap.visionProgress?.data || st.visionProgress || {};
  const stage = String(vp.stage || 'IDLE');
  const desks = {
    scanner: { busy: Number(h.scanRuns || 0) > 0, text: `Tarama ${h.scanRuns ?? 0} • tur sonucu ${h.tickResults ?? 0} • analiz ${deep} / ${unique} coin` },
    vision: { busy: !/^(IDLE|DETAIL_RUN_COMPLETE|PIXEL_RUN_COMPLETE|DETAIL_RUN_ERROR|PIXEL_RUN_ERROR)$/.test(stage), stage, text: stage },
    workers: { busy: la.planWorkers?.busy === true, text: sovereign ? `JEV talep ettiği kanıt • istek ${evidenceRequests}` : `inceleme ${wr} • bekle ${h.workerWaits ?? 0} • tetik ${h.workerTriggers ?? 0} • yenile ${wref}` },
    jev: { busy: false, text: sovereign ? `PASS-1 ${pass1} • SON KARAR ${finalCalls} • ALIŞ ${h.sovereignLong??0} / SATIŞ ${h.sovereignShort??0} / BEKLE ${h.sovereignWait??0}` : `bağlayıcı ${h.jevCalled ?? 0} • gölge ${h.jevShadowCalled ?? 0} • bugün ${Number(st.jev?.budget?.spentUsd || 0).toFixed(4)}` },
    exec: { busy: la.busy === true, text: String(la.lastExecution || '—') },
    positions: { busy: st.positionManager?.busy === true, text: String(st.positionManager?.lastReview?.actionTr || '—') }
  };
  return { blockers, funnel, desks, stage, decisionHealth, execution, budget: budget || null, budgetBlocked,
    scanner: { scanRuns: h.scanRuns ?? null, tickResults: h.tickResults ?? null,
      deepAnalyses: h.deepAnalyses ?? null, uniqueAnalyzedSymbols: h.uniqueAnalyzedSymbols ?? null,
      latestLightweightUniverseCount: h.latestLightweightUniverseCount ?? null,
      latestShortlistCount: h.latestShortlistCount ?? null, topReasons: h.topReasons ?? [] } };
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
  const [health, status, visionProgress, journal, models, ollama, account, jevBudget] = await Promise.all([
    cached('health', 15000, () => brainGet('/health')),
    cached('status', 4000, () => brainGet('/live/status')),
    cached('vision', 2500, () => brainGet('/vision/progress')),
    cached('journal', 15000, () => brainGet('/journal', 'limit=80')),
    cached('models', 20000, () => brainGet('/models/healthy')),
    cached('ollama', 10000, () => getJson(OLLAMA_URL + '/api/ps', { timeoutMs: 3000 })),
    ACCOUNT_ENABLED ? cached('account', 30000, () => brainGet('/live/account')) : Promise.resolve(null),
    cached('jevBudget', 4000, () => brainGet('/jev/budget'))
  ]);
  // CLAUDE_V113_POSITION_LEDGER: açık pozisyonlar + kapanan işlem sonuçları (Brain Hub defteri, salt-okunur).
  const positions = ACCOUNT_ENABLED ? await cached('positions', 10000, () => brainGet('/live/positions', 'limit=40')) : null;
  const caseMemory = await cached('caseMemory', 10000, () => brainGet('/learning/case-memory', 'limit=12'));
  const knowledge = await cached('knowledge', 60000, () => brainGet('/jev/knowledge'));
  const scannerLast = await cached('scannerLast', 5000, () => brainGet('/scanner/last'));
  const burst = await cached('burst', 1000, () => brainGet('/live/burst'));
  const router = await cached('router', 30000, () => getJson(ROUTER_URL + '/', { timeoutMs: 3000 }).then(r => ({ ok: r.status > 0 && r.status < 500, status: r.status, ms: r.ms, error: r.error || null })));
  const headroom = await cached('headroom', 15000, () => getJson(HEADROOM_URL + '/health', { timeoutMs: 2500 }).then(r => ({ ok: r.ok === true, status: r.status, ms: r.ms, data: scrub(r.data), error: r.error || (r.ok ? null : 'HTTP ' + r.status), url: HEADROOM_URL })));
  const logTail = await cached('log', 8000, async () => tailFile(path.join(BRAIN_ROOT, 'logs', 'brainpub.log')));
  const backups = await cached('backups', 60000, async () => listBackups());
  const jevUsage = await cached('jevUsage', 15000, async () => readJsonFile(path.join(BRAIN_ROOT, 'data', 'jev-usage.json')));
  const packetHealth = await cached('packetHealth', 10000, async () => readPacketHealth());
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
    positions: positions ? { ok: positions.ok === true, data: positions.ok === true ? scrub(canonicalPositions(positions.data)) : null, error: positions.error || (positions.ok ? null : 'HTTP ' + positions.status) } : { ok: false, disabled: true },
    ollama: { ok: ollama?.ok === true, data: scrub(ollama?.data), error: ollama?.error || null },
    router,
    headroom,
    backups,
    jevUsage: scrub(jevUsage),
    packetHealth,
    caseMemory: { ok: caseMemory?.ok === true, data: scrub(caseMemory?.data), error: caseMemory?.error || null },
    knowledge: { ok: knowledge?.ok === true, data: scrub(knowledge?.data), error: knowledge?.error || null },
    jevBudget: { ok: jevBudget?.ok === true, data: scrub(jevBudget?.data), error: jevBudget?.error || null },
    // CLAUDE_R2544_15: canlı Binance yükselenler merdiveni + 24 saatlik likidasyon kaydı sağlığı
    ladder: scannerLast?.ok === true ? scrub(scannerLast.data) : null,
    burst: burst?.ok === true ? scrub(burst.data) : null,
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
    // R2544.51: the only Office writes — TEST/LIVE mode, LIVE arm/disarm, OTO on/off — forwarded to the core with the
    // server-side token. Local only (HOST 127.0.0.1); JSON body + custom header, so a cross-site page cannot send it
    // without a CORS preflight (Office never answers OPTIONS); the core still demands an explicit confirmation for mode
    // and arm. The body is rebuilt from a whitelist per route.
    if (req.method === 'POST' && CONTROL_ROUTES[u.pathname]) {
      if (!keyOk(req, u)) return send(res, 401, { ok: false, error: 'office key required' });
      if (req.headers['x-jev-office-control'] !== '1' || !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 403, { ok: false, error: 'control header required' });
      let raw = '';
      try { raw = await readSmallBody(req, 2048); } catch { return send(res, 413, { ok: false, error: 'body too large' }); }
      let parsed;
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { ok: false, error: 'invalid json' }); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
      const r = await brainPost(CONTROL_ROUTES[u.pathname], JSON.stringify(CONTROL_BODY[u.pathname](parsed)));
      for (const k of ['status', 'account', 'positions', 'burst']) cache.delete(k); // the next snapshot shows the new state
      return send(res, r.status || 502, scrub(r.data || { ok: false, error: r.error || 'core unavailable' }));
    }
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'read-only' });
    if (!keyOk(req, u)) return send(res, 401, { ok: false, error: 'office key required' });
    if (u.pathname === '/' || u.pathname === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'public', 'office.html')), 'text/html; charset=utf-8');
    }
    if (u.pathname === '/api/snapshot') { DEMO_SCENARIO = u.searchParams.get('demo') === 'sim' ? 'sim' : 'base'; return send(res, 200, await buildSnapshot()); }
    if (u.pathname === '/api/jev-mirror') {
      const symbol=String(u.searchParams.get('symbol')||'').trim().toUpperCase();
      const tf=String(u.searchParams.get('tf')||'15m').trim().toLowerCase();
      if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) return send(res,400,{ok:false,error:'invalid symbol'});
      if(!['5m','15m'].includes(tf)) return send(res,400,{ok:false,error:'invalid tf'});
      const upstream=await brainGet('/context/jev-live-mirror',new URLSearchParams({symbol,tf}).toString());
      return send(res,upstream?.ok===true?200:(upstream?.status||503),upstream?.ok===true?scrub(upstream.data):{ok:false,error:upstream?.error||upstream?.data?.error||'mirror unavailable'});
    }
    if (u.pathname === '/api/chart') {
      const symbol=String(u.searchParams.get('symbol')||'').trim().toUpperCase();
      const tf=String(u.searchParams.get('tf')||'15m').trim().toLowerCase();
      const mode=String(u.searchParams.get('mode')||'clean').trim().toLowerCase();
      const bars=Math.max(64,Math.min(256,Number(u.searchParams.get('bars'))||128));
      const snapshotId=String(u.searchParams.get('snapshotId')||'').trim();
      if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) return send(res,400,{ok:false,error:'invalid symbol'});
      if(!['5m','15m'].includes(tf)) return send(res,400,{ok:false,error:'invalid tf'});
      if(!['clean','annotated'].includes(mode)) return send(res,400,{ok:false,error:'invalid mode'});
      const upstream=await brainBinary('/chart/png',new URLSearchParams({symbol,tf,mode,bars:String(bars),...(snapshotId?{snapshotId}:{}),...(u.searchParams.get('htf')==='0'?{htf:'0'}:{}),...(u.searchParams.get('pos')==='0'?{pos:'0'}:{})}).toString());
      if(!upstream.ok)return send(res,upstream.status||503,{ok:false,error:upstream.error||'chart unavailable'});
      return send(res,200,upstream.data,'image/png');
    }
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

module.exports = { derive, summarizeJournal, parseLog, waitIsFake, scrub, server, CONTROL_ROUTES, CONTROL_BODY };
