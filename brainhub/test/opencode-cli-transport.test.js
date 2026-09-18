'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {runOpenCodeCli,mapOpenCodeModel,isOpenCodeFreeRestriction}=require('../opencode-cli-transport');

test('OpenCode free restriction detector and model mapping are strict',()=>{
  assert.equal(mapOpenCodeModel('oc/muse-spark-1.3-contributor-free'),'opencode/muse-spark-1.3-contributor-free');
  assert.equal(isOpenCodeFreeRestriction(403,'FreeTierError: OpenCode free tier can only be used from within OpenCode'),true);
  assert.equal(isOpenCodeFreeRestriction(429,'rate limited'),false);
  assert.throws(()=>mapOpenCodeModel('kr/claude-sonnet-4.5'));
});

test('official OpenCode CLI transport attaches prompt and chart files without shell interpolation', {timeout:10000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-opencode-test-'));
  const fake=path.join(dir,'fake-opencode.js');
  fs.writeFileSync(fake,[
    "'use strict';",
    "const fs=require('fs');",
    "const args=process.argv.slice(2);",
    "if(!args.includes('--pure')||!args.includes('run'))process.exit(11);",
    "const mi=args.indexOf('--model');",
    "if(mi<0||args[mi+1]!=='opencode/muse-spark-1.3-contributor-free')process.exit(12);",
    "const files=[];for(let i=0;i<args.length;i++)if(args[i]==='--file')files.push(args[i+1]);",
    "if(files.length!==2)process.exit(13);",
    "if(!files.every(x=>fs.existsSync(x)))process.exit(14);",
    "const prompt=fs.readFileSync(files[0],'utf8');",
    "if(!prompt.includes('SYSTEM TEST')||!prompt.includes('USER TEST'))process.exit(15);",
    "const image=fs.readFileSync(files[1]);if(image.length<100)process.exit(16);",
    "process.stdout.write('STATUS: WATCH\\nWHY: CLI transport OK');"
  ].join('\n'),'utf8');

  const image=Buffer.alloc(256,7).toString('base64');
  const out=await runOpenCodeCli({
    model:'oc/muse-spark-1.3-contributor-free',
    messages:[
      {role:'system',content:'SYSTEM TEST'},
      {role:'user',content:[
        {type:'text',text:'USER TEST'},
        {type:'image_url',image_url:{url:'data:image/png;base64,'+image}}
      ]}
    ],
    timeoutMs:5000,
    command:process.execPath,
    prefixArgs:[fake]
  });
  assert.equal(out.transport,'opencode-cli');
  assert.equal(out.attachedImages,1);
  assert.match(out.text,/CLI transport OK/);
  fs.rmSync(dir,{recursive:true,force:true});
});
