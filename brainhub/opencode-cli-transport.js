'use strict';

const fs=require('fs');
const fsp=fs.promises;
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');

function mapOpenCodeModel(model){
  const m=String(model||'').trim();
  if(!/^oc\/[A-Za-z0-9._-]+$/.test(m))throw new Error('invalid OpenCode model id');
  return 'opencode/'+m.slice(3);
}

function isOpenCodeFreeRestriction(status,raw){
  const text=String(raw||'');
  return Number(status)===403 && /FreeTierError|free tier can only be used from within OpenCode/i.test(text);
}

function cleanText(v){
  return String(v==null?'':v).replace(/\u0000/g,'').trim();
}

function collectPrompt(messages){
  const imageData=[];
  const rows=[];
  for(const msg of Array.isArray(messages)?messages:[]){
    const role=String(msg?.role||'user').toUpperCase();
    const content=msg?.content;
    rows.push('### '+role);
    if(typeof content==='string'){
      rows.push(cleanText(content));
    }else if(Array.isArray(content)){
      for(const part of content){
        if(typeof part==='string')rows.push(cleanText(part));
        else if(part?.type==='text')rows.push(cleanText(part.text));
        else if(part?.type==='image_url'){
          const url=String(part?.image_url?.url||'');
          imageData.push(url);
          rows.push('[ATTACHED_IMAGE_'+imageData.length+']');
        }
      }
    }else if(content!=null){
      rows.push(cleanText(content));
    }
    rows.push('');
  }
  return {text:rows.join('\n').trim(),imageData};
}

function decodeImageDataUrl(url,index){
  const m=String(url||'').match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(!m)throw new Error('unsupported OpenCode image attachment '+index);
  const ext=m[1].toLowerCase()==='jpg'?'jpeg':m[1].toLowerCase();
  const bytes=Buffer.from(m[2],'base64');
  if(bytes.length<100||bytes.length>2_000_000)throw new Error('invalid OpenCode image size '+index);
  return {bytes,ext};
}

function safeEnv(){
  const permissions=[{action:'*',resource:'*',effect:'deny'}];
  const inline={
    default_agent:'brainhub',
    agents:{
      brainhub:{
        description:'BrainHub read-only model transport',
        mode:'primary',
        system:'You are a pure inference transport for BrainHub. Use only the attached request and images. Do not use tools, shell, web, files outside the attachments, subagents, edits, or external actions. Return only the answer requested by the attachment.',
        steps:1,
        permissions
      }
    }
  };
  return {
    ...process.env,
    OPENCODE_CONFIG_CONTENT:JSON.stringify(inline),
    OPENCODE_DISABLE_AUTOUPDATE:'true',
    OPENCODE_DISABLE_TERMINAL_TITLE:'true'
  };
}

function spawnCapture(command,args,{cwd,env,timeoutMs}){
  return new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawn(command,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    }catch(e){
      e.code=e.code||'OPENCODE_CLI_SPAWN_FAILED';
      return reject(e);
    }
    let stdout='',stderr='';
    const max=2*1024*1024;
    child.stdout.on('data',d=>{if(stdout.length<max)stdout+=String(d);});
    child.stderr.on('data',d=>{if(stderr.length<max)stderr+=String(d);});
    let timedOut=false;
    const timer=setTimeout(()=>{
      timedOut=true;
      try{child.kill();}catch{}
    },Math.max(5000,Number(timeoutMs)||90000));
    child.once('error',e=>{
      clearTimeout(timer);
      if(e&&e.code==='ENOENT')e.code='OPENCODE_CLI_UNAVAILABLE';
      reject(e);
    });
    child.once('close',(code,signal)=>{
      clearTimeout(timer);
      if(timedOut){
        const e=new Error('OpenCode CLI timeout after '+timeoutMs+'ms');
        e.code='OPENCODE_CLI_TIMEOUT';
        return reject(e);
      }
      if(code!==0){
        const detail=cleanText(stderr||stdout).slice(0,1200);
        const e=new Error('OpenCode CLI exit '+code+(signal?' signal '+signal:'')+(detail?': '+detail:''));
        e.code='OPENCODE_CLI_FAILED';
        e.exitCode=code;
        return reject(e);
      }
      const text=cleanText(stdout);
      if(!text){
        const e=new Error('OpenCode CLI returned empty output');
        e.code='OPENCODE_CLI_EMPTY';
        return reject(e);
      }
      resolve({text,stderr:cleanText(stderr)});
    });
  });
}

async function runOpenCodeCli({model,messages,timeoutMs=90000,command=null,prefixArgs=[]}){
  const mappedModel=mapOpenCodeModel(model);
  const parsed=collectPrompt(messages);
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'brainhub-opencode-'));
  try{
    const promptPath=path.join(dir,'brainhub-request.txt');
    await fsp.writeFile(promptPath,parsed.text+'\n','utf8');
    const files=[promptPath];
    for(let i=0;i<parsed.imageData.length;i++){
      const decoded=decodeImageDataUrl(parsed.imageData[i],i+1);
      const file=path.join(dir,'chart-'+String(i+1).padStart(2,'0')+'.'+decoded.ext);
      await fsp.writeFile(file,decoded.bytes);
      files.push(file);
    }
    const bin=command||String(process.env.BRAINHUB_OPENCODE_BIN||'opencode').trim()||'opencode';
    const args=[
      ...prefixArgs,
      '--pure',
      'run',
      '--agent','brainhub',
      '--model',mappedModel,
      ...files.flatMap(file=>['--file',file]),
      'Read brainhub-request.txt and every attached image as the complete request. Return only the requested answer.'
    ];
    const out=await spawnCapture(bin,args,{cwd:dir,env:safeEnv(),timeoutMs});
    return {
      model,
      mappedModel,
      text:out.text,
      transport:'opencode-cli',
      attachedImages:parsed.imageData.length
    };
  }finally{
    await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

async function probeOpenCodeCli({command=null,prefixArgs=[]}={}){
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'brainhub-opencode-probe-'));
  try{
    const bin=command||String(process.env.BRAINHUB_OPENCODE_BIN||'opencode').trim()||'opencode';
    try{
      const out=await spawnCapture(bin,[...prefixArgs,'--version'],{cwd:dir,env:{...process.env,OPENCODE_DISABLE_AUTOUPDATE:'true'},timeoutMs:10000});
      return {ok:true,command:bin,version:cleanText(out.text).split(/\r?\n/)[0].slice(0,160)};
    }catch(e){
      return {ok:false,command:bin,errorCode:String(e?.code||''),error:String(e?.message||e).slice(0,500)};
    }
  }finally{
    await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

module.exports={mapOpenCodeModel,isOpenCodeFreeRestriction,collectPrompt,runOpenCodeCli,probeOpenCodeCli};
