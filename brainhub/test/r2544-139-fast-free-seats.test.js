'use strict';
// R2544.139 (09.11 15:46: the first full desk - 12 of 18 seats timed out at 60 s; reasoning models thought too long on the real 18 kB screen)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('R2544.139 keyless reasoning seats answer within the desk time: gpt-oss reasoning low, Kilo Nemotron ultra / super-vl reasoning off; the screen itself is not cut',async()=>{
  // R2544.141: the thinking is back ON (thinking-off seats voted an action 41 of 48 times); the seats get time and tokens instead
  const block=sv.slice(sv.indexOf('const DIRECT_FREE=['),sv.indexOf('async function directAsk'));
  assert.ok(!/reasoning_effort:'low'|reasoning:\{enabled:false\}/.test(block));
  const i=sv.indexOf('async function directAsk'),j=sv.indexOf('const directMembers=()=>',i); // R2544.147
  const directAsk=eval('('+sv.slice(i,j).trimEnd().replace(/^async function directAsk/,'async function')+')');let body=null;
  await directAsk({base:'https://x.test/v1',model:'m',maxTokens:9,extra:{reasoning:{enabled:false}}},{system:'S',prompt:'FULL SCREEN'},async(u,o)=>{body=JSON.parse(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{}'}}]})};});
  assert.deepEqual(body.reasoning,{enabled:false});assert.equal(body.model,'m');assert.equal(body.messages[1].content,'FULL SCREEN','the prompt is sent whole');
});
