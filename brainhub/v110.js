'use strict';

const V110=Object.freeze({
  marker:'V110_MULTILANE_MOMENTUM',
  featureVersion:'9.5.110-VISION',
  androidVersionName:'9.5.110',
  androidVersionCode:26092105,
  builtBy:'OpenAI GPT-5.6 Sol • v9.5.109-CLAUDE doğrulanmış tabanı • 2026-09-21',
  base:'v9.5.109-CLAUDE@244873b + multilane momentum',
  features:[
    'V110_MULTILANE_15M_SCALP',
    'V110_SCALP_TWO_OF_THREE',
    'V110_MOMENTUM_LADDER',
    'V110_NUMERIC_TRIGGER_H8',
    'V110_JEV_SHADOW_VISIBLE',
    'V110_VISION_15M_PRIORITY_PROFILE',
    'V110_OFFICE_LANE_UI'
  ],
  tradeLanePolicy:{
    mainTradeTimeframe:'15m',
    scalpTimeframes:['1m','3m','5m'],
    scalpMinimumAligned:2,
    scalpRequiresFresh15mContext:true,
    scalpBlockedByHard15mOpposition:true,
    contextTimeframes:['30m','45m','1h','4h','1d'],
    higherTimeframesAreContextNotVotes:true,
    longShortSymmetric:true
  },
  visionProfile:{
    scalp:{width:640,height:360},
    main15m:{width:896,height:504},
    context:{width:640,height:360},
    batchSize:3,
    singleTfFallback:true
  }
});

module.exports=V110;
