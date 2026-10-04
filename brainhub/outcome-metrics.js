'use strict';
const number=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function profitGiveback(mfeR,realizedR){
  const mfe=number(mfeR),realized=number(realizedR);
  if(mfe===null||realized===null)return null;
  return mfe>0?Math.max(0,mfe-realized):0;
}
module.exports={profitGiveback};
