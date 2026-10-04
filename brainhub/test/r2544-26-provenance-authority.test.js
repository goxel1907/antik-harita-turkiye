'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {CURATED_OPEN_SOURCE_REPOS}=require('../knowledge-research');

test('R2544.26 OSS provenance keeps research/shadow authority explicit',()=>{
  assert.equal(CURATED_OPEN_SOURCE_REPOS.length,29);
  const by=new Map(CURATED_OPEN_SOURCE_REPOS.map(x=>[x.repo,x]));
  const expected={
    'Khaymat/pyvsmc':['OFFLINE_ORACLE','REFERENCE_ONLY'],
    'JWHaan/quant.term':['REFERENCE_ADOPTED','REFERENCE_ONLY'],
    'crisari666/liquidity-scanner':['HISTORICAL_CONCEPT_ADOPTED','REFERENCE_ONLY'],
    'AIUngated/crypto-liquidity-terminal':['ARCHITECTURE_ADAPTED','REFERENCE_ONLY'],
    'minchillo4/btc-liquidation-heatmap':['SHADOW_MODEL_REFERENCE','SHADOW_EVIDENCE_ONLY']
  };
  for(const [repo,[status,authority]] of Object.entries(expected)){
    assert.ok(by.has(repo),repo);
    assert.equal(by.get(repo).integrationStatus,status,repo);
    assert.equal(by.get(repo).authority,authority,repo);
  }
  assert.equal(by.has('mindoozer/liquidation-map'),false);
  assert.equal(by.has('QuantFlowLab/crypto-orderflow-research'),false);
});

test('Office exposes integration status, local L2 and modeled liquidation semantics',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8');
  assert.match(html,/Entegrasyon/);
  assert.match(html,/Yerel L2/);
  assert.match(html,/Modeled likidasyon/);
  assert.match(html,/observed=false/);
});
