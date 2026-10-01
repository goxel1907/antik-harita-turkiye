'use strict';
// R2544.26 LOCAL L2 — active-symbol-only, sequence-safe Binance USD-M diff-book reconstruction.
// Evidence only: no qualification, veto, sizing, execution, participant identity or intent inference.

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function clamp(v,lo=-1,hi=1){const x=n(v);return x===null?null:Math.max(lo,Math.min(hi,x));}
function r(v,d=4){const x=n(v);return x===null?null:Number(x.toFixed(d));}
function pxKey(v){return String(v);}
function parseRows(rows){return Array.isArray(rows)?rows.map(x=>[n(x?.[0]),n(x?.[1])]).filter(x=>x[0]>0&&x[1]>=0):[];}
function quality(score){const x=n(score)||0;return x>=0.8?'FULL':x>=0.5?'MODERATE':x>=0.2?'SPARSE':x>0?'VERY_SPARSE':'UNAVAILABLE';}

class LocalL2Manager{
  constructor({WebSocketImpl=null,snapshotLoader=null,endpoint='wss://fstream.binance.com/public/ws',now=()=>Date.now(),maxSymbols=6,staleMs=3000}={}){
    this.WebSocketImpl=WebSocketImpl;this.snapshotLoader=snapshotLoader;this.endpoint=endpoint;this.now=now;
    this.maxSymbols=maxSymbols;this.staleMs=staleMs;this.states=new Map();this.subscribed=new Set();this.ws=null;this.connecting=false;this.retryMs=1000;this.timer=null;this.id=1;this.stopped=false;this.evictions=0;
  }
  state(symbol){return this.states.get(String(symbol||'').toUpperCase())||null;}
  _new(symbol){return {symbol,status:'COLD',bids:new Map(),asks:new Map(),buffer:[],seeded:false,snapshotLastUpdateId:null,lastU:null,lastEventAt:0,lastRequestedAt:this.now(),healthySince:0,eventCount:0,resyncTimes:[],flow:[],activity:[],metaBid:new Map(),metaAsk:new Map(),seedPromise:null,lastError:null};}
  ensureSymbol(symbol){
    symbol=String(symbol||'').toUpperCase();if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))return null;
    if(!this.states.has(symbol)){
      if(this.states.size>=this.maxSymbols){const victim=[...this.states.values()].sort((a,b)=>(a.lastRequestedAt||0)-(b.lastRequestedAt||0))[0];if(victim){this._send([victim.symbol],'UNSUBSCRIBE');this.states.delete(victim.symbol);this.subscribed.delete(victim.symbol);this.evictions++;}}
      this.states.set(symbol,this._new(symbol));
    }
    const s=this.states.get(symbol);s.lastRequestedAt=this.now();const added=!this.subscribed.has(symbol);this.subscribed.add(symbol);this._connect();if(added)this._send([symbol],'SUBSCRIBE');
    return s;
  }
  _connect(){
    if(this.stopped||!this.WebSocketImpl||this.ws||this.connecting||!this.subscribed.size)return;
    this.connecting=true;let ws;try{ws=new this.WebSocketImpl(this.endpoint);}catch{this.connecting=false;return this._reconnect();}
    this.ws=ws;const on=(ev,fn)=>{if(typeof ws.addEventListener==='function')ws.addEventListener(ev,fn);else ws['on'+ev]=fn;};
    on('open',()=>{if(this.ws!==ws||this.stopped)return;this.connecting=false;this.retryMs=1000;this._send([...this.subscribed],'SUBSCRIBE');for(const symbol of this.subscribed){const s=this.state(symbol);if(s&&!s.seeded&&!s.seedPromise)this._seed(symbol).catch(()=>{});}});
    on('message',async ev=>{try{let raw=ev?.data;if(raw&&typeof raw.text==='function')raw=await raw.text();else if(raw instanceof ArrayBuffer)raw=Buffer.from(raw).toString('utf8');else if(ArrayBuffer.isView(raw))raw=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength).toString('utf8');const msg=typeof raw==='string'?JSON.parse(raw):raw;this.ingest(msg);}catch{}});
    on('close',()=>{if(this.ws!==ws)return;this.ws=null;this.connecting=false;this._reconnect();});on('error',()=>{});
  }
  _reconnect(){if(this.stopped||!this.WebSocketImpl||!this.subscribed.size||this.timer)return;const d=Math.min(this.retryMs,30000);this.retryMs=Math.min(d*2,30000);this.timer=setTimeout(()=>{this.timer=null;this._connect();},d);this.timer.unref?.();}
  _send(symbols,method){const ws=this.ws;if(ws?.readyState!==1||typeof ws.send!=='function')return;const params=symbols.filter(x=>this.subscribed.has(x)||method==='UNSUBSCRIBE').map(x=>`${x.toLowerCase()}@depth@100ms`);if(params.length)try{ws.send(JSON.stringify({method,params,id:this.id++}));}catch{}}
  async _seed(symbol){
    const s=this.state(symbol);if(!s||typeof this.snapshotLoader!=='function'||s.seedPromise)return s?.seedPromise||null;
    s.status=s.status==='RESYNCING'?'RESYNCING':'SNAPSHOT_LOADING';
    s.seedPromise=(async()=>{
      try{
        const snap=await this.snapshotLoader(symbol);const last=n(snap?.lastUpdateId);if(!(last>=0))throw new Error('L2_SNAPSHOT_LAST_UPDATE_ID_MISSING');
        const bids=new Map(),asks=new Map();for(const [p,q] of parseRows(snap?.bids))if(q>0)bids.set(pxKey(p),q);for(const [p,q] of parseRows(snap?.asks))if(q>0)asks.set(pxKey(p),q);
        const pending=s.buffer.filter(e=>(n(e.u)||-1)>=last).sort((a,b)=>(n(a.E)||0)-(n(b.E)||0));const bridge=pending.findIndex(e=>n(e.U)<=last&&n(e.u)>=last);
        s.bids=bids;s.asks=asks;s.snapshotLastUpdateId=last;s.lastU=last;s.seeded=true;s.status='WARMING';s.healthySince=0;s.eventCount=0;s.flow=[];s.activity=[];s.metaBid=new Map();s.metaAsk=new Map();
        if(bridge>=0){for(const e of pending.slice(bridge)){if(!this._applyEvent(s,e,true))break;}}
        else{s.seeded=false;s.status='WARMING';}
        s.buffer=s.buffer.slice(-600);s.lastError=null;
      }catch(e){s.seeded=false;s.status='UNAVAILABLE';s.lastError=String(e?.message||e).slice(0,120);}finally{s.seedPromise=null;}
    })();
    return s.seedPromise;
  }
  _markResync(s,reason,event){const now=this.now();s.status='RESYNCING';s.seeded=false;s.lastError=reason;s.resyncTimes=s.resyncTimes.filter(t=>now-t<=300000);s.resyncTimes.push(now);s.buffer=event?[event]:[];this._seed(s.symbol).catch(()=>{});}
  _bestMid(s){const bs=[...s.bids.keys()].map(Number).filter(Number.isFinite),as=[...s.asks.keys()].map(Number).filter(Number.isFinite);if(!bs.length||!as.length)return null;const b=Math.max(...bs),a=Math.min(...as);return a>b?(a+b)/2:null;}
  _applySide(s,side,rows,at,mid){const book=side==='BID'?s.bids:s.asks,meta=side==='BID'?s.metaBid:s.metaAsk;let signed=0,total=0,pull=0,repl=0;
    for(const [p,q] of parseRows(rows)){const k=pxKey(p),old=book.get(k)||0,delta=q-old;if(delta===0)continue;const dist=mid&&mid>0?Math.abs(p-mid)/mid*10000:0,weight=1/(1+dist/12),quote=Math.abs(delta)*p*weight;total+=quote;signed+=(side==='BID'?1:-1)*delta*p*weight;
      let m=meta.get(k);if(!m)m={firstSeen:at,lastReductionAt:0,peakQty:Math.max(old,q),lastQty:old};
      if(delta<0){m.lastReductionAt=at;pull+=quote;}else if(delta>0&&old>0&&m.lastReductionAt&&at-m.lastReductionAt<=15000){repl+=quote;}
      m.peakQty=Math.max(m.peakQty||0,q);m.lastQty=q;if(q<=0){book.delete(k);meta.delete(k);}else{book.set(k,q);meta.set(k,m);}
    }
    return {signed,total,pull,repl};}
  _applyEvent(s,e,fromSeed=false){const U=n(e.U),u=n(e.u),pu=n(e.pu),at=n(e.E)||n(e.T)||this.now();if(U===null||u===null)return false;
    if(s.lastU!==null&&s.lastU!==s.snapshotLastUpdateId&&pu!==s.lastU){this._markResync(s,'L2_SEQUENCE_GAP_PU_MISMATCH',e);return false;}
    if(s.lastU===s.snapshotLastUpdateId&&!(U<=s.snapshotLastUpdateId&&u>=s.snapshotLastUpdateId)){if(fromSeed)return false;this._markResync(s,'L2_FIRST_EVENT_DOES_NOT_BRIDGE_SNAPSHOT',e);return false;}
    const mid=this._bestMid(s);const b=this._applySide(s,'BID',e.b,at,mid),a=this._applySide(s,'ASK',e.a,at,mid);s.lastU=u;s.lastEventAt=at;s.eventCount++;if(!s.healthySince)s.healthySince=at;s.status='HEALTHY';s.flow.push({at,signed:b.signed+a.signed,total:b.total+a.total});s.activity.push({at,bidPull:b.pull,askPull:a.pull,bidRepl:b.repl,askRepl:a.repl});const cutoff=this.now()-30000;s.flow=s.flow.filter(x=>x.at>=cutoff).slice(-800);s.activity=s.activity.filter(x=>x.at>=cutoff).slice(-800);return true;}
  ingest(message){const d=message?.data&&typeof message.data==='object'?message.data:message;if(!d||String(d.e||'')!=='depthUpdate')return false;const symbol=String(d.s||'').toUpperCase(),s=this.state(symbol);if(!s)return false;if(!s.seeded){s.buffer.push(d);if(s.buffer.length>1200)s.buffer.splice(0,s.buffer.length-1200);if(!s.seedPromise)this._seed(symbol).catch(()=>{});return true;}return this._applyEvent(s,d,false);}
  _bookDepth(s,mid){if(!(mid>0))return {imbalance:null,bidQuote:0,askQuote:0,bidWall:null,askWall:null};const rows=(book,side)=>[...book.entries()].map(([p,q])=>[Number(p),q]).filter(([p,q])=>p>0&&q>0&&Math.abs(p-mid)/mid*10000<=30).sort((x,y)=>side==='BID'?y[0]-x[0]:x[0]-y[0]);const b=rows(s.bids,'BID'),a=rows(s.asks,'ASK');const bq=b.reduce((z,[p,q])=>z+p*q,0),aq=a.reduce((z,[p,q])=>z+p*q,0);const top=(xs,total,meta)=>{if(!xs.length||!(total>0))return null;const x=xs.map(([p,q])=>({price:p,qty:q,quote:p*q,firstSeen:meta.get(pxKey(p))?.firstSeen||null})).sort((x,y)=>y.quote-x.quote)[0];return {...x,share:x.quote/total};};return {imbalance:bq+aq>0?(bq-aq)/(bq+aq):null,bidQuote:bq,askQuote:aq,bidWall:top(b,bq,s.metaBid),askWall:top(a,aq,s.metaAsk)};}
  snapshot(symbol,now=this.now(),trades=[]){const s=this.state(symbol);if(!s)return {available:false,state:'COLD',authority:'EVIDENCE_ONLY_JEV_FINAL',canVeto:false,executionAuthority:false};const age=s.lastEventAt&&now>=s.lastEventAt?now-s.lastEventAt:null;if(s.status==='HEALTHY'&&age!==null&&age>this.staleMs)s.status='STALE';const mid=this._bestMid(s),depth=this._bookDepth(s,mid);const flow=s.flow.filter(x=>now-x.at<=30000),tot=flow.reduce((z,x)=>z+x.total,0),signed=flow.reduce((z,x)=>z+x.signed,0);const activity=s.activity.filter(x=>now-x.at<=15000);const sums=k=>activity.reduce((z,x)=>z+(x[k]||0),0);const bp=sums('bidPull'),ap=sums('askPull'),br=sums('bidRepl'),ar=sums('askRepl');const pullSide=bp+ap>0?(bp>ap?'BID':'ASK'):'NONE',repSide=br+ar>0?(br>ar?'BID':'ASK'):'NONE';
    const ts=Array.isArray(trades)?trades.filter(x=>now-(x.at||0)<=15000):[],buy=ts.filter(x=>x.sign>0).reduce((z,x)=>z+(x.quote||0),0),sell=ts.filter(x=>x.sign<0).reduce((z,x)=>z+(x.quote||0),0),first=ts[0]?.price,last=ts.at(-1)?.price,move=first>0&&last>0?(last-first)/first*10000:null;let absorption='NONE',absConf=0;if(buy+sell>0&&move!==null){const aggr=(buy-sell)/(buy+sell);if(aggr<=-0.35&&Math.abs(move)<=4&&br>0){absorption='BID';absConf=Math.min(1,Math.abs(aggr)*0.6+Math.min(0.4,br/(br+ar+1)));}else if(aggr>=0.35&&Math.abs(move)<=4&&ar>0){absorption='ASK';absConf=Math.min(1,Math.abs(aggr)*0.6+Math.min(0.4,ar/(br+ar+1)));}}
    const freshness=age===null?0:Math.max(0,1-age/this.staleMs),continuity=s.healthySince?Math.min(1,Math.max(0,now-s.healthySince)/30000):0,samples=Math.min(1,s.eventCount/100),score=s.status==='HEALTHY'?Math.max(0,Math.min(1,0.35*freshness+0.35*continuity+0.30*samples)):0;s.resyncTimes=s.resyncTimes.filter(t=>now-t<=300000);
    const wall=depth.bidWall||depth.askWall?((depth.bidWall?.share||0)>=(depth.askWall?.share||0)?{side:'BID',...depth.bidWall}:{side:'ASK',...depth.askWall}):null;
    return {available:s.status==='HEALTHY'&&age!==null&&age<=this.staleMs,state:s.status,source:'BINANCE_USDM_DIFF_DEPTH_LOCAL_BOOK',authority:'EVIDENCE_ONLY_JEV_FINAL',observed:true,estimated:false,canQualify:false,canVeto:false,canSize:false,canExecute:false,executionAuthority:false,sequenceHealthy:s.status==='HEALTHY',ageMs:age,resyncCount5m:s.resyncTimes.length,lastUpdateId:s.lastU,confidence:r(score,3),confidenceQuality:quality(score),multiLevelOfi:tot>0?r(clamp(signed/tot),4):null,depthImbalance:r(depth.imbalance,4),wallPersistence:wall?{side:wall.side,share:r(wall.share,3),ageMs:wall.firstSeen?Math.max(0,now-wall.firstSeen):null}:null,liquidityPull:{side:pullSide,bidQuote:r(bp,0),askQuote:r(ap,0),semantics:'BOOK_REDUCTION_PROXY_NOT_INTENT'},replenishment:{side:repSide,bidQuote:r(br,0),askQuote:r(ar,0)},absorption:{side:absorption,confidence:r(absConf,3),semantics:'AGGTRADE_PLUS_REPLENISHMENT_RESPONSE_PROXY'},note:'Sequence-safe public local L2 evidence. Low confidence or unavailable state down-weights/omits evidence and never vetoes a sound JEV setup.'};}
  health(){const now=this.now();let healthy=0,warming=0,stale=0;for(const s of this.states.values()){const x=this.snapshot(s.symbol,now,[]);if(x.state==='HEALTHY')healthy++;else if(x.state==='STALE')stale++;else warming++;}return {subscribedSymbols:this.subscribed.size,maxSymbols:this.maxSymbols,evictions:this.evictions,connected:this.ws?.readyState===1,healthy,warming,stale,authority:'EVIDENCE_ONLY'};}
  shutdown(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;const ws=this.ws;this.ws=null;if(ws&&typeof ws.close==='function')try{ws.close();}catch{};}
}

module.exports={LocalL2Manager,quality};
