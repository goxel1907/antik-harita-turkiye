const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {createJevClient}=require('../jev-decision');

function makeRoot(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-budget-'));
  fs.mkdirSync(path.join(root,'config'),{recursive:true});
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({
    enabled:true,
    model:'typesafe/jev-1.13',
    decisionsUrl:'https://example.test/api/alpha/decisions',
    keyUrl:'https://example.test/api/v1/key',
    mode:'SOVEREIGN_DIRECTOR_5M15M',
    softBudgetUsd:0.002,
    dailyCapUsd:0.01,
    reservePerCallUsd:0.002,
    timeoutMs:5000,
    maxPayloadChars:24000
  }));
  return root;
}

test('R2542 blocks before network when next call cannot be reserved and UTC reset reopens budget',async t=>{
  let now=Date.parse('2026-09-26T16:00:00Z');
  const root=makeRoot();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'data','jev-usage.json'),JSON.stringify({
    day:'2026-09-26',spentUsd:0.009,calls:99,lastAt:'2026-09-26T15:59:00.000Z'
  }));
  let networkCalls=0;
  const client=createJevClient({
    root,
    apiKey:'sk-or-v1-test_key_12345678901234567890',
    clock:()=>now,
    fetchImpl:async()=>{networkCalls++;throw new Error('network must not be called');}
  });

  const before=client.budgetStatus();
  assert.equal(before.remainingUsd>0,true);
  assert.equal(before.remainingUsd<before.reservePerCallUsd,true);
  assert.equal(before.canReserveNextCall,false);
  assert.equal(before.budgetCallBlocked,true);
  assert.equal(before.hardLimitReached,true);
  assert.equal(before.nextResetAt,'2026-09-27T00:00:00.000Z');

  const pass1=await client.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:{}});
  assert.equal(pass1.called,false);
  assert.equal(pass1.attempted,false);
  assert.equal(pass1.reason,'JEV_DAILY_BUDGET_EXHAUSTED');
  assert.equal(networkCalls,0);

  now=Date.parse('2026-09-27T00:00:01Z');
  const after=client.budgetStatus();
  assert.equal(after.spentUsd,0);
  assert.equal(after.calls,0);
  assert.equal(after.canReserveNextCall,true);
  assert.equal(after.hardLimitReached,false);
});

test('R2542 Leader Auto pauses before PASS-1 while JEV reserve is exhausted',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(server,/jevBudgetStatus:jev\.budgetStatus/);
  assert.match(live,/jevBudget\?\.canReserveNextCall===false/);
  assert.match(live,/LEADER_AUTO_JEV_BUDGET_WAIT/);
  assert.match(live,/JEV_DAILY_BUDGET_EXHAUSTED/);
});

console.log('R2542_JEV_BUDGET_COOLDOWN_OK');
