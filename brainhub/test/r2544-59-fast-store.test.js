'use strict';
// R2544.59: officeRecords keeps the parsed rows and reads only rows added since the last call.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openStore}=require('../store');
const {enrichCloses,reconcileCloses,performanceReport}=require('../office-performance');

const direct=store=>store.db.prepare("SELECT id,ts,kind,symbol,payload FROM journal WHERE kind IN ('POSITION_CLOSED','R2542_OFFICE_EVENT','LIVE_EXECUTION','JEV_POSITION_EXECUTION','CLOSE_EXIT_EVIDENCE') ORDER BY ts DESC").all().map(x=>({...x,payload:JSON.parse(x.payload)}));
const sorted=rows=>[...rows].sort((a,b)=>b.ts-a.ts||a.id.localeCompare(b.id));
const deepFreeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);}return o;};

function withStore(fn){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r59-'));
  const store=openStore(root);
  try{return fn(store);}finally{store.db.close();}
}

test('R2544.59 officeRecords: same rows as the full query, new rows appear, other kinds ignored', () => withStore(store => {
  store.journal('R2542_OFFICE_EVENT','BTCUSDT',{kind:'ANALYSIS',n:1});
  store.journal('PLAN','BTCUSDT',{big:'x'.repeat(1000)});
  store.journal('POSITION_CLOSED','ETHUSDT',{side:'LONG',netPnl:1.5});
  const a=store.officeRecords();
  assert.equal(a.length,2);
  assert.deepEqual(sorted(a),sorted(direct(store)));
  store.journal('PLAN','SOLUSDT',{p:1});
  assert.equal(store.officeRecords().length,2,'a non-office row changes nothing');
  store.journal('LIVE_EXECUTION','SOLUSDT',{result:{orderPlaced:true,side:'SHORT'}});
  store.journal('CLOSE_EXIT_EVIDENCE','SOLUSDT',{closedId:'x'});
  const b=store.officeRecords();
  assert.equal(b.length,4);
  assert.deepEqual(sorted(b),sorted(direct(store)));
  for(let i=1;i<b.length;i++)assert.ok(b[i-1].ts>=b[i].ts,'newest first');
}));

test('R2544.59 officeRecords: callers get their own array; repeated calls read nothing new', () => withStore(store => {
  store.journal('POSITION_CLOSED','ETHUSDT',{side:'LONG'});
  const a=store.officeRecords();a.length=0;a.push({kind:'X'});
  assert.equal(store.officeRecords().length,1);
  const r1=store.officeRecords(),r2=store.officeRecords();
  assert.notEqual(r1,r2);
  assert.equal(r1[0],r2[0],'parsed rows are reused, not re-read');
}));

test('R2544.59 consumers never mutate the shared rows (frozen rows pass through enrich/reconcile/performance)', () => withStore(store => {
  const openedAt='2026-10-19T10:00:00.000Z',closedAt='2026-10-19T11:00:00.000Z';
  const exec=store.journal('LIVE_EXECUTION','SOLUSDT',{eventId:'e1',result:{orderPlaced:true,side:'SHORT',quantity:2,avgPrice:100}});
  const closed=store.journal('POSITION_CLOSED','SOLUSDT',{eventId:'e1',side:'SHORT',openedAt,closedAt,exitType:'EXTERNAL_CLOSE',netPnl:-1,rMultiple:-0.5,entryContext:{lane:'5M_SCALP'}});
  store.journal('CLOSE_EXIT_EVIDENCE','SOLUSDT',{closedId:closed,openedAt,closedAt,evidence:{confirmed:true,exitType:'STOP_LOSS'}});
  store.journal('R2542_OFFICE_EVENT','SOLUSDT',{kind:'ANALYSIS',jevCalled:true,jevFinalAction:'SHORT'});
  store.journal('R2542_OFFICE_EVENT','SOLUSDT',{kind:'TICK_RESULT',execution:'LEADER_AUTO_BLOCKED'});
  void exec;
  const records=store.officeRecords();records.forEach(deepFreeze);
  const rows=records.filter(x=>x.kind==='POSITION_CLOSED').map(x=>({symbol:x.symbol,id:x.id,ts:new Date(x.ts).toISOString(),...x.payload}));
  const {trades}=reconcileCloses(enrichCloses(rows,records));
  assert.equal(trades.length,1);
  assert.equal(trades[0].exitType,'STOP_LOSS');
  const rep=performanceReport(records,[],Date.parse(closedAt)+60000);
  assert.ok(rep&&typeof rep==='object');
  const again=store.officeRecords();
  assert.equal(again.find(x=>x.kind==='POSITION_CLOSED').payload.exitType,'EXTERNAL_CLOSE','stored row unchanged');
}));

test('R2544.59 release marker', () => {
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(src('server.js'),/const RUNTIME_RELEASE='R2544.59B-FAST-STORE';/);
  assert.match(src('store.js'),/R2544.59_OFFICE_RECORDS_CACHE/);
  assert.match(src('store.js'),/R2544.59_CLOSE_LIST_CACHE/);
  assert.match(src('store.js'),/CREATE INDEX IF NOT EXISTS learning_events_kind_ts ON learning_events\(kind,ts DESC\)/);
  assert.match(src('jev-brain/JEV-DEPLOY.ps1'),/\$EXPECTED_RELEASE = 'R2544.59B-FAST-STORE'/);
});

test('R2544.59 close lists: cached learningContext/tradeLessons/caseMemory equal a fresh store, and new rows show at once', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r59b-'));
  const a=openStore(root);let b=null;
  const close=(sym,extra)=>{const p={side:'LONG',setup:'X',originTF:'5m',ownerTF:'5m',decision:'CLOSED',outcomePct:1,rMultiple:1,netPnl:2,exitType:'EXTERNAL_CLOSE',openedAt:'2026-10-19T10:00:00.000Z',closedAt:'2026-10-19T11:00:00.000Z',entryContext:{entryCase:{side:'LONG',tf:'5m'}},...extra};
    const id=a.journal('POSITION_CLOSED',sym,p);a.recordLearning('POSITION_CLOSED',sym,p);return id;};
  const view=s=>JSON.stringify({l:s.learningContext({symbol:'AAAUSDT'}),t:s.tradeLessons({symbol:'AAAUSDT',limit:400}),c:s.caseMemory({currentCase:{side:'LONG',tf:'5m'},symbol:'AAAUSDT'})});
  try{
    close('AAAUSDT',{});close('BBBUSDT',{outcomePct:-1,rMultiple:-1,netPnl:-2});
    const first=view(a);assert.equal(view(a),first,'repeat call is stable');
    b=openStore(root);assert.equal(view(b),first,'cached equals a fresh (uncached) store');b.db.close();
    const before=a.tradeLessons({limit:400}).total;
    const id=close('AAAUSDT',{outcomePct:2,rMultiple:2,netPnl:4});
    assert.equal(a.tradeLessons({limit:400}).total,before+1,'a new close appears at once');
    a.journal('CLOSE_EXIT_EVIDENCE','AAAUSDT',{closedId:id,openedAt:'2026-10-19T10:00:00.000Z',closedAt:'2026-10-19T11:00:00.000Z',evidence:{version:'R2544.40',confirmed:true,exitType:'STOP_LOSS'}});
    b=openStore(root);assert.equal(view(a),view(b),'new exit evidence refreshes the cached execution list');b.db.close();b=null;
  }finally{try{a.db.close();}catch{}try{b?.db?.close();}catch{}fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
