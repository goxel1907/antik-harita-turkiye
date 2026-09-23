'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('server exposes a read-only JEV evidence endpoint and professional evidence contract',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const jev=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(server,/\/context\/jev-evidence/);
  assert.match(server,/readOnly:true/);
  assert.match(jev,/JEV is the final strategic authority/);
  assert.match(jev,/professional futures trader\/scalper/);
  assert.match(jev,/market-maker\/iceberg\/spoof\/TWAP labels as probabilistic footprints/);
  assert.match(jev,/Numeric Binance\/BrainHub truth outranks visual interpretation/);
});
