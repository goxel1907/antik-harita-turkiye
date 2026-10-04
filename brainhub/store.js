'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { reconcileCloses,enrichCloses } = require('./office-performance');
const tradeLessonsLib = require('./trade-lessons');
const caseMemoryLib = require('./case-memory');
const {learningQuality}=require('./learning-quality');

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
  // Read-time reconciliation only: raw learning history remains unchanged.
  db.exec('CREATE TEMP TABLE excluded_learning_close_ids(id TEXT PRIMARY KEY); CREATE TEMP VIEW canonical_learning_events AS SELECT * FROM learning_events WHERE id NOT IN (SELECT id FROM excluded_learning_close_ids)');
  const learnRecent=db.prepare('SELECT ts,kind,symbol,side,setup,origin_tf AS originTF,owner_tf AS ownerTF,decision,confidence,outcome_pct AS outcomePct FROM canonical_learning_events WHERE (? IS NULL OR symbol=?) ORDER BY ts DESC LIMIT ?');
  const learnByKind=db.prepare('SELECT ts,kind,symbol,side,setup,origin_tf AS originTF,owner_tf AS ownerTF,decision,confidence,outcome_pct AS outcomePct,payload FROM canonical_learning_events WHERE kind=? AND (? IS NULL OR symbol=?) ORDER BY ts DESC LIMIT ?');
  // Only measured POSITION_CLOSED rows count as PnL samples. JEV_LESSON may carry the same
  // outcomePct for context, but must never double-count the underlying trade in win/loss stats.
  const learnStats=db.prepare("SELECT side,setup,origin_tf AS originTF,owner_tf AS ownerTF,COUNT(*) AS samples,AVG(outcome_pct) AS avgOutcomePct,SUM(CASE WHEN outcome_pct>0 THEN 1 ELSE 0 END) AS wins FROM canonical_learning_events WHERE kind='POSITION_CLOSED' AND outcome_pct IS NOT NULL GROUP BY side,setup,origin_tf,owner_tf ORDER BY samples DESC LIMIT 20");
  const learnLifetime=db.prepare("SELECT COUNT(*) AS samples,SUM(CASE WHEN outcome_pct>0 THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN outcome_pct<0 THEN 1 ELSE 0 END) AS losses,SUM(CASE WHEN outcome_pct=0 THEN 1 ELSE 0 END) AS flats,AVG(outcome_pct) AS avgOutcomePct FROM canonical_learning_events WHERE kind='POSITION_CLOSED' AND outcome_pct IS NOT NULL");
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
  function officeRecords() {
    return db.prepare("SELECT id,ts,kind,symbol,payload FROM journal WHERE kind IN ('POSITION_CLOSED','R2542_OFFICE_EVENT','LIVE_EXECUTION','JEV_POSITION_EXECUTION') ORDER BY ts DESC").all().map(x=>({...x,payload:JSON.parse(x.payload)}));
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
    // R2544.19: learning_events payload must stay valid JSON even when an immutable entryCase is attached.
    // Never byte-slice JSON: that silently turns a rich close record into an unparsable object.
    let learningBody=body;
    let safe=JSON.stringify(learningBody);
    if(safe.length>30000){
      const ec=body.entryContext&&typeof body.entryContext==='object'?body.entryContext:{};
      learningBody={
        ...body,
        entryContext:{...ec,entryCase:ec.entryCase?caseMemoryLib.compactEntryCase(ec.entryCase):null},
        outcomePath:body.outcomePath&&typeof body.outcomePath==='object'?{
          ...body.outcomePath,
          events:Array.isArray(body.outcomePath.events)?body.outcomePath.events.slice(-24):[]
        }:body.outcomePath
      };
      safe=JSON.stringify(learningBody);
    }
    if(safe.length>32000){
      // Last resort is still structured/parseable and preserves the decision/outcome facts used by learning.
      learningBody={
        symbol:body.symbol||symbol||null,side:body.side||null,netPnl:body.netPnl??null,rMultiple:body.rMultiple??null,
        riskQuote:body.riskQuote??null,initialQuantity:body.initialQuantity??body.quantity??null,exitType:body.exitType||null,
        holdMinutes:body.holdMinutes??null,openedAt:body.openedAt||null,closedAt:body.closedAt||null,eventId:body.eventId||null,
        tradeLane:body.tradeLane||null,originTF:body.originTF||null,ownerTF:body.ownerTF||null,
        entryContext:body.entryContext?{
          setupFamily:body.entryContext.setupFamily||null,lane:body.entryContext.lane||null,entryTiming:body.entryContext.entryTiming||null,
          why:body.entryContext.why||null,attention:body.entryContext.attention||null,
          entryCase:body.entryContext.entryCase?caseMemoryLib.compactEntryCase(body.entryContext.entryCase):null
        }:null,
        outcomePath:body.outcomePath?{
          mfeR:body.outcomePath.mfeR??null,maeR:body.outcomePath.maeR??null,timeToMfeMin:body.outcomePath.timeToMfeMin??null,
          timeToMaeMin:body.outcomePath.timeToMaeMin??null,netPnl:body.outcomePath.netPnl??body.netPnl??null,
          rMultiple:body.outcomePath.rMultiple??body.rMultiple??null,exitType:body.outcomePath.exitType||body.exitType||null,
          captureEfficiency:body.outcomePath.captureEfficiency??null,mfeGivebackR:body.outcomePath.mfeGivebackR??null,excursionSource:body.outcomePath.excursionSource??null,
          events:Array.isArray(body.outcomePath.events)?body.outcomePath.events.slice(-12):[]
        }:null
      };
      safe=JSON.stringify(learningBody);
    }
    const id=crypto.randomUUID();
    learnInsert.run(id,Date.now(),k,symbol||null,['LONG','SHORT'].includes(side)?side:null,setup,originTF,ownerTF,decision,Number.isFinite(confidence)?confidence:null,Number.isFinite(outcomePct)?outcomePct:null,safe);
    return id;
  }
  function safeLearningPayload(raw){
    try{
      const x=JSON.parse(String(raw||'{}'));
      return x&&typeof x==='object'&&!Array.isArray(x)?x:{};
    }catch{return {};}
  }
  // CLAUDE_R2544_16_TRADE_LESSONS: kapanan her işlem için deterministik ders kartı + bütün geçmişin özeti.
  // Dikkat katmanı (ilk 3 / 4–10 / aday …) yeni kayıtlarda entryContext.attention'dan, eskilerde giriş anındaki PLAN /
  // LEADER_AUTO_ATTEMPT adayından (±20 dk) bulunur. Kartlar kapanış sayısı değişmedikçe önbellekten gelir.
  const attnNear=db.prepare("SELECT kind,ts,payload FROM journal WHERE kind IN ('PLAN','LEADER_AUTO_ATTEMPT') AND symbol=? AND ts<=? AND ts>=? ORDER BY ts DESC LIMIT 4");
  const attnCache=new Map();
  let lessonCache={key:null,cards:[]};
  function attentionForClose(p){
    const key=p.id||p.eventId||(p.symbol+'|'+p.openedAt);
    if(attnCache.has(key))return attnCache.get(key);
    let att=null;
    const o=Date.parse(p.openedAt||'');
    if(p.symbol&&Number.isFinite(o)){
      try{
        for(const row of attnNear.all(p.symbol,o+10000,o-20*60000)){
          let q=null;try{q=JSON.parse(row.payload);}catch{q=null;}
          const c=q&&q.candidate;
          if(c&&typeof c==='object'&&(c.attentionSource||Array.isArray(c.targetSources))){att=tradeLessonsLib.attentionFromCandidate(c);break;}
        }
      }catch{att=null;}
    }
    attnCache.set(key,att);
    return att;
  }
  function closeExecutionRecords(){return db.prepare("SELECT id,ts,kind,symbol,payload FROM journal WHERE kind IN ('LIVE_EXECUTION','JEV_POSITION_EXECUTION') ORDER BY ts").all().map(x=>({...x,payload:safeLearningPayload(x.payload)}));}
  function closeEvidenceKey(){const x=db.prepare("SELECT COUNT(*) AS n,MAX(rowid) AS last FROM journal WHERE kind IN ('LIVE_EXECUTION','JEV_POSITION_EXECUTION')").get();return ':'+x.n+':'+x.last;}
  function tradeLessonCards(){
    const raw=db.prepare("SELECT id,ts,symbol,payload FROM journal WHERE kind='POSITION_CLOSED' ORDER BY ts").all();
    const key=raw.length+':'+(raw.length?raw[raw.length-1].id:'')+closeEvidenceKey();
    if(lessonCache.key===key)return lessonCache.cards;
    const rows=raw.map(x=>{let p={};try{p=JSON.parse(x.payload)||{};}catch{p={};}return learningQuality({...p,id:x.id,ts:x.ts,symbol:x.symbol});});
    const trades=reconcileCloses(enrichCloses(rows,closeExecutionRecords()).map(learningQuality)).trades;
    const cards=tradeLessonsLib.buildCards(trades,{attentionOf:attentionForClose});
    lessonCache={key,cards};
    return cards;
  }
  function tradeLessons({symbol=null,candidate=null,limit=40}={}){
    try{
      const cards=tradeLessonCards();
      return {cards:cards.slice(-Math.max(1,Math.min(400,Number(limit)||40))),digest:tradeLessonsLib.digest(cards,{symbol,candidate}),total:cards.length};
    }catch(e){return {cards:[],digest:null,total:0,error:String(e?.message||e).slice(0,160)};}
  }
  let caseTradeCache={key:null,trades:[]};
  function caseTrades(){
    const raw=db.prepare("SELECT id,ts,symbol,payload FROM journal WHERE kind='POSITION_CLOSED' ORDER BY ts").all();
    const ck=raw.length+':'+(raw.length?raw[raw.length-1].id:'')+closeEvidenceKey();
    if(caseTradeCache.key===ck)return caseTradeCache.trades;
    const rows=raw.map(x=>{let q={};try{q=JSON.parse(x.payload)||{};}catch{q={};}return learningQuality({...q,id:x.id,ts:x.ts,symbol:x.symbol});});
    const trades=reconcileCloses(enrichCloses(rows,closeExecutionRecords()).map(learningQuality)).trades;caseTradeCache={key:ck,trades};return trades;
  }
  function caseMemory({currentCase=null,symbol=null,limit=5}={}){
    try{return caseMemoryLib.analogDigest(caseTrades(),{currentCase,limit});}
    catch(e){return {version:'R2544.21',available:false,reason:'CASE_MEMORY_ERROR',detail:String(e?.message||e).slice(0,160),analogs:[],executionAuthority:false};}
  }
  function learningContext({symbol=null,candidate=null,unified=null}={}){
    const closes=db.prepare("SELECT id,ts,symbol,payload FROM learning_events WHERE kind='POSITION_CLOSED' ORDER BY ts").all().map(x=>({...safeLearningPayload(x.payload),id:x.id,ts:x.ts,symbol:x.symbol}));
    const enrichedCloses=enrichCloses(closes,closeExecutionRecords());
    const enrichedById=new Map(enrichedCloses.map(x=>[x.id,x]));
    const excluded=reconcileCloses(enrichedCloses).excluded;
    db.exec('DELETE FROM excluded_learning_close_ids');
    const exclude=db.prepare('INSERT OR IGNORE INTO excluded_learning_close_ids(id) VALUES(?)');
    for(const x of excluded)exclude.run(x.id);
    const key=symbol&&/^[A-Z0-9]{2,28}$/.test(symbol)?symbol:null;
    const recent=learnRecent.all(key,key,20);
    const stats=learnStats.all().map(x=>({...x,winRate:x.samples?Number((100*Number(x.wins||0)/x.samples).toFixed(1)):null,avgOutcomePct:x.avgOutcomePct==null?null:Number(Number(x.avgOutcomePct).toFixed(4))}));
    const life=learnLifetime.get()||{};
    const lifetime={
      measuredSamples:Number(life.samples||0),wins:Number(life.wins||0),losses:Number(life.losses||0),flats:Number(life.flats||0),
      winRatePct:Number(life.samples||0)>0?Number((100*Number(life.wins||0)/Number(life.samples)).toFixed(1)):null,
      avgOutcomePct:life.avgOutcomePct==null?null:Number(Number(life.avgOutcomePct).toFixed(4)),
      representation:'ALL_MEASURED_POSITION_CLOSED_ROWS_AGGREGATED'
    };
    // CLAUDE_R2543_LEARNING_R_GUARD: ham kayıt silinmez; yalnız ÖLÇÜLEMEZ R'ler JEV'e "ölçülmüş sonuç"
    // gibi verilmez. Kalan-miktar hatasından gelen R=0 ve şişmiş |R|>20 değerleri null + durum etiketiyle gider.
    const canonicalR=p=>{
      const r=Number(p?.rMultiple), risk=Number(p?.riskQuote), qty=Number(p?.initialQuantity??p?.quantity);
      const basisOk=typeof p?.riskBasis==='string'&&!/QUANTITY_UNAVAILABLE|REMAINING_FALLBACK/.test(p.riskBasis);
      if(!Number.isFinite(risk)||risk<=0||!Number.isFinite(qty)||qty<=0)return {rMultiple:null,rStatus:'UNMEASURED_INVALID_RISK_BASIS'};
      if(!Number.isFinite(r))return {rMultiple:null,rStatus:'UNMEASURED_NO_R'};
      if(Math.abs(r)>20)return {rMultiple:null,rStatus:'REJECTED_OUTLIER_R'};
      return {rMultiple:Number(r.toFixed(4)),rStatus:p?.riskBasis?(basisOk?'MEASURED':'MEASURED_WEAK_BASIS'):'MEASURED_LEGACY'};
    };
    const measuredOutcomes=learnByKind.all('POSITION_CLOSED',key,key,24).map(row=>{
      const p=learningQuality(enrichedById.get(row.id)||safeLearningPayload(row.payload)), ec=p.entryContext&&typeof p.entryContext==='object'?p.entryContext:{};
      const cr=canonicalR(p);
      return {
        ts:row.ts,kind:row.kind,symbol:row.symbol,side:row.side,setup:row.setup,originTF:row.originTF,ownerTF:row.ownerTF,
        setupFamily:ec.setupFamily||p.setupFamily||null,entryTiming:ec.entryTiming||p.entryTiming||null,
        edgeBasis:ec.edgeBasis||p.edgeBasis||null,contractVersion:ec.contractVersion||p.contractVersion||null,
        outcomePct:row.outcomePct,rMultiple:cr.rMultiple,rStatus:cr.rStatus,rawRMultiple:p.rMultiple??null,
        riskBasis:p.riskBasis||null,netPnl:p.netPnl??null,exitType:p.exitType||null,
        lane:p.tradeLane||ec.lane||null,holdMinutes:p.holdMinutes??null,
        marketSignature:ec.marketSignature||null,
        qualityWarnings:p.qualityWarnings,recordedExitType:p.recordedExitType||null,
        outcomePath:p.outcomePath?{mfeR:p.outcomePath.mfeR??null,maeR:p.outcomePath.maeR??null,captureEfficiency:p.outcomePath.captureEfficiency??null,mfeGivebackR:p.outcomePath.mfeGivebackR??null,timeToMfeMin:p.outcomePath.timeToMfeMin??null,timeToMaeMin:p.outcomePath.timeToMaeMin??null,excursionSource:p.outcomePath.excursionSource||null}:null
      };
    });
    const jevLessons=learnByKind.all('JEV_LESSON',key,key,24).map(row=>{
      const p=safeLearningPayload(row.payload);
      return {
        ts:row.ts,kind:row.kind,symbol:row.symbol,side:row.side,setup:row.setup,originTF:row.originTF,ownerTF:row.ownerTF,
        setupFamily:p.setupFamily||null,entryTiming:p.entryTiming||null,edgeBasis:p.edgeBasis||null,contractVersion:p.contractVersion||null,
        lessonFocus:p.lessonFocus||null,evidenceFocus:p.evidenceFocus||null,lessonAction:p.lessonAction||null,scope:p.scope||null,
        marketSignature:p.marketSignature||null
      };
    });
    let tradeLessonDigest=null;
    try{tradeLessonDigest=tradeLessons({symbol:key,candidate}).digest;}catch{tradeLessonDigest=null;}
    let caseMemoryDigest=null,caseMemoryByLane=null;
    try{
      const currentCase=unified?caseMemoryLib.buildCurrentCase({unified,candidate,side:null}):null;
      caseMemoryDigest=caseMemory({currentCase,symbol:key,limit:5});
      if(unified){
        caseMemoryByLane={};
        for(const [side,lane,ownerTF] of [['LONG','5M_SCALP','5m'],['SHORT','5M_SCALP','5m'],['LONG','15M_TRADE','15m'],['SHORT','15M_TRADE','15m']]){
          const c=caseMemoryLib.buildCurrentCase({unified,candidate,side});
          c.decision={side,lane,ownerTF,setupFamily:null,entryTiming:null,edgeBasis:null};
          const d=caseMemory({currentCase:c,symbol:key,limit:3});
          caseMemoryByLane[side+'_'+lane]=caseMemoryLib.compactAnalogDigest(d,1800);
        }
      }
    }catch{caseMemoryDigest=null;caseMemoryByLane=null;}
    const burstExperience=learnByKind.all('BURST_CLOSED',key,key,8).map(row=>{
      const p=safeLearningPayload(row.payload);
      return {ts:row.ts,symbol:row.symbol,side:p.side||null,burstId:p.burstId||null,exitReason:p.exitReason||null,mfeR:p.mfeR??null,maeR:p.maeR??null,realizedR:p.realizedR??null,captureEfficiency:p.captureEfficiency??null,authority:p.authority||null,measurement:'GROSS_PRICE_PATH_NOT_FEE_RECONCILED_NET_PNL'};
    });
    return {
      source:'BrainHub ölçülebilir işlem/karar geçmişi',
      burstExperience,
      burstDecisions:learnByKind.all('BURST_PREAUTH_REVIEW',key,key,8).map(row=>{const p=safeLearningPayload(row.payload);return {ts:row.ts,symbol:row.symbol,decision:p.decision,reason:p.reason,side:p.side,preMove:p.preMove,streamAvailable:p.streamAvailable,l2Ready:p.l2Ready,measurement:'DECISION_TRACE_NOT_TRADE_OUTCOME',authority:'SOFT_CONTEXT_ONLY'};}),
      tradeLessons:tradeLessonDigest,
      caseMemory:caseMemoryDigest,
      caseMemoryByLane,
      excludedDuplicateCloses:excluded.length,
      recent,
      lifetime,
      stats,
      measuredOutcomes,
      jevLessons,
      measuredSampleCount:lifetime.measuredSamples,
      recentMeasuredDetailCount:measuredOutcomes.length,
      jevLessonCount:jevLessons.length,
      recentJevLessonCount:jevLessons.length,
      jevLessonTotalCount:Number(db.prepare("SELECT COUNT(*) AS n FROM canonical_learning_events WHERE kind='JEV_LESSON'").get().n),
      changesAppliedToHardRisk:false,
      rMeasurementPolicy:'rMultiple yalnız geçerli ilk-miktar/ilk-stop tabanı varsa ölçülmüş sayılır; rStatus UNMEASURED_* veya REJECTED_OUTLIER_R olan satırlar R kanıtı olarak kullanılamaz (ham kayıt korunur, rawRMultiple alanında).',
      note:'Lifetime özeti bütün ölçülmüş POSITION_CLOSED geçmişini temsil eder; son 24 kapanış ve son 24 JEV lesson ayrıntı olarak taşınır. R2544.19+ caseMemory aynı isimli setupı otomatik kural yapmaz; R2544.21 ayrıca giriş-öncesi mikroyapı durumunu pencere örnek güveniyle kalibre eder; entry-state benzerliğine göre kazanan ve kaybeden örnekleri birlikte gösterir. JEV_LESSON ve CASE_MEMORY yalnız yumuşak bağlamdır; hard risk/kill-switch/execution güvenliğini değiştiremez.'
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

  return { db, officeRecords, journal, getJournal, latestJournal, recentJournal, label, learning, recordLearning, learningContext, tradeLessons, caseMemory, lease, claim, releaseClaim };
}
module.exports = { openStore };
