'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2536 sovereign Vision is explicitly evidence-only and does not require legacy global plan schema',()=>{
  const pipeline=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(pipeline,/role:'STRUCTURE',\s*evidenceOnly:true,\s*system:'You are a Vision EVIDENCE_ONLY worker for JEV/);
  assert.match(server,/if\(j\.evidenceOnly===true\)/);
  assert.match(server,/VISION_AUTHORITY: EVIDENCE_ONLY/);
  assert.match(server,/JEV_VISION_EVIDENCE_ONLY_NO_PLAN_SCHEMA/);
  const evidenceBranch=server.indexOf('if(j.evidenceOnly===true)');
  const finalizer=server.indexOf("const finalizeStarted=Date.now()",evidenceBranch);
  assert.ok(evidenceBranch>=0&&finalizer>evidenceBranch);
  assert.match(server.slice(evidenceBranch,finalizer),/return \{/);
});

test('R2536 legacy/local plan Vision still retains deterministic core-level repair',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/deterministicCoreLevelRepair\(coreContract,finalizeContext\)/);
  assert.match(server,/GLOBAL_CORE_CONTRACT missing=/);
});
