const http=require('http');
const fs=require('fs');
const path=require('path');
const scanner=require('./scanner');
const market=require('./market');
const pipeline=require('./pipeline');
const {openStore}=require('./store');

const ROOT=process.env.BRAINHUB_ROOT||path.resolve(__dirname,'..');
const CFG=path.join(ROOT,'config','models.json');
const LOG=path.join(ROOT,'logs','brainpub.log');
const cfg=JSON.parse(fs.readFileSync(CFG,'utf8').replace(/^\uFEFF/,''));
const KEY=(process.env.BRAINHUB_ROUTER_KEY||'').trim();
const HOST=process.env.BRAINHUB_HOST||'127.0.0.1';
const PORT=Number(process.env.BRAINHUB_PORT||8787);
const CLIENT_TOKEN=(process.env.BRAINHUB_CLIENT_TOKEN||'').trim();
const TTL=(Number(cfg.healthCacheSeconds)||600)*1000;
if(!KEY){console.error('BRAINHUB_ROUTER_KEY missing');process.exit(2);}
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&CLIENT_TOKEN.length<32){console.error('BRAINHUB_CLIENT_TOKEN (32+ chars) required for non-loopback binding');process.exit(2);}
const store=openStore(ROOT);

fs.mkdirSync(path.dirname(LOG),{recursive:true});
const state=new Map();
let rr=0;

function log(s){
  const line=new Date().toISOString()+' '+s;
  console.log(line);
  fs.appendFileSync(LOG,line+'\n');
}
function send(res,code,obj){
  const b=JSON.stringify(obj,null,2);
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b)});
  res.end(b);
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
function textFromObj(j){
  if(!j)return '';
  if(Array.isArray(j.choices))return j.choices.map(c=>c?.message?.content||c?.delta?.content||'').join('');
  return j.output_text||j.text||j.content||'';
}
function extract(raw){
  raw=String(raw||'');
  let out='';
  const add=v=>{
    if(typeof v==='string') out+=v;
    else if(Array.isArray(v)) for(const x of v){
      if(typeof x==='string') out+=x;
      else if(x && typeof x.text==='string') out+=x.text;
      else if(x && typeof x.content==='string') out+=x.content;
    }
  };
  const take=j=>{
    if(!j) return;
    if(Array.isArray(j.choices)) for(const c of j.choices||[]){
      add(c?.delta?.content);
      add(c?.message?.content);
      add(c?.text);
    }
    add(j.output_text);
    add(j.text);
    if(j.message) add(j.message.content);
  };
  try{ take(JSON.parse(raw)); }catch{}
  if(out.trim()) return out.trim();
  for(const line of raw.split(/\r?\n/)){
    let d=line.trim();
    if(d.startsWith('data:')) d=d.slice(5).trim();
    if(!d || d==='[DONE]' || (!d.startsWith('{') && !d.startsWith('['))) continue;
    try{ take(JSON.parse(d)); }catch{}
  }
  if(out.trim()) return out.trim();
  const re=/"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while((m=re.exec(raw))){
    try{ out+=JSON.parse('"'+m[1]+'"'); }catch{}
  }
  return out.trim();
}
async function callModel(model,messages,timeoutMs=12000){
  const url=cfg.baseUrl+'/chat/completions';
  const r=await fetch(url,{method:'POST',headers:{'authorization':'Bearer '+KEY,'content-type':'application/json'},body:JSON.stringify({model,messages}),signal:AbortSignal.timeout(timeoutMs)});
  const raw=await r.text();
  if(!r.ok){throw new Error('HTTP '+r.status+' '+raw.slice(0,300));}
  const text=extract(raw);
  if(!text)throw new Error('empty response');
  state.set(model,{ok:true,at:Date.now(),error:null});
  return {model,text};
}
function blocked(model){
  const s=state.get(model);
  return !!(s&&s.ok===false&&(Date.now()-s.at)<TTL);
}
function orderedModels(){
  const oc=[...(cfg.opencode||[])];
  if(oc.length){const n=rr++%oc.length; oc.push(...oc.splice(0,n));}
  return oc;
}
async function ask(prompt,system,preferred){
  const msgs=[];
  if(system)msgs.push({role:'system',content:system});
  msgs.push({role:'user',content:prompt});
  const free=orderedModels();
  const list=preferred&&free.includes(preferred)?[preferred,...free.filter(x=>x!==preferred)]:free;
  const errors=[];
  for(const m of list){
    if(blocked(m))continue;
    try{
      const out=await callModel(m,msgs);
      log('ASK OK '+m);
      return {...out,attempts:errors.length+1};
    }catch(e){
      const msg=String(e.message||e);
      state.set(m,{ok:false,at:Date.now(),error:msg.slice(0,240)});
      errors.push({model:m,error:msg.slice(0,240)});
      log('ASK FAIL '+m+' '+msg.slice(0,180));
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

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    if(!authorized(req))return send(res,401,{ok:false,error:'unauthorized'});
    if(req.method==='GET'&&u.pathname==='/health'){
      return send(res,200,{ok:true,time:new Date().toISOString(),host:HOST,port:PORT,routerKeyLoaded:true,version:'brainhub-pro-1',execution:'ADVISORY_ONLY',database:'sqlite',configured:{opencode:(cfg.opencode||[]).length,kiro:(cfg.kiro||[]).length,total:(cfg.opencode||[]).length+(cfg.kiro||[]).length}});
    }
    if(req.method==='GET'&&u.pathname==='/models/healthy'){
      const models=[...(cfg.opencode||[]),...(cfg.kiro||[])].map(model=>({model,status:state.has(model)?(state.get(model).ok?'healthy':'cooldown'):'untested',last:state.get(model)?.at||null,error:state.get(model)?.error||null}));
      return send(res,200,{cacheSeconds:TTL/1000,models});
    }
    if(req.method==='POST'&&u.pathname==='/ask'){
      const raw=await readBody(req);
      let j={}; try{j=JSON.parse(raw||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(!j.prompt||typeof j.prompt!=='string')return send(res,400,{ok:false,error:'prompt required'});
      try{
        const out=await ask(j.prompt,j.system||'',j.model||'');
        return send(res,200,{ok:true,...out});
      }catch(e){
        return send(res,503,{ok:false,error:e.message,details:e.errors||[]});
      }
    }

    if(req.method==='POST'&&u.pathname==='/committee'){
      const cpath=path.join(ROOT,'config','committee.json');
      let ccfg={};
      try{ccfg=JSON.parse(fs.readFileSync(cpath,'utf8').replace(/^\uFEFF/,''));}
      catch(e){return send(res,500,{ok:false,error:'committee config error',detail:String(e.message||e)});}
      const raw=await readBody(req);
      let j={};
      try{j=JSON.parse(raw||'{}');}
      catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(!j.prompt||typeof j.prompt!=='string')return send(res,400,{ok:false,error:'prompt required'});

      const analysts=Array.isArray(ccfg.analysts)?ccfg.analysts:[];
      const backups=Array.isArray(ccfg.backupAnalysts)?ccfg.backupAnalysts:[];
      const judges=Array.isArray(ccfg.judges)?ccfg.judges:[];
      const minReplies=Math.max(1,Number(ccfg.minAnalystReplies||2));
      const parallel=Math.max(1,Math.min(Number(ccfg.parallelAnalysts||3),analysts.length||1));
      const messages=[];
      if(j.system)messages.push({role:'system',content:String(j.system)});
      messages.push({role:'user',content:j.prompt});

      async function probe(model){
        try{
          const r=await callModel(model,messages,20000);
          return {ok:true,model,text:r.text};
        }catch(e){
          return {ok:false,model,error:String(e.message||e).slice(0,240)};
        }
      }

      let results=await Promise.all(analysts.slice(0,parallel).map(probe));
      let good=results.filter(x=>x.ok&&x.text);
      for(const m of backups){
        if(good.length>=minReplies)break;
        const r=await probe(m);
        results.push(r);
        if(r.ok&&r.text)good.push(r);
      }
      if(good.length<minReplies){
        return send(res,503,{ok:false,error:'not enough analyst replies',required:minReplies,received:good.length,results});
      }

      const norm=t=>String(t||'').toLowerCase().replace(/[^a-z0-9Ã§ÄŸÄ±Ã¶ÅŸÃ¼]+/gi,' ').trim().replace(/\s+/g,' ');
      const exact=new Set(good.map(x=>norm(x.text))).size===1;
      const verdict=t=>{
        const z=String(t||'').toUpperCase().replace(/[- ]/g,'_');
        const m=z.match(/\b(NO_TRADE|LONG|SHORT|WAIT|HOLD)\b/);
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
          {role:'system',content:'You are the committee judge. Compare the analyst answers. Resolve conflicts using only the supplied answers. Do not invent facts. Return one concise final answer.'},
          {role:'user',content:'ORIGINAL REQUEST:\n'+j.prompt+'\n\nANALYST ANSWERS:\n'+bundle}
        ];
        for(const m of judges){
          try{
            const r=await callModel(m,jp,20000);
            finalText=r.text; finalModel=m; judge={used:true,model:m}; break;
          }catch(e){
            judge={used:false,lastModel:m,error:String(e.message||e).slice(0,240)};
          }
        }
      }

      if(!finalText){
        const synth=(cfg.opencode||[])[0]||good[0].model;
        const sp=[
          {role:'system',content:'Synthesize the analyst answers into one concise final answer. Preserve consensus and mention material disagreement. Use only the supplied answers. Do not invent facts.'},
          {role:'user',content:'ORIGINAL REQUEST:\n'+j.prompt+'\n\nANALYST ANSWERS:\n'+bundle}
        ];
        try{
          const r=await callModel(synth,sp,20000);
          finalText=r.text; finalModel=synth;
        }catch{
          finalText=good[0].text; finalModel=good[0].model;
        }
      }

      log('COMMITTEE OK analysts='+good.length+' disagreement='+disagreement+' judge='+(judge&&judge.used?judge.model:'no'));
      return send(res,200,{
        ok:true,
        mode:judge&&judge.used?'judge':'consensus',
        disagreement,
        verdictConsensus:verdictConsensus?(vs[0]||null):null,
        analysts:good,
        failed:results.filter(x=>!x.ok),
        judge:judge||{used:false},
        model:finalModel,
        text:finalText
      });
    }

    if(req.method==='GET'&&u.pathname==='/scanner'){
      try{
        const out=await scanner.scan();
        return send(res,200,out);
      }catch(e){
        log('SCANNER FAIL '+String(e.message||e));
        return send(res,503,{ok:false,error:'scanner failed',detail:String(e.message||e)});
      }
    }
    if(req.method==='GET'&&u.pathname==='/context/global'){
      return send(res,200,await market.globalContext());
    }
    if(req.method==='GET'&&u.pathname==='/context/symbol'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      return send(res,200,await market.symbolContext(symbol));
    }
    if(req.method==='GET'&&u.pathname==='/leader/committee'){
      const scan=await scanner.scan();
      const leaderCommittee=require('./leader-committee');
      return send(res,200,await leaderCommittee.run({scan,port:PORT,token:CLIENT_TOKEN}));
    }
    if(req.method==='GET'&&u.pathname==='/leader/plan'){
      const scan=await scanner.scan();
      const out=await pipeline.run({scan,store,committee:async body=>{
        const r=await fetch('http://127.0.0.1:'+PORT+'/committee',{method:'POST',headers:{'content-type':'application/json',...(CLIENT_TOKEN?{authorization:'Bearer '+CLIENT_TOKEN}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
        const data=await r.json();
        if(!r.ok)throw new Error('committee unavailable: '+(data.error||r.status));
        return data;
      }});
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
      try{return send(res,200,{ok:true,...store.claim(body.eventId,body.owner,body.resource,body.token)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    return send(res,404,{ok:false,error:'not found'});
  }catch(e){
    log('SERVER '+String(e.stack||e));
    return send(res,500,{ok:false,error:'server error'});
  }
});

server.listen(PORT,HOST,()=>log('BrainHub listening on http://'+HOST+':'+PORT));
