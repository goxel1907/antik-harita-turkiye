'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8');
const start=html.indexOf('async function wcSave('),end=html.indexOf('\n}\n',start)+2,source=html.slice(start,end);
function setup(live,response){
 const els={m:{value:'40',dataset:{dirty:'1'}},l:{value:'10',dataset:{dirty:'1'}}},calls=[],messages=[];
 const c={WC:{live,busy:false,sizing:{top3:{revision:'old-r',marginQuote:30,leverage:10}}},document:{getElementById:id=>els[id]},Number,String,
 secondPress:()=>false,wcMsg:m=>messages.push(m),wcWhy:()=> 'çakışma',wcPost:async(p,b)=>{calls.push({p,b});return response;},tick:async()=>{}};
 vm.createContext(c);vm.runInContext(source+';this.save=wcSave;',c);
 return {c,els,calls,messages,run:()=>c.save({k:'top3',name:'İlk 3',m:'m',l:'l'})};
}
test('saving LIVE preference is a single explicit save, without trading or another confirmation',async()=>{
 const t=setup(true,{ok:true,d:{ok:true,lane:'top3',marginQuote:40,leverage:10,revision:'new-r'}});
 await t.run();a.equal(t.calls.length,1);a.equal(t.calls[0].p,'/api/control/sizing');
 a.equal(t.calls[0].b.lane,'top3');a.equal(t.calls[0].b.expectedRevision,'old-r');a.equal('confirm' in t.calls[0].b,false);
});
test('success text uses accepted persistent response, not the submitted form value',async()=>{
 const t=setup(false,{ok:true,d:{ok:true,lane:'top3',marginQuote:15,leverage:10,revision:'new-r'}});
 await t.run();a.match(t.messages.join('\n'),/15/);a.equal(t.els.m.dataset.dirty,undefined);
});
test('a rejected stale save preserves the user draft for review',async()=>{
 const t=setup(false,{ok:false,d:{ok:false,reasons:['SIZING_CONFLICT'],current:{marginQuote:100}}});
 await t.run();a.equal(t.els.m.value,'40');a.equal(t.els.m.dataset.dirty,'1');a.doesNotMatch(t.messages.join('\n'),/✓/);
});

test('two forms of the same lane keep independent draft revisions',async()=>{
 const t=setup(false,{ok:false,d:{ok:false,reasons:['SIZING_CONFLICT'],current:{marginQuote:100,revision:'new-r'}}});
 t.c.WC.sizing.top3.revision='new-r';t.c.WC.drafts={m:'old-r',t3Margin:'new-r'};
 await t.run();a.equal(t.calls[0].b.expectedRevision,'old-r');a.equal(t.els.m.dataset.dirty,'1');
});

test('zero balance UI separates a saved collateral preference from the calculated entry requirement',()=>{
 const i=html.indexOf('function wcSizingAvailability('),e=html.indexOf('\n}',i)+2,ctx={wcNum:x=>x===null?null:Number(x),wcUsd:x=>String(x),Math};
 vm.createContext(ctx);vm.runInContext(html.slice(i,e)+';this.show=wcSizingAvailability;',ctx);
 const text=ctx.show(1000,10,true,0);a.match(text,/tercih korundu/);a.match(text,/1052.64/);a.match(text,/mevcut 0/);
 a.equal(ctx.show(1000,10,true,1100),'');a.equal(ctx.show(1000,10,false,0),'');
});
