const http=require('http');
const fs=require('fs');
const path=require('path');
const scanner=require('./scanner');
const market=require('./market');
const pipeline=require('./pipeline');
const {openStore}=require('./store');
const {createLiveController}=require('./live-controller');

const ROOT=process.env.BRAINHUB_ROOT||path.resolve(__dirname,'..');
const CFG=path.join(ROOT,'config','models.json');
const LOG=path.join(ROOT,'logs','brainpub.log');
const cfg=JSON.parse(fs.readFileSync(CFG,'utf8').replace(/^\uFEFF/,''));
const KEY=(process.env.BRAINHUB_ROUTER_KEY||'').trim();
const HOST=process.env.BRAINHUB_HOST||'127.0.0.1';
const PORT=Number(process.env.BRAINHUB_PORT||8787);
const CLIENT_TOKEN=(process.env.BRAINHUB_CLIENT_TOKEN||'').trim();
const BINANCE_CREDENTIALS={
  apiKey:(process.env.BRAINHUB_BINANCE_API_KEY||'').trim(),
  apiSecret:(process.env.BRAINHUB_BINANCE_API_SECRET||'').trim()
};
const TTL=(Number(cfg.healthCacheSeconds)||600)*1000;
if(!KEY){console.error('BRAINHUB_ROUTER_KEY missing');process.exit(2);}
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&CLIENT_TOKEN.length<32){console.error('BRAINHUB_CLIENT_TOKEN (32+ chars) required for non-loopback binding');process.exit(2);}
const store=openStore(ROOT);

fs.mkdirSync(path.dirname(LOG),{recursive:true});
const state=new Map();
let rr=0;
const ROLE_HINTS={
  DEFAULT:[],
  FAST:['lightning','flash','mimo','spark'],
  SCALP:['lightning','flash','mimo','spark'],
  STRUCTURE:['ultra','pickle','muse','mimo'],
  PATTERN:['ultra','muse','pickle','mimo'],
  MICROSTRUCTURE:['mimo','lightning','ultra','flash'],
  REGIME:['muse','ultra','pickle','mimo'],
  RISK:['ultra','pickle','muse','mimo']
};
function normalizeRole(v){
  const r=String(v||'DEFAULT').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(ROLE_HINTS,r)?r:'DEFAULT';
}
function roleInstruction(role){
  switch(normalizeRole(role)){
    case 'FAST': return 'Role FAST: look for the earliest valid 1m/3m/5m opportunity. Do not wait for 15m unless the requested setup is explicitly the legacy 15m strategy. Never trade on speed alone.';
    case 'SCALP': return 'Role SCALP: evaluate the earliest valid 1m/3m/5m scalp opportunity without waiting for 15m. Require closed-candle structure, valid liquidity/execution context and deterministic risk checks; speed alone is never enough.';
    case 'STRUCTURE': return 'Role STRUCTURE: compare 1m through 1d structure, liquidity, wick behavior and continuity. Timeframes are context, not votes. Synthetic 45m is not an independent confirmation.';
    case 'PATTERN': return 'Role PATTERN: evaluate closed-candle formations and their invalidation. Distinguish FORMING, CONFIRMED, FAILED, INVALIDATED and RECLAIMED states.';
    case 'MICROSTRUCTURE': return 'Role MICROSTRUCTURE: treat depth/CVD/OFI quality labels literally. Do not infer market-maker intent from snapshots or fabricate liquidation clusters.';
    case 'REGIME': return 'Role REGIME: evaluate BTC, ETH, ETH/BTC and market-cap context as regime information, not as an automatic veto or directional vote.';
    case 'RISK': return 'Role RISK: protect structural invalidation, stale-data, RR, duplicate/lease and max-risk rules. Never widen the original stop merely because a higher timeframe is supportive.';
    default: return 'Use only supplied data. Do not invent missing facts and do not place orders.';
  }
}
function rankPool(models,role,rotate=false){
  const unique=[...new Set((models||[]).filter(Boolean))];
  if(rotate&&unique.length){const n=rr++%unique.length;unique.push(...unique.splice(0,n));}
  const hints=ROLE_HINTS[normalizeRole(role)]||[];
  if(!hints.length)return unique;
  return unique.map((model,index)=>{
    const z=model.toLowerCase();
    let rank=999;
    for(let i=0;i<hints.length;i++){if(z.includes(hints[i])){rank=i;break;}}
    return {model,index,rank};
  }).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(x=>x.model);
}
function orderedModels(role='DEFAULT',preferred=''){
  const free=rankPool([...(cfg.opencode||[])],role,true);
  if(preferred&&free.includes(preferred))return [preferred,...free.filter(x=>x!==preferred)];
  return free;
}

function log(s){
  const line=new Date().toISOString()+' '+s;
  console.log(line);
  fs.appendFileSync(LOG,line+'\n');
}
function send(res,code,obj){
  const b=JSON.stringify(obj,null,2);
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b),'cache-control':'no-store'});
  res.end(b);
}
function sendBuffer(res,code,buffer,type,extra={}){
  res.writeHead(code,{'content-type':type,'content-length':buffer.length,'cache-control':'no-store','x-content-type-options':'nosniff',...extra});
  res.end(buffer);
}
function isLoopback(req){
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function authorized(req){
  if(!CLIENT_TOKEN)return isLoopback(req);
  const supplied=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(supplied.length!==CLIENT_TOKEN.length)return false;
  return require('crypto').timingSafeEqual(Buffer.from(supplied),Buffer.from(CLIENT_TOKEN));
}
function extract(raw){
  raw=String(raw||'');
  let out='';
  const add=v=>{
    if(typeof v==='string')out+=v;
    else if(Array.isArray(v))for(const x of v){
      if(typeof x==='string')out+=x;
      else if(x&&typeof x.text==='string')out+=x.text;
      else if(x&&typeof x.content==='string')out+=x.content;
    }
  };
  const take=j=>{
    if(!j)return;
    if(Array.isArray(j.choices))for(const c of j.choices||[]){add(c?.delta?.content);add(c?.message?.content);add(c?.text);}
    add(j.output_text);add(j.text);if(j.message)add(j.message.content);
  };
  try{take(JSON.parse(raw));}catch{}
  if(out.trim())return out.trim();
  for(const line of raw.split(/\r?\n/)){
    let d=line.trim();
    if(d.startsWith('data:'))d=d.slice(5).trim();
    if(!d||d==='[DONE]'||(!d.startsWith('{')&&!d.startsWith('[')))continue;
    try{take(JSON.parse(d));}catch{}
  }
  if(out.trim())return out.trim();
  const re=/"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while((m=re.exec(raw))){try{out+=JSON.parse('"'+m[1]+'"');}catch{}}
  return out.trim();
}
async function callModel(model,messages,timeoutMs=12000){
  const url=cfg.baseUrl+'/chat/completions';
  const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+KEY,'content-type':'application/json'},body:JSON.stringify({model,messages}),signal:AbortSignal.timeout(timeoutMs)});
  const raw=await r.text();
  if(!r.ok)throw new Error('HTTP '+r.status+' '+raw.slice(0,300));
  const text=extract(raw);
  if(!text)throw new Error('empty response');
  state.set(model,{ok:true,at:Date.now(),error:null});
  return {model,text};
}
function blocked(model){
  const s=state.get(model);
  return !!(s&&s.ok===false&&(Date.now()-s.at)<TTL);
}
async function ask(prompt,system,preferred,role='DEFAULT'){
  role=normalizeRole(role);
  const msgs=[];
  const sys=[roleInstruction(role),String(system||'').trim()].filter(Boolean).join(' ');
  if(sys)msgs.push({role:'system',content:sys});
  msgs.push({role:'user',content:prompt});
  const list=orderedModels(role,preferred);
  const errors=[];
  for(const m of list){
    if(blocked(m))continue;
    try{
      const out=await callModel(m,msgs);
      log('ASK OK role='+role+' model='+m);
      return {...out,role,attempts:errors.length+1};
    }catch(e){
      const msg=String(e.message||e);
      state.set(m,{ok:false,at:Date.now(),error:msg.slice(0,240)});
      errors.push({model:m,error:msg.slice(0,240)});
      log('ASK FAIL role='+role+' model='+m+' '+msg.slice(0,180));
    }
  }
  throw Object.assign(new Error('no healthy model'),{errors});
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let b='';
    req.on('data',c=>{b+=c;if(b.length>1048576){reject(new Error('body too large'));req.destroy();}});
    req.on('end',()=>resolve(b));
    req.on('error',reject);
  });
}
function readCommitteeConfig(){
  const cpath=path.join(ROOT,'config','committee.json');
  return JSON.parse(fs.readFileSync(cpath,'utf8').replace(/^\uFEFF/,''));
}
function candidateForSymbol(scan,symbol){
  const pools=[scan?.earlyTop5,scan?.top5Confirmed,scan?.leaderHunters,scan?.leaders];
  for(const pool of pools){
    const found=Array.isArray(pool)?pool.find(x=>x?.symbol===symbol):null;
    if(found)return found;
  }
  return null;
}
async function committeeCall(body){
  const r=await fetch('http://127.0.0.1:'+PORT+'/committee',{method:'POST',headers:{'content-type':'application/json',...(CLIENT_TOKEN?{authorization:'Bearer '+CLIENT_TOKEN}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const data=await r.json();
  if(!r.ok)throw new Error('committee unavailable: '+(data.error||r.status));
  return data;
}
const live=createLiveController({root:ROOT,store,scanner,pipeline,committee:committeeCall,credentials:BINANCE_CREDENTIALS});

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    if(!authorized(req))return send(res,401,{ok:false,error:'unauthorized'});
    if(req.method==='GET'&&u.pathname==='/health'){
      const ls=live.status();
      return send(res,200,{ok:true,time:new Date().toISOString(),host:HOST,port:PORT,routerKeyLoaded:true,version:'brainhub-pro-1',featureVersion:'9.5.78-C',execution:ls.armed?'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED':'ADVISORY_ONLY',live:{configured:ls.liveConfigured,armed:ls.armed,expiresAt:ls.expiresAt},database:'sqlite',router:'9Router',configured:{opencode:(cfg.opencode||[]).length,kiro:(cfg.kiro||[]).length,total:(cfg.opencode||[]).length+(cfg.kiro||[]).length},features:['UNIFIED_9TF','CAUSAL_45M','ROLE_ROUTING','FAILED_BREAKOUT_GUARD','CHART_DATA','CHART_PNG_CLEAN','CHART_PNG_ANNOTATED','LIVE_FAIL_CLOSED']});
    }
    if(req.method==='GET'&&u.pathname==='/live/status')return send(res,200,live.status());
    if(req.method==='GET'&&u.pathname==='/live/account'){
      const out=await live.accountSummary();
      return send(res,out?.ok?200:503,out);
    }
    if(req.method==='POST'&&u.pathname==='/live/arm'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(body?.confirm!=='LIVE')return send(res,400,{ok:false,armed:false,liveAllowed:false,execution:'LIVE_BLOCKED',reasons:['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']});
      const out=await live.arm({confirmed:true});
      return send(res,out.ok?200:409,out);
    }
    if(req.method==='POST'&&u.pathname==='/live/disarm'){
      let body={};try{body=JSON.parse((await readBody(req))||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      return send(res,200,live.disarm(typeof body.reason==='string'?body.reason:'USER_DISARM'));
    }
    if(req.method==='POST'&&u.pathname==='/live/execute'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      const out=await live.execute(body||{});
      return send(res,out.ok?200:409,out);
    }
    if(req.method==='GET'&&u.pathname==='/live/leader-auto'){
      return send(res,200,live.leaderAutoStatus());
    }
    if(req.method==='POST'&&u.pathname==='/live/leader-auto'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      const out=live.configureLeaderAuto(body||{});
      return send(res,out.ok?200:409,out);
    }
    if(req.method==='GET'&&u.pathname==='/models/healthy'){
      const models=[...(cfg.opencode||[]),...(cfg.kiro||[])].map(model=>({model,status:state.has(model)?(state.get(model).ok?'healthy':'cooldown'):'untested',last:state.get(model)?.at||null,error:state.get(model)?.error||null}));
      return send(res,200,{cacheSeconds:TTL/1000,models});
    }
    if(req.method==='GET'&&u.pathname==='/models/routes'){
      let ccfg={};try{ccfg=readCommitteeConfig();}catch{}
      const configured=[...(ccfg.analysts||[]),...(ccfg.backupAnalysts||[])];
      const base=configured.length?configured:[...(cfg.opencode||[])];
      const routes={};
      for(const role of Object.keys(ROLE_HINTS))routes[role]=rankPool(base,role,false);
      return send(res,200,{ok:true,freeFirst:true,roles:routes,judges:ccfg.judges||[],kiroJudgeOnly:true,note:'Kiro judges are reserved for disagreement/forced review; API keys are never exposed here.'});
    }
    if(req.method==='POST'&&u.pathname==='/ask'){
      const raw=await readBody(req);
      let j={};try{j=JSON.parse(raw||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(!j.prompt||typeof j.prompt!=='string')return send(res,400,{ok:false,error:'prompt required'});
      try{
        const out=await ask(j.prompt,j.system||'',j.model||'',j.role||'DEFAULT');
        return send(res,200,{ok:true,...out});
      }catch(e){
        return send(res,503,{ok:false,error:e.message,details:e.errors||[]});
      }
    }

    if(req.method==='POST'&&u.pathname==='/committee'){
      let ccfg={};
      try{ccfg=readCommitteeConfig();}
      catch(e){return send(res,500,{ok:false,error:'committee config error',detail:String(e.message||e)});}
      const raw=await readBody(req);
      let j={};
      try{j=JSON.parse(raw||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(!j.prompt||typeof j.prompt!=='string')return send(res,400,{ok:false,error:'prompt required'});

      const role=normalizeRole(j.role||'DEFAULT');
      const configured=[...(Array.isArray(ccfg.analysts)?ccfg.analysts:[]),...(Array.isArray(ccfg.backupAnalysts)?ccfg.backupAnalysts:[])];
      const freeSet=new Set(cfg.opencode||[]);
      const eligible=(configured.length?configured:[...(cfg.opencode||[])]).filter(x=>freeSet.has(x));
      const routed=rankPool(eligible.length?eligible:[...(cfg.opencode||[])],role,true);
      const judges=Array.isArray(ccfg.judges)?ccfg.judges:[];
      const minReplies=Math.max(1,Number(ccfg.minAnalystReplies||2));
      const parallel=Math.max(1,Math.min(Number(ccfg.parallelAnalysts||3),routed.length||1));
      const messages=[];
      const system=[roleInstruction(role),String(j.system||'').trim()].filter(Boolean).join(' ');
      if(system)messages.push({role:'system',content:system});
      messages.push({role:'user',content:j.prompt});

      async function probe(model){
        if(blocked(model))return {ok:false,model,error:'cooldown'};
        try{
          const r=await callModel(model,messages,20000);
          return {ok:true,model,text:r.text};
        }catch(e){
          const msg=String(e.message||e).slice(0,240);
          state.set(model,{ok:false,at:Date.now(),error:msg});
          return {ok:false,model,error:msg};
        }
      }

      let results=await Promise.all(routed.slice(0,parallel).map(probe));
      let good=results.filter(x=>x.ok&&x.text);
      for(const m of routed.slice(parallel)){
        if(good.length>=minReplies)break;
        const r=await probe(m);
        results.push(r);
        if(r.ok&&r.text)good.push(r);
      }
      if(good.length===0){
        return send(res,503,{ok:false,error:'no analyst replies',role,required:minReplies,received:0,results});
      }
      const degraded=good.length<minReplies;

      const norm=t=>String(t||'').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
      const exact=new Set(good.map(x=>norm(x.text))).size===1;
      const verdict=t=>{
        const z=String(t||'').toUpperCase().replace(/[- ]/g,'_');
        const m=z.match(/\b(NO_TRADE|LONG|SHORT|WAIT|HOLD|REJECT)\b/);
        return m?m[1]:null;
      };
      const vs=good.map(x=>verdict(x.text));
      const verdictConsensus=vs.every(Boolean)&&new Set(vs).size===1;
      const disagreement=!exact&&!verdictConsensus;
      const needJudge=j.forceJudge===true||(ccfg.judgeOnlyOnDisagreement!==false&&disagreement);

      const bundle=good.map((x,i)=>'ANALYST_'+(i+1)+' '+x.model+'\n'+x.text).join('\n\n---\n\n');
      let finalText='';
      let finalModel='';
      let judge=null;

      if(needJudge&&judges.length){
        const jp=[
          {role:'system',content:'You are the committee judge. Resolve conflicts using only supplied analyst answers and source context. Do not invent facts, do not infer hidden market-maker intent, and do not place orders.'},
          {role:'user',content:'ROLE: '+role+'\nORIGINAL REQUEST:\n'+j.prompt+'\n\nANALYST ANSWERS:\n'+bundle}
        ];
        for(const m of judges){
          try{
            const r=await callModel(m,jp,20000);
            finalText=r.text;finalModel=m;judge={used:true,model:m};break;
          }catch(e){
            judge={used:false,lastModel:m,error:String(e.message||e).slice(0,240)};
          }
        }
      }

      if(!finalText){
        const synth=orderedModels(role)[0]||good[0].model;
        const sp=[
          {role:'system',content:'Synthesize the analyst answers into one concise final answer. Preserve consensus and material disagreement. Use only supplied facts. This is advisory only.'},
          {role:'user',content:'ROLE: '+role+'\nORIGINAL REQUEST:\n'+j.prompt+'\n\nANALYST ANSWERS:\n'+bundle}
        ];
        try{
          const r=await callModel(synth,sp,20000);
          finalText=r.text;finalModel=synth;
        }catch{
          finalText=good[0].text;finalModel=good[0].model;
        }
      }

      log('COMMITTEE OK role='+role+' analysts='+good.length+' degraded='+(degraded?'yes':'no')+' disagreement='+disagreement+' judge='+(judge&&judge.used?judge.model:'no'));
      return send(res,200,{ok:true,role,mode:degraded?'degraded_single':(judge&&judge.used?'judge':'consensus'),degraded,degradedReason:degraded?'DEGRADED_1_ANALYST':null,requiredAnalystReplies:minReplies,receivedAnalystReplies:good.length,disagreement,verdictConsensus:verdictConsensus?(vs[0]||null):null,analysts:good,failed:results.filter(x=>!x.ok),judge:judge||{used:false},model:finalModel,text:finalText});
    }

    if(req.method==='GET'&&u.pathname==='/scanner'){
      try{return send(res,200,await scanner.scan());}
      catch(e){log('SCANNER FAIL '+String(e.message||e));return send(res,503,{ok:false,error:'scanner failed',detail:String(e.message||e)});}
    }
    if(req.method==='GET'&&u.pathname==='/context/global')return send(res,200,await market.globalContext());
    if(req.method==='GET'&&u.pathname==='/context/symbol'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      return send(res,200,await market.symbolContext(symbol));
    }
    if(req.method==='GET'&&u.pathname==='/context/unified'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      const [sym,global,scan]=await Promise.all([market.symbolContext(symbol),market.globalContext(),scanner.scan()]);
      const unified=pipeline.buildUnifiedContext({symbol:sym,global,candidate:candidateForSymbol(scan,symbol)});
      return send(res,200,{ok:true,...unified});
    }
    if(req.method==='GET'&&u.pathname==='/chart/data'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      const tf=(u.searchParams.get('tf')||'15m').toLowerCase();
      const bars=Number(u.searchParams.get('bars')||128);
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      try{return send(res,200,await market.chartContext(symbol,tf,bars));}
      catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='GET'&&u.pathname==='/chart/png'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      const tf=(u.searchParams.get('tf')||'15m').toLowerCase();
      const mode=(u.searchParams.get('mode')||'clean').toLowerCase();
      const bars=Number(u.searchParams.get('bars')||128);
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      try{
        const chart=await market.chartContext(symbol,tf,bars);
        const png=market.renderChartPng(chart,mode);
        return sendBuffer(res,200,png,'image/png',{'x-brainhub-symbol':symbol,'x-brainhub-timeframe':tf,'x-brainhub-chart-mode':mode});
      }catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='GET'&&u.pathname==='/leader/committee'){
      const scan=await scanner.scan();
      const leaderCommittee=require('./leader-committee');
      return send(res,200,await leaderCommittee.run({scan,port:PORT,token:CLIENT_TOKEN}));
    }
    if(req.method==='GET'&&u.pathname==='/leader/plan'){
      const scan=await scanner.scan();
      const out=await pipeline.run({scan,store,committee:committeeCall});
      return send(res,200,out);
    }
    if(req.method==='GET'&&u.pathname==='/journal')return send(res,200,{ok:true,items:store.getJournal(u.searchParams.get('limit'))});
    if(req.method==='GET'&&u.pathname==='/learning')return send(res,200,{ok:true,...store.learning()});
    if(req.method==='POST'&&u.pathname==='/journal/outcome'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      try{return send(res,200,{ok:store.label(body.id,body.outcome)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='POST'&&u.pathname==='/lease'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      try{return send(res,200,{ok:true,...store.lease(body.action,body.resource,body.owner,body.token,body.ttlMs)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='POST'&&u.pathname==='/execution/claim'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      try{return send(res,200,{ok:true,...store.claim(body.eventId,body.owner,body.resource,body.token,body.lineageId||body.eventId)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    return send(res,404,{ok:false,error:'not found'});
  }catch(e){
    log('SERVER '+String(e.stack||e));
    return send(res,500,{ok:false,error:'server error'});
  }
});

server.listen(PORT,HOST,()=>log('BrainHub listening on http://'+HOST+':'+PORT));

const leaderAutoTimer=setInterval(async()=>{
  try{
    const out=await live.leaderAutoTick();
    if(out?.orderPlaced===true){
      log('LEADER AUTO ORDER symbol='+(out?.leaderIntent?.symbol||out?.symbol||'unknown')+' execution='+(out?.execution||'unknown'));
    }else if(out?.ok===false&&out?.skipped!==true){
      log('LEADER AUTO BLOCK execution='+(out?.execution||'unknown')+' reasons='+JSON.stringify(out?.reasons||[]));
    }
  }catch(e){
    log('LEADER AUTO TIMER '+String(e?.message||e).slice(0,200));
  }
},60000);
if(typeof leaderAutoTimer.unref==='function')leaderAutoTimer.unref();
