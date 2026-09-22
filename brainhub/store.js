'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function openStore(root) {
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'brainhub.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS journal (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL,
      symbol TEXT, payload TEXT NOT NULL, outcome TEXT
    );
    CREATE INDEX IF NOT EXISTS journal_ts ON journal(ts DESC);
    CREATE INDEX IF NOT EXISTS journal_kind_symbol_ts ON journal(kind,symbol,ts DESC);
    CREATE TABLE IF NOT EXISTS learning_events (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL,
      symbol TEXT, side TEXT, setup TEXT, origin_tf TEXT, owner_tf TEXT,
      decision TEXT, confidence REAL, outcome_pct REAL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS learning_events_ts ON learning_events(ts DESC);
    CREATE INDEX IF NOT EXISTS learning_events_shape ON learning_events(side,setup,origin_tf,owner_tf);
    CREATE TABLE IF NOT EXISTS leases (
      resource TEXT PRIMARY KEY, owner TEXT NOT NULL, token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claims (
      event_id TEXT PRIMARY KEY, owner TEXT NOT NULL, claimed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lineage_claims (
      lineage_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, owner TEXT NOT NULL,
      claimed_at INTEGER NOT NULL
    );`);
  const insert = db.prepare('INSERT INTO journal(id,ts,kind,symbol,payload) VALUES(?,?,?,?,?)');
  const list = db.prepare('SELECT id,ts,kind,symbol,payload,outcome FROM journal ORDER BY ts DESC LIMIT ?');
  const outcome = db.prepare('UPDATE journal SET outcome=? WHERE id=?');
  // CLAUDE_V111_TRIGGER_REVALIDATION: sembolün son 9TF planı (Vision'sız yeniden doğrulama için).
  const latestByKind = db.prepare('SELECT id,ts,kind,symbol,payload FROM journal WHERE kind=? AND symbol=? ORDER BY ts DESC LIMIT 1');
  const learnInsert=db.prepare('INSERT INTO learning_events(id,ts,kind,symbol,side,setup,origin_tf,owner_tf,decision,confidence,outcome_pct,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const learnRecent=db.prepare('SELECT ts,kind,symbol,side,setup,origin_tf AS originTF,owner_tf AS ownerTF,decision,confidence,outcome_pct AS outcomePct FROM learning_events WHERE (? IS NULL OR symbol=?) ORDER BY ts DESC LIMIT ?');
  const learnStats=db.prepare("SELECT side,setup,origin_tf AS originTF,owner_tf AS ownerTF,COUNT(*) AS samples,AVG(outcome_pct) AS avgOutcomePct,SUM(CASE WHEN outcome_pct>0 THEN 1 ELSE 0 END) AS wins FROM learning_events WHERE outcome_pct IS NOT NULL GROUP BY side,setup,origin_tf,owner_tf ORDER BY samples DESC LIMIT 20");
  const leaseGet = db.prepare('SELECT owner,token_hash,expires_at FROM leases WHERE resource=?');
  const leaseSet = db.prepare('INSERT INTO leases(resource,owner,token_hash,expires_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(resource) DO UPDATE SET owner=excluded.owner,token_hash=excluded.token_hash,expires_at=excluded.expires_at,updated_at=excluded.updated_at');
  const leaseDelete = db.prepare('DELETE FROM leases WHERE resource=? AND token_hash=?');
  const claimInsert = db.prepare('INSERT INTO claims(event_id,owner,claimed_at) VALUES(?,?,?)');
  const claimGet = db.prepare('SELECT owner,claimed_at FROM claims WHERE event_id=?');
  const claimDelete = db.prepare('DELETE FROM claims WHERE event_id=? AND owner=?');
  const lineageInsert = db.prepare('INSERT INTO lineage_claims(lineage_id,event_id,owner,claimed_at) VALUES(?,?,?,?)');
  const lineageGet = db.prepare('SELECT event_id,owner,claimed_at FROM lineage_claims WHERE lineage_id=?');
  const lineageDelete = db.prepare('DELETE FROM lineage_claims WHERE lineage_id=? AND event_id=? AND owner=?');
  const hash = token => crypto.createHash('sha256').update(token).digest('hex');
  function journal(kind, symbol, payload, id = crypto.randomUUID()) {
    if (!/^[A-Z0-9_]{2,40}$/.test(kind)) throw new Error('invalid journal kind');
    if (symbol && !/^[A-Z0-9]{2,28}$/.test(symbol)) throw new Error('invalid symbol');
    const body = JSON.stringify(payload);
    if (body.length > 65536) throw new Error('journal payload too large');
    insert.run(id, Date.now(), kind, symbol || null, body);
    return id;
  }
  function latestJournal(kind, symbol) {
    if (!/^[A-Z0-9_]{2,40}$/.test(String(kind || '')) || !/^[A-Z0-9]{2,28}$/.test(String(symbol || ''))) return null;
    const row = latestByKind.get(kind, symbol);
    if (!row) return null;
    let payload = null;
    try { payload = JSON.parse(row.payload); } catch { return null; }
    return { id:row.id, ts:row.ts, kind:row.kind, symbol:row.symbol, payload };
  }
  // CLAUDE_V113_POSITION_LEDGER: son N kayıt (tek tür) — Office/uygulama kapanan işlemler tablosu.
  const recentByKind = db.prepare('SELECT id,ts,kind,symbol,payload FROM journal WHERE kind=? AND ts>=? ORDER BY ts DESC LIMIT ?');
  function recentJournal(kind, { limit = 30, sinceTs = 0 } = {}) {
    if (!/^[A-Z0-9_]{2,40}$/.test(String(kind || ''))) return [];
    return recentByKind.all(kind, Math.max(0, Number(sinceTs) || 0), Math.max(1, Math.min(500, Number(limit) || 30))).map(row => {
      let payload = null;
      try { payload = JSON.parse(row.payload); } catch { payload = null; }
      return { id:row.id, ts:row.ts, kind:row.kind, symbol:row.symbol, payload };
    }).filter(x => x.payload);
  }
  function getJournal(limit = 50) {
    return list.all(Math.max(1, Math.min(200, Number(limit) || 50))).map(x => ({ ...x, payload: JSON.parse(x.payload) }));
  }
  function label(id, value) {
    if (!/^[0-9a-f-]{36}$/.test(id) || !['WIN', 'LOSS', 'FLAT', 'INVALIDATED'].includes(value)) throw new Error('invalid label');
    const r = outcome.run(value, id);
    return r.changes === 1;
  }
  function learning() {
    const rows = db.prepare('SELECT kind,outcome,COUNT(*) AS count FROM journal GROUP BY kind,outcome').all();
    return { source: 'explicit journal labels only', rows, changesAppliedToTrading: false };
  }
  function recordLearning(kind,symbol,payload={}){
    const k=String(kind||'').toUpperCase();
    if(!/^[A-Z0-9_]{2,40}$/.test(k))throw new Error('invalid learning kind');
    const body=payload&&typeof payload==='object'?payload:{};
    const side=String(body.side||body.plan?.side||'').toUpperCase();
    const setup=String(body.setup||body.plan?.setup||'').slice(0,120)||null;
    const originTF=String(body.originTF||body.plan?.originTF||'').slice(0,8)||null;
    const ownerTF=String(body.ownerTF||body.plan?.ownerTF||'').slice(0,8)||null;
    const decision=String(body.decision||body.action||body.plan?.status||'').slice(0,80)||null;
    const rawConfidence=body.confidence??body.plan?.confidence;
    const confidence=rawConfidence===null||rawConfidence===undefined||(typeof rawConfidence==='string'&&rawConfidence.trim()==='')
      ? null : Number(rawConfidence);
    const rawOutcome=body.outcomePct;
    // LEARNING_NULL_OUTCOME_GUARD: null is unknown, never a synthetic 0% result.
    const outcomePct=rawOutcome===null||rawOutcome===undefined||(typeof rawOutcome==='string'&&rawOutcome.trim()==='')
      ? null : Number(rawOutcome);
    const safe=JSON.stringify(body).slice(0,32000);
    const id=crypto.randomUUID();
    learnInsert.run(id,Date.now(),k,symbol||null,['LONG','SHORT'].includes(side)?side:null,setup,originTF,ownerTF,decision,Number.isFinite(confidence)?confidence:null,Number.isFinite(outcomePct)?outcomePct:null,safe);
    return id;
  }
  function learningContext({symbol=null}={}){
    const key=symbol&&/^[A-Z0-9]{2,28}$/.test(symbol)?symbol:null;
    const recent=learnRecent.all(key,key,20);
    const stats=learnStats.all().map(x=>({...x,winRate:x.samples?Number((100*Number(x.wins||0)/x.samples).toFixed(1)):null,avgOutcomePct:x.avgOutcomePct==null?null:Number(Number(x.avgOutcomePct).toFixed(4))}));
    return {
      source:'BrainHub ölçülebilir işlem/karar geçmişi',
      recent,
      stats,
      changesAppliedToHardRisk:false,
      note:'Öğrenme yalnız yumuşak bağlamdır; stop, risk, kill-switch, stale ve execution güvenliklerini değiştiremez.'
    };
  }
  function lease(action, resource, owner, token, ttlMs = 30000) {
    if (!/^[A-Z0-9:_-]{2,50}$/.test(resource) || !/^[A-Za-z0-9:_-]{2,50}$/.test(owner) || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new Error('invalid lease fields');
    const ttl = Math.max(5000, Math.min(120000, Number(ttlMs) || 30000));
    const now = Date.now(), tokenHash = hash(token);
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = leaseGet.get(resource);
      let result;
      if (action === 'acquire') {
        if (current && current.expires_at > now && (current.owner !== owner || current.token_hash !== tokenHash)) result = { acquired: false, owner: current.owner, expiresAt: current.expires_at };
        else { leaseSet.run(resource, owner, tokenHash, now + ttl, now); result = { acquired: true, owner, expiresAt: now + ttl }; }
      } else if (action === 'renew') {
        if (!current || current.expires_at <= now || current.owner !== owner || current.token_hash !== tokenHash) result = { acquired: false, reason: 'LEASE_NOT_OWNED' };
        else { leaseSet.run(resource, owner, tokenHash, now + ttl, now); result = { acquired: true, owner, expiresAt: now + ttl }; }
      } else if (action === 'release') {
        result = { released: leaseDelete.run(resource, tokenHash).changes === 1 };
      } else {
        throw new Error('invalid lease action');
      }
      db.exec('COMMIT');
      return result;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function claim(eventId, owner, resource, token, lineageId = eventId) {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(eventId)) throw new Error('invalid event id');
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(lineageId)) throw new Error('invalid lineage id');
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = leaseGet.get(resource);
      let result;
      if (!current || current.expires_at <= now || current.owner !== owner || current.token_hash !== hash(token)) {
        result = { claimed: false, reason: 'NO_VALID_LEASE' };
      } else {
        const originalEvent = claimGet.get(eventId);
        if (originalEvent) {
          result = { claimed: false, reason: 'DUPLICATE', original: originalEvent };
        } else {
          const originalLineage = lineageGet.get(lineageId);
          if (originalLineage) {
            result = { claimed: false, reason: 'DUPLICATE_LINEAGE', original: originalLineage };
          } else {
            claimInsert.run(eventId, owner, now);
            lineageInsert.run(lineageId, eventId, owner, now);
            result = { claimed: true, lineageId };
          }
        }
      }
      db.exec('COMMIT');
      return result;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function releaseClaim(eventId, owner, resource, token, lineageId = eventId) {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(eventId)) throw new Error('invalid event id');
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(lineageId)) throw new Error('invalid lineage id');
    if (!/^[A-Z0-9:_-]{2,50}$/.test(resource) || !/^[A-Za-z0-9:_-]{2,50}$/.test(owner) || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new Error('invalid release fields');
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = leaseGet.get(resource);
      if (!current || current.owner !== owner || current.token_hash !== hash(token)) {
        db.exec('COMMIT');
        return { released:false, reason:'LEASE_IDENTITY_MISMATCH' };
      }
      const event = claimGet.get(eventId);
      const lineage = lineageGet.get(lineageId);
      if (!event || event.owner !== owner) {
        db.exec('COMMIT');
        return { released:false, reason:'CLAIM_NOT_OWNED' };
      }
      if (!lineage || lineage.owner !== owner || lineage.event_id !== eventId) {
        db.exec('COMMIT');
        return { released:false, reason:'LINEAGE_NOT_OWNED' };
      }
      lineageDelete.run(lineageId, eventId, owner);
      claimDelete.run(eventId, owner);
      db.exec('COMMIT');
      return { released:true, eventId, lineageId };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  return { db, journal, getJournal, latestJournal, recentJournal, label, learning, recordLearning, learningContext, lease, claim, releaseClaim };
}
module.exports = { openStore };
