'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
const start=source.indexOf('function top3Why(a){'),end=source.indexOf('function top3Gate(',start);
const why=vm.runInNewContext('('+source.slice(start,end).trim()+')',{finite:v=>Number.isFinite(v)?v:null});
const lot=()=>({lane:'KESIF',side:'LONG',stopPct:.015,kesif:{model:'test/model',record:{n:100,avgR:.1}}});
test('R183 actual formatter distinguishes weak, confirmed and unknown historical eligibility',()=>{
  const weak=lot();weak.entryFeatures={kesif:{weak:true}};const before=JSON.stringify(weak);
  assert.match(why(weak),/ZAYIF aday \(söz sahibi DEĞİL/);assert.equal(JSON.stringify(weak),before);
  const holder=lot();holder.kesif.weak=false;assert.match(why(holder),/model söz sahibi/);
  const unknown=lot();assert.match(why(unknown),/uygunluğu bilinmiyor/);assert.doesNotMatch(why(unknown),/model söz sahibi/);
  const legacy=lot();legacy.kesif.weak=true;assert.match(why(legacy),/ZAYIF aday/);
  const conflict=lot();conflict.kesif.weak=true;conflict.entryFeatures={kesif:{weak:false}};assert.match(why(conflict),/model söz sahibi/);
});
