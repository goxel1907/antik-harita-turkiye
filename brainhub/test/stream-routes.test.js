'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {StreamingMarket}=require('../market');
const {buildMarketMakerEvidence}=require('../market-maker-evidence');
class Socket {
  static instances=[];
  constructor(url){this.url=url;this.readyState=0;this.sent=[];this.events={};Socket.instances.push(this);}
  addEventListener(name,fn){this.events[name]=fn;}
  send(raw){this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.events.open();}
  close(){this.readyState=3;this.events.close();}
}
test('public books and market trades route independently, including eviction and reconnect', async t=>{
  Socket.instances=[];
  const stream=new StreamingMarket({WebSocketImpl:Socket});
  t.after(()=>stream.shutdown());
  stream.maxSymbols=1;
  stream.ensureSymbol('BTCUSDT');
  const [book,market]=Socket.instances;
  assert.match(book.url,/\/public\/ws$/);assert.match(market.url,/\/market\/ws$/);
  book.open();market.open();
  assert.deepEqual(book.sent[0].params,['btcusdt@bookTicker','btcusdt@depth20@100ms']);
  assert.deepEqual(market.sent[0].params,['btcusdt@aggTrade','btcusdt@forceOrder']);
  stream.ensureSymbol('ETHUSDT');
  for(const socket of [book,market]){
    assert.equal(socket.sent[1].method,'UNSUBSCRIBE');
    assert.ok(socket.sent[1].params.every(x=>x.startsWith('btcusdt@')));
    assert.ok(socket.sent[2].params.every(x=>x.startsWith('ethusdt@')));
  }
  stream.channels.market.retryMs=1;
  market.close();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(Socket.instances.length,3);
  const replacement=Socket.instances[2];replacement.open();
  assert.match(replacement.url,/\/market\/ws$/);
  assert.ok(replacement.sent[0].params.every(x=>x.startsWith('ethusdt@')));
  assert.equal(stream.ws,book);
  const now=Date.now();
  await book.events.message({data:JSON.stringify({e:'bookTicker',s:'ETHUSDT',E:now,b:'100',a:'101',B:'1',A:'1'})});
  await replacement.events.message({data:JSON.stringify({e:'aggTrade',s:'ETHUSDT',T:now,p:'100',q:'2',m:false})});
  assert.equal(stream.snapshot('ETHUSDT').cvdQuote120s,200);
  stream.shutdown();
  for(const c of Object.values(stream.channels)){assert.equal(c.timer,null);assert.equal(c.ws,null);}
  stream.connect();
  assert.equal(Socket.instances.length,3);
});
test('fresh book updates cannot label old CVD fresh; missing CVD remains null',()=>{
  let now=100000;
  const stream=new StreamingMarket({WebSocketImpl:null,now:()=>now});
  stream.ensureSymbol('BTCUSDT');
  stream.ingest({e:'aggTrade',s:'BTCUSDT',T:now,p:'100',q:'1',m:false});
  now+=46000;
  stream.ingest({e:'bookTicker',s:'BTCUSDT',E:now,b:'100',a:'101',B:'1',A:'1'});
  const snap=stream.snapshot('BTCUSDT');
  const flow=buildMarketMakerEvidence({streaming:snap}).orderFlow;
  assert.equal(snap.ageMs,0);assert.equal(flow.ageMs,46000);
  assert.equal(flow.available,false);assert.equal(flow.reason,'STALE_STREAM');
  assert.equal(flow.cvdQuote120s,100);
  assert.equal(buildMarketMakerEvidence({streaming:{cvdQuote120s:null,cvdTrades120s:0}}).orderFlow.cvdQuote120s,null);
  stream.shutdown();
});
