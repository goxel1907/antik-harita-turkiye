'use strict';
// R2544.142 (10.11, deploy stopped "Acik pozisyon durumu okunamadi"): after the 07:55Z restart the first officeRecords() call read
// all 126 439 ledger rows and pushed them with a spread (push(...rows)) -> RangeError: Maximum call stack size exceeded on every
// call. /live/positions answered 500 all day, two ZİRVE-5 closes were not booked into the Office ledger (TOP3_CLOSE_UNBOOKED).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {openStore}=require('../store');
test('R2544.142 officeRecords reads a ledger far larger than the call-stack limit (first call after a restart)',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r142-store-'));const s=openStore(root);
  const ins=s.db.prepare('INSERT INTO journal (id,ts,kind,symbol,payload) VALUES (?,?,?,?,?)');
  const N=300000,t0=Date.UTC(2026,9,1);
  s.db.exec('BEGIN');for(let i=0;i<N;i++)ins.run('r'+i,t0+i,'POSITION_CLOSED','X'+(i%50)+'USDT','{"i":'+i+'}');s.db.exec('COMMIT');
  const rows=s.officeRecords();
  assert.equal(rows.length,N);assert.equal(rows[0].payload.i,N-1,'newest first');
  s.journal('POSITION_CLOSED','NEWUSDT',{i:-1});assert.equal(s.officeRecords().length,N+1,'later rows are added on top');
});

test('R2544.142 the deploy guard reads the TEST paper lots from /live/status when /live/positions fails; LIVE stays fail-closed',()=>{
  const d=fs.readFileSync(path.join(__dirname,'..','jev-brain','JEV-DEPLOY.ps1'),'utf8');
  const i=d.indexOf('$pos = Open-Positions $RT'),j=d.indexOf("if ($null -eq $pos) { throw 'Acik pozisyon durumu okunamadi",i),k=d.indexOf("if ($pos.Count -gt 0 -and $tmode -ne 'TEST') { throw",j);
  assert.ok(i>0&&j>i&&k>j,'fallback sits between the read and the fail-closed throw, before the LIVE position rule');
  const f=d.slice(i,j);assert.match(f,/if \(\$null -eq \$pos -and \$tmode -eq 'TEST'\) \{/);assert.match(f,/\$liveState\.tradingMode\.paper\.positions/);
  assert.ok(!/LIVE/.test(f.replace(/LIVE stays fail-closed/,'')),'no LIVE path in the fallback');
});
