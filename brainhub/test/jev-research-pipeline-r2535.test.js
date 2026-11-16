'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2535 knowledge-gap detection runs after evidence collection and before PASS-2, with JEV request metadata',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  const start=src.indexOf('async function runSovereignFlow');
  assert.ok(start>=0);
  const end=src.indexOf('\nasync function run(',start);
  const flow=src.slice(start,end>start?end:undefined);
  const evidence=flow.indexOf('const evidence=await buildSovereignEvidence');
  const research=flow.indexOf('knowledgeResearchResult=await knowledgeResearch');
  const final=flow.indexOf('const final=await decisionFinal');
  assert.ok(evidence>=0&&research>evidence&&final>research,{evidence,research,final});
  assert.match(flow,/if\(typeof knowledgeResearch==='function'\)/);
  assert.match(flow,/familyHint:pass1\.knowledgeResearchRequested===true\?\(pass1\.knowledgeFamily\|\|'AUTO'\):'AUTO'/);
  assert.match(flow,/requestedByJev:pass1\.knowledgeResearchRequested===true/);
});
