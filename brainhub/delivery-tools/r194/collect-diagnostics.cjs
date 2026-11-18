'use strict';
// User-operated, read-only collection. No keys, DPAPI, POST, orders, deploy or model calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
function scrub(x){
  if(Array.isArray(x))return x.map(scrub);
  if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,/secret|token|password|authorization|api.?key|signature|cookie|private.?key/i.test(k)?'[REDACTED]':scrub(v)]));
  return typeof x==='string'?x.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/\bsk-[a-zA-Z0-9_-]{12,}/g,'[REDACTED]').replace(/([?&](?:signature|api_key|apikey|token|key)=)[^&\s"']+/gi,'$1[REDACTED]'):x;
}
function jsonFile(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function tail(file,bytes=262144){
  const fd=fs.openSync(file,'r');try{const size=fs.fstatSync(fd).size,start=Math.max(0,size-bytes),b=Buffer.alloc(size-start);fs.readSync(fd,b,0,b.length,start);
    return b.toString('utf8').split(/\r?\n/).slice(start?1:0).filter(Boolean).slice(-500).map(s=>{try{return JSON.parse(s);}catch{return s.slice(0,2000);}});
  }finally{fs.closeSync(fd);}
}
async function collect({brainRoot,out,offline=false}){
  const root=path.resolve(brainRoot),rt=path.join(root,'runtime'),target=path.resolve(out);
  if(target===rt||target.startsWith(rt+path.sep))throw new Error('OUTPUT_MUST_NOT_BE_INSIDE_RUNTIME');
  fs.mkdirSync(target,{recursive:true});const errors=[];
  const read=(label,fn)=>{try{return fn();}catch(e){errors.push({area:label,error:scrub(String(e.message).slice(0,500))});return null;}};
  const report={version:'R194_READ_ONLY_DIAGNOSTICS',at:new Date().toISOString(),node:process.version,platform:process.platform,
    activity:{configurationWrites:0,modelCalls:0,exchangeCalls:0,orderCalls:0,deploys:0},errors,config:{},state:{},files:{},logs:{}};
  for(const name of ['trading-mode.json','leader-auto.json','top3-hunter.json','zirve5.json','kesif-soz.json','jev.json','position-desk.json','user-sizing.json','lane-selection.json']){
    const file=path.join(rt,'config',name);if(fs.existsSync(file))report.config[name]=read(name,()=>scrub(jsonFile(file)));
  }
  for(const name of ['top3-hunter-state.json','zirve5-state.json','kesif-state.json']){
    const file=path.join(rt,'data',name);if(!fs.existsSync(file))continue;
    const data=read(name,()=>jsonFile(file));if(!data)continue;
    report.state[name]=Object.fromEntries(['lastAt','lastScan','lastScan5','lastGate','lastEntry','active','armed','lastError','lastTick','settings','lastDecision','lastRun','stats','lastRoundAt','lastIzAt','lastResolveAt','goxelLiveError'].filter(k=>Object.hasOwn(data,k)).map(k=>[k,scrub(data[k])]));
    report.state[name].lessonCount=Array.isArray(data.lessons)?data.lessons.length:null;
    report.state[name].recentDecisions=scrub((data.recent||data.recentSignals||data.sozRecent||data.decisions||[]).slice(0,30));
    if(data.z5&&typeof data.z5==='object')report.state[name].z5=scrub({lastGate:data.z5.lastGate,lastScan:data.z5.lastScan,lastBar:data.z5.lastBar,
      pending:data.z5.pending,armed:data.z5.armed,recent:(data.z5.recent||[]).slice(0,30),lessonCount:Array.isArray(data.z5.lessons)?data.z5.lessons.length:null});
  }
  for(const relative of ['BEKLENEN-SURUM.txt','BEKLENEN-PUBLIC.txt','runtime/server/server.js','runtime/server/jev-decision.js','runtime/server/live-controller.js','runtime/server/position-desk.js','runtime/server/kesif.js','runtime/server/model-committee.js','runtime/office-dashboard/office-server.js']){
    const file=path.join(root,relative);if(fs.existsSync(file))report.files[relative]=read(relative,()=>({sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      ...(relative.endsWith('.txt')?{value:fs.readFileSync(file,'utf8').trim()}: {})}));
  }
  if(fs.existsSync(path.join(root,'source','.git'))){
    const r=spawnSync('git',['-C',path.join(root,'source'),'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,timeout:10000});
    report.source={head:r.status===0?r.stdout.trim():null,error:r.status===0?null:scrub(String(r.stderr||r.error||'GIT_FAILED').slice(0,300))};
  }
  for(const name of ['jev-request-size.log','jev-request-result.log','jev-http-error.log','decision-failover.log']){
    const file=path.join(rt,'logs',name);if(fs.existsSync(file))report.logs[name]=read(name,()=>scrub(tail(file)));
  }
  const dbFile=path.join(rt,'data','brainhub.sqlite');
  if(fs.existsSync(dbFile))read('journal',()=>{
    const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(dbFile,{readOnly:true});
    try{
      const kinds=['TOP3_SIGNAL','TOP3_JEV_REVIEW','TOP3_BLOCKED','TOP3_ENTRY','TOP3_JEV_REJECT','TOP3_COMMITTEE_SKIP','TOP3_SIGNAL_EXPIRED','TOP3_HELD_ENTRY',
        'ZIRVE5_SCAN','ZIRVE5_JEV_REVIEW','ZIRVE5_BLOCKED','ZIRVE5_ENTRY','ZIRVE5_COMMITTEE_SKIP','KESIF_SOZ_ENTRY','KESIF_SOZ_BLOCKED','KESIF_SOZ_GOXEL_RED','KESIF_SOZ_SETTINGS',
        'ENTRY_SCREEN_GATE','RUN_CONTROL','RUN_CONTROL_FAILED','RUN_CONTROL_REFUSED','LIVE_EXECUTION','TRADING_MODE_CHANGED','TOP3_CONFIG_CHANGED','ZIRVE5_CONFIG_CHANGED',
        'TOP3_CLOSED','POSITION_CLOSED','CLOSE_EXIT_EVIDENCE','POSITION_DESK_REVIEW','POSITION_DESK_UNAVAILABLE','POSITION_DESK_EXIT','POSITION_DESK_EXIT_FAILED','POSITION_DESK_ORDER_EXPIRED'];
      const since=Date.now()-24*3600000;
      report.journal=db.prepare('SELECT id,ts,kind,symbol,payload FROM journal WHERE ts>=? AND kind IN ('+kinds.map(()=>'?').join(',')+') ORDER BY ts DESC LIMIT 3000').all(since,...kinds)
        .map(r=>({...r,payload:read('row '+r.id,()=>scrub(JSON.parse(r.payload)))}));
      report.journalWindow={since:new Date(since).toISOString(),limit:3000,returned:report.journal.length};
      report.counts=Object.fromEntries(kinds.map(k=>[k,report.journal.filter(r=>r.kind===k).length]));
    }finally{db.close();}
  });
  if(!offline){
    try{const r=await fetch('http://127.0.0.1:8790/api/snapshot',{signal:AbortSignal.timeout(12000)});report.office={httpStatus:r.status,...(r.ok?{snapshot:scrub(await r.json())}:{})};}
    catch(e){errors.push({area:'office',error:scrub(String(e.message).slice(0,300))});}
  }
  const traces=path.join(rt,'logs','entry-decisions');
  if(fs.existsSync(traces)){
    const list=fs.readdirSync(traces).filter(x=>/^[a-f0-9-]+\.json$/i.test(x)).map(x=>({name:x,at:fs.statSync(path.join(traces,x)).mtimeMs})).sort((a,b)=>b.at-a.at).slice(0,30);
    // Keep the trace referenced by an actual entry even if later scans have
    // already displaced it from the newest 30 files. Accept UUID filenames only.
    const byName=new Map(list.map(x=>[x.name,x]));
    for(const row of (report.journal||[]).filter(x=>/^(TOP3|ZIRVE5)_ENTRY$/.test(x.kind)).slice(0,30)){
      const ref=row.payload?.entryFeatures?.jevVote?.entryTrace;
      const name=String(ref?.requestId||'')+'.json';
      if(/^[a-f0-9-]+\.json$/i.test(name)&&fs.existsSync(path.join(traces,name)))byName.set(name,{name});
    }
    report.entryTraces=[...byName.values()].map(x=>read(x.name,()=>scrub(jsonFile(path.join(traces,x.name))))).filter(Boolean);
  }
  fs.writeFileSync(path.join(target,'JEV-TESHIS.json'),JSON.stringify(scrub(report),null,2),'utf8');
  fs.writeFileSync(path.join(target,'README.txt'),'Salt okunur teşhis: mevcut ayarlar/durum, son 24 saatten en çok 3000 seçili olay, sınırlı günlük kuyrukları. Anahtarlar çıktıda maskelenir; DPAPI ve auth.json dosyaları okunmaz. Hiçbir ayar/emir/deploy değişikliği yapılmaz. JSON dosyasını paylaşmadan önce inceleyebilirsiniz.\r\n','utf8');
  return {report,out:target};
}
if(require.main===module){
  const arg=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
  const brainRoot=arg('--brain-root')||'C:\\JEV-Brain',out=arg('--out')||path.join(os.homedir(),'Downloads','JEV-TESHIS-'+Date.now());
  collect({brainRoot,out,offline:process.argv.includes('--offline')}).then(({out,report})=>{
    let zip=null;
    if(process.platform==='win32'){
      const z=spawnSync('powershell.exe',['-NoProfile','-Command','Compress-Archive -LiteralPath $env:JEV_DIAG_INPUT -DestinationPath $env:JEV_DIAG_OUTPUT -ErrorAction Stop'],
        {env:{...process.env,JEV_DIAG_INPUT:out,JEV_DIAG_OUTPUT:out+'.zip'},encoding:'utf8',windowsHide:true,timeout:30000});
      if(z.status===0)zip=out+'.zip';
    }
    process.stdout.write('JEV_TESHIS_OK\n'+(zip?'ZIP: '+zip:'DOSYA: '+path.join(out,'JEV-TESHIS.json'))+'\nEksik/erisim sorunu: '+report.errors.length+'\n');
  }).catch(e=>{console.error('JEV_TESHIS_FAILED: '+scrub(String(e.message)));process.exitCode=1;});
}
module.exports={scrub,collect};
