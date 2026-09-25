'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2539 PC server rejects remote/mobile live execute while keeping internal scheduler execution path',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(server,/REMOTE_LIVE_EXECUTE_DISABLED_PC_SCHEDULER_ONLY/);
  assert.match(server,/u\.pathname==='\/live\/execute'/);
  assert.doesNotMatch(server,/const out=await live\.execute\(body\|\|\{\}\)/);
  assert.match(server,/ANDROID_REMOTE_EXECUTE_DISABLED_PC_SCHEDULER_ONLY/);
  assert.match(live,/source:'LEADER_AUTO_9TF_JEV_APPROVED'/);
  assert.match(live,/result = await executeExclusive\(/);
});

test('R2539 checked-in Android client cannot POST live execute',()=>{
  const client=fs.readFileSync(path.join(__dirname,'..','..','futures15m_alarm','BrainHubClient.java'),'utf8');
  assert.match(client,/R2539_ANDROID_PC_ONLY_FAIL_CLOSED/);
  assert.match(client,/ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY/);
  assert.doesNotMatch(client,/post\(c, "\/live\/execute", intent, true\)/);
});

test('R2539 final mobile patch hardens auto, manual signed mutations, truth TTL and fail-closed migration',()=>{
  const patch=fs.readFileSync(path.join(__dirname,'..','..','futures15m_alarm','v95121_android_pc_only_fail_closed_r2539.py'),'utf8');
  const truth=fs.readFileSync(path.join(__dirname,'..','..','futures15m_alarm','V95113PcTruth.java'),'utf8');
  assert.match(patch,/R2539_FIRST_RUN_FAIL_CLOSED/);
  assert.match(patch,/R2539_RETRY_PENDING_STOP/);
  assert.match(patch,/historical PHONE Binance executor permanently inert/);
  assert.match(patch,/R2539_ANDROID_SIGNED_MUTATION_DISABLED_PC_ONLY/);
  assert.match(patch,/signed && !\"GET\"\.equalsIgnoreCase\(method\)/);
  assert.match(truth,/FRESH_MS = 15000L/);
  assert.match(truth,/stopNeedsRetry/);
});
