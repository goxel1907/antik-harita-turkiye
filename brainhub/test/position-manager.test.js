'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessPosition,capJevExitAction}=require('../position-manager');

function f({trend='UP',bos=null,side='LONG',score=60,fresh=true}={}){
  return {available:true,fresh,trend,breakOfStructure:bos,opportunity:{preferredSide:side,longScore:side==='LONG'?score:10,shortScore:side==='SHORT'?score:10},breakoutExecution:{status:'ACCEPTED'}};
}
test('1m/3m/5m gürültüsü tek başına EXIT_NOW üretemez',()=>{
  const unified={dataQuality:{advisoryUsable:true},frames:{
    '1m':f({trend:'DOWN',bos:'DOWN',side:'SHORT'}),
    '3m':f({trend:'DOWN',bos:'DOWN',side:'SHORT'}),
    '5m':f({trend:'DOWN',bos:'DOWN',side:'SHORT'}),
    '15m':f(), '30m':f(), '1h':f(), '4h':f(), '1d':f()
  }};
  const a=assessPosition({position:{side:'LONG',entryPrice:100,markPrice:104},lifecycle:{originTF:'1m',ownerTF:'15m'},unified});
  assert.equal(a.bigPictureBroken,false);
  assert.equal(capJevExitAction('EXIT_NOW',a),'PROTECT_PROFIT');
});
test('owner + büyük resim bozulursa EXIT_NOW korunabilir',()=>{
  const unified={dataQuality:{advisoryUsable:true},frames:{
    '1m':f(), '3m':f(), '5m':f(),
    '15m':f({trend:'DOWN',bos:'DOWN',side:'SHORT'}),
    '30m':f({trend:'DOWN',bos:'DOWN',side:'SHORT'}),
    '1h':f(), '4h':f(), '1d':f()
  }};
  const a=assessPosition({position:{side:'LONG',entryPrice:100,markPrice:103},lifecycle:{originTF:'3m',ownerTF:'15m'},unified});
  assert.equal(a.bigPictureBroken,true);
  assert.equal(capJevExitAction('EXIT_NOW',a),'EXIT_NOW');
});
test('veri kalitesi yetersizse agresif Jev önerisi uygulanmaz',()=>{
  const a=assessPosition({position:{side:'SHORT',entryPrice:100,markPrice:95},lifecycle:{ownerTF:'30m'},unified:{dataQuality:{advisoryUsable:false},frames:{}}});
  assert.equal(capJevExitAction('EXIT_NOW',a),'HOLD_REVIEW');
});
