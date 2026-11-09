'use strict';
// R2544.139 (09.11 15:46: the first full desk - 12 of 18 seats timed out at 60 s; reasoning models thought too long on the real 18 kB screen)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('R2544.139 keyless reasoning seats answer within the desk time: gpt-oss reasoning low, Kilo Nemotron ultra / super-vl reasoning off; the screen itself is not cut',async()=>{
  assert.match(sv,/id:'OVH:gpt-oss-120b',[^\n]*extra:\{reasoning_effort:'low'\}/);
  assert.match(sv,/id:'KILO:nvidia\/nemotron-3-ultra-550b-a55b:free',[^\n]*extra:\{reasoning:\{enabled:false\}\}/);
  assert.match(sv,/id:'KILO:nvidia\/nemotron-3\.5-super-vl:free',[^\n]*extra:\{reasoning:\{enabled:false\}\}/);
  const i=sv.indexOf('async function directAsk'),j=sv.indexOf('\n',sv.indexOf('}}',sv.indexOf('return text?',i)));
  const directAsk=eval('('+sv.slice(i,j).replace(/^async function directAsk/,'async function')+')');let body=null;
  await directAsk({base:'https://x.test/v1',model:'m',maxTokens:9,extra:{reasoning:{enabled:false}}},{system:'S',prompt:'FULL SCREEN'},async(u,o)=>{body=JSON.parse(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{}'}}]})};});
  assert.deepEqual(body.reasoning,{enabled:false});assert.equal(body.model,'m');assert.equal(body.messages[1].content,'FULL SCREEN','the prompt is sent whole');
});
