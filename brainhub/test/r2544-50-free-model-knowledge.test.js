'use strict';
// R2544.50 (user 06.10.2026: "make the free models actually work"): research was dead because the free models invented
// source links (BREAKDOWN_CLOSE -> TradingView ATR page) and a 300 kB raw-HTML cut left JavaScript as "source text".
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const K=require('../knowledge-research');

const ENGINE_PATTERNS=['BEAR_FLAG_OR_PENNANT','BEARISH_ENGULFING','BEARISH_HARAMI','BREAKDOWN_CLOSE','BREAKOUT_CLOSE','BULL_FLAG_OR_PENNANT','BULLISH_ENGULFING','BULLISH_HARAMI',
  'BUY_AGGRESSION_ABSORBED_AT_ASK','BUY_SIDE_SWEEP_REJECT','DOJI','DOUBLE_BOTTOM','DOUBLE_TOP','EVENING_STAR','HAMMER_REJECTION','HEAD_AND_SHOULDERS','INSIDE_BAR','INVERSE_HEAD_AND_SHOULDERS',
  'LONG_LIQUIDATION_CASCADE','MARUBOZU','MORNING_STAR','OUTSIDE_BAR','RESISTANCE_FLIP_ACCEPTANCE','SELL_AGGRESSION_ABSORBED_AT_BID','SELL_SIDE_SWEEP_RECLAIM','SHOOTING_STAR_REJECTION',
  'SHORT_LIQUIDATION_CASCADE','SUPPORT_FLIP_ACCEPTANCE','THREE_BLACK_CROWS','THREE_WHITE_SOLDIERS','VOLATILITY_COMPRESSION','RISING_CHANNEL','FALLING_CHANNEL','ASCENDING_TRIANGLE','RISING_WEDGE'];

test('R50 every engine pattern has a curated, pre-verified reference (DISPLACEMENT has none on purpose)',()=>{
  for(const t of ENGINE_PATTERNS){const c=K.curatedSourcesFor(t);assert.ok(c.length,t);for(const s of c){assert.match(s.url,/^https:\/\/en\.wikipedia\.org\/wiki\//);assert.ok(K.allowedUrl(s.url),s.url);assert.equal(s.curated,true);}}
  assert.deepEqual(K.curatedSourcesFor('DISPLACEMENT'),[]);
  assert.equal(K.curatedSourcesFor('BREAKDOWN_CLOSE')[0].title,'Breakout (technical analysis)');
});

test('R50 a model link to the wrong page is rejected; whole words only',()=>{
  const atrPage='Average True Range (ATR) TradingView indicator volatility price trading market header header header close close close';
  assert.equal(K.sourceLooksRelevant('BREAKDOWN_CLOSE',atrPage,'Average True Range (ATR) — TradingView'),false,'05.10 ATR page for BREAKDOWN_CLOSE');
  assert.equal(K.sourceLooksRelevant('INVERSE_HEAD_AND_SHOULDERS',atrPage,'Average True Range (ATR)'),false,"'head' is not 'header'");
  assert.equal(K.sourceLooksRelevant('BREAKDOWN_CLOSE','a breakdown below support with a close under the level; price trading','Breakdown trading guide'),true);
});

function research(fetchImpl,{calls=[]}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r50-kr-'));fs.mkdirSync(path.join(root,'data'));
  // askChannelResilient embeds the source excerpts in the prompt; a grounded call is one that carries them.
  const chan=name=>async a=>{const txt=String(a.prompt||'')+String(a.system||'');const grounded=/SOURCE_1 /.test(txt);calls.push({name,grounded,sourceText:grounded?txt:''});return grounded?{ok:true,text:JSON.stringify({summary:'grounded '+a.topic,keyPoints:['k'],sourceUrls:[]}),model:'m'}:{ok:true,text:JSON.stringify({summary:'x',keyPoints:[],sourceUrls:['https://www.tradingview.com/support/solutions/43000501823-breakout-breakdown/']}),model:'m'};};
  let reviewed=null;
  const r=K.createKnowledgeResearch({root,routerResearch:chan('router'),openRouterResearch:chan('openrouter'),jevReview:async p=>{reviewed=p;return {ok:true,verdict:'ACCEPT_REFERENCE'};},fetchImpl,sleepImpl:async()=>{}});
  return {r,calls,reviewed:()=>reviewed};
}
const res=(status,body,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},text:async()=>body});
const wiki=(title,extract)=>res(200,JSON.stringify({batchcomplete:true,query:{pages:[{pageid:1,ns:0,title,extract}]}}));

test('R50 a mapped topic is grounded on the Wikipedia plain text with no ungrounded model round',async()=>{
  const seen=[];const article='Triangle chart patterns form when price trading converges between a rising support line and a falling resistance line. '.repeat(10);
  const x=research(async u=>{seen.push(u);return /api\.php/.test(u)?wiki(decodeURIComponent(u.split('titles=')[1]),article):res(404,'');});
  const out=await x.r.research({topic:'ASCENDING_TRIANGLE',family:'PATTERN',force:true});
  assert.equal(out.ok,true,JSON.stringify(out));
  assert.equal(x.calls.length,2,'one grounded call per free channel');assert.ok(x.calls.every(c=>c.grounded),'no ungrounded "suggest links" model call');
  assert.ok(seen.every(u=>u.startsWith('https://en.wikipedia.org/w/api.php')));
  assert.match(x.reviewed().sources[0].url,/wiki\/Triangle_\(chart_pattern\)/);assert.match(x.calls[0].sourceText,/converges/);
});

test('R50 HTML is cleaned before it is cut: a page with >300 kB of script still yields its article text',async()=>{
  const html='<html><head><title>Breakdown trading: close below support</title><script>'+'var a=1;'.repeat(60000)+'</script></head><body><article>'+'A breakdown happens when price closes below support; traders watch volume and the retest. '.repeat(8)+'</article></body></html>';
  const x=research(async u=>/api\.php/.test(u)?res(429,'too many',{'retry-after':'60'}):/example/.test(u)?res(404,''):res(200,html));
  // curated Wikipedia is rate limited -> falls back to a model link that is really about the topic
  const out=await x.r.research({topic:'BREAKDOWN_CLOSE',family:'PATTERN',force:true});
  assert.equal(out.ok,true,JSON.stringify(out));
  const ex=x.reviewed().sources[0].excerpt;assert.match(ex,/closes below support/);assert.doesNotMatch(ex,/var a=1/);
});
