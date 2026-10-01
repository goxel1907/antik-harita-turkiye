'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {modeledLiquidationDensityFromOi}=require('../market');
function rows(){const out=[];let q=100000,p=100;for(let i=0;i<360;i++){const normal=i===300?1800:100;q+=normal;p*=i===300?1.01:1.00005;out.push({sumOpenInterest:String(q),sumOpenInterestValue:String(q*p),timestamp:i*900000});}return out;}
test('R2544.26 modeled liquidation is explicitly shadow/estimated and separate from observed prints',()=>{
 const x=modeledLiquidationDensityFromOi(rows(),102);
 assert.equal(x.authority,'SHADOW_EVIDENCE_ONLY');assert.equal(x.observed,false);assert.equal(x.estimated,true);assert.equal(x.canVeto,false);assert.equal(x.executionAuthority,false);assert.equal(x.available,true);assert.match(x.semantics,/MODELED_OI_LIQUIDATION_DENSITY/);
 const sum=Object.values(x.density).reduce((a,b)=>a+b,0);assert.ok(sum>0.99&&sum<1.01);
});
test('R2544.26 modeled liquidation refuses insufficient history instead of fabricating',()=>{
 const x=modeledLiquidationDensityFromOi(rows().slice(0,100),102);assert.equal(x.available,false);assert.equal(x.reason,'INSUFFICIENT_60H_OI_HISTORY');assert.equal(x.canVeto,false);
});
