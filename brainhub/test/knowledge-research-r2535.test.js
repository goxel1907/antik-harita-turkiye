'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createKnowledgeResearch}=require('../knowledge-research');

function tempRoot(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-knowledge-r2535-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}

test('R2535 persists researched knowledge only after source fetch and JEV verification',async t=>{
  const root=tempRoot(t);
  const source='https://www.cmegroup.com/education/courses/technical-analysis/chart-patterns.html';
  let routerCalls=0,openCalls=0,jevCalls=0;
  const worker=name=>async({prompt})=>{
    if(name==='router')routerCalls++; else openCalls++;
    const grounded=String(prompt).includes('VERIFIED_SOURCE_EXCERPTS');
    return {
      model:name+'/free-test',
      text:JSON.stringify(grounded
        ? {summary:'Symmetrical triangle is a contracting chart pattern; direction requires breakout evidence.',keyPoints:['Contraction alone does not establish direction.'],sourceUrls:[]}
        : {summary:'Research candidate.',keyPoints:['Verify with source.'],sourceUrls:[source]})
    };
  };
  const desk=createKnowledgeResearch({
    root,
    routerResearch:worker('router'),
    openRouterResearch:worker('openrouter'),
    jevReview:async payload=>{
      jevCalls++;
      assert.equal(payload.topic,'SYMMETRICAL_TRIANGLE');
      assert.equal(payload.family,'PATTERN');
      assert.equal(payload.sources.length,1);
      return {ok:true,verdict:'ACCEPT_REFERENCE'};
    },
    fetchImpl:async url=>({
      ok:String(url)===source,
      async text(){return '<html><body>CME technical analysis futures trading chart pattern. A symmetrical triangle is a contracting market price pattern. Breakout evidence and risk management matter.</body></html>';}
    }),
    clock:()=>1000000
  });

  const result=await desk.research({topic:'SYMMETRICAL_TRIANGLE',family:'PATTERN'});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.status,'VERIFIED_REFERENCE');
  assert.equal(routerCalls,2);
  assert.equal(openCalls,2);
  assert.equal(jevCalls,1);
  const ref=desk.reference();
  assert.equal(ref.length,1);
  assert.equal(ref[0].topic,'SYMMETRICAL_TRIANGLE');
  assert.deepEqual(ref[0].sourceUrls,[source]);
  const disk=JSON.parse(fs.readFileSync(path.join(root,'data','jev-knowledge.json'),'utf8'));
  assert.equal(disk.entries[0].selfModify,false);
  assert.equal(disk.entries[0].autoPromotionToRules,false);
  assert.equal(disk.entries[0].executionAuthority,false);
});

test('R2535 does not persist research when no allowlisted source can be fetched',async t=>{
  const root=tempRoot(t);
  const worker=async()=>({model:'free-test',text:JSON.stringify({summary:'Claim only.',keyPoints:['Claim only.'],sourceUrls:[]})});
  const desk=createKnowledgeResearch({
    root,routerResearch:worker,openRouterResearch:worker,
    jevReview:async()=>({ok:true,verdict:'ACCEPT_REFERENCE'}),
    fetchImpl:async()=>({ok:false,async text(){return ''}})
  });
  const result=await desk.research({topic:'UNKNOWN_PATTERN',family:'PATTERN'});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'NO_VERIFIED_SOURCE_FETCHED');
  assert.equal(desk.reference().length,0);
});
