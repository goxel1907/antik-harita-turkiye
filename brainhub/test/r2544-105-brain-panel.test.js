'use strict';
// R2544.105 BEYİN — NE ÖĞRENDİ (kullanıcı 02.11: "beynin öğrenimini kaldırmışsın, beyin neyi öğrendi nereden bileceğiz"; "beyni de afilli bir
// animasyonla göster"; "açılan pozisyonu takip grafiklerini hep kaldırmışsın"). Yalnız gösterim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
test('R2544.105 brain model: loss / win causes as bars, only a "son dersler + 6 ay" line is a lesson ("... gerekir" is a wait), latest autopsies',()=>{
  const a=html.indexOf('// ---------- R2544.105 BEYİN'),b=html.indexOf('// R2544.105 beyin animasyonu');const src=html.slice(a,b);
  const ctx={console,Date,Math,Number,String,JSON,Array,Object};vm.createContext(ctx);vm.runInContext(src+';this.brModel=brModel;this.brParse=brParse;',ctx);
  const p=ctx.brParse('Kayıplar (33) nasıl oldu: giriş öncesi koşu %67, yön yanlış %61, hızlı ters dönüş %55 • yön doğru 12 / yanlış 20');
  assert.equal(p.kind,'Kayıplar');assert.equal(p.n,33);assert.equal(p.items.length,3);assert.equal(p.items[1].label,'yön yanlış');assert.equal(p.items[1].pct,61);assert.match(p.extra,/yön doğru 12/);
  const s={top3:{learning:{lessons:98,causes:{SHORT_TOP_BREAK:['Kazançlar (11) nasıl oldu: temiz devam %55, BTC destekledi %55','Ayırt edici (son dersler + 6 ay aynı yönde): BTC işlem süresince yönde (kayıp %0 / kazanç %55; 6 ay %5 / %31)',
    'Son derslerde ayırt edici görünüyor ama 6 ayda TUTMUYOR (ders sayılmaz): x','6 aylık hafıza: y']},autopsies:[{symbol:'XANUSDT',R:-1.11,text:'stop avlandı'}]}},
    zirve5:{learning:{lessons:12,causes:{ZIRVE5_FIBO_LONG:['Ayırt edicilik için her iki tarafta en az 8 otopsili ders gerekir (şimdi kayıp 0, kazanç 3).']},recent:[{symbol:'BTWUSDT',R:0.98,autopsy:'hedef erken'}]}}};
  const m=ctx.brModel(s);assert.equal(m.lessons,110);assert.equal(m.ders,1,'the "gerekir" line is not a lesson');
  const c=m.cards.find(x=>x.key==='SHORT_TOP_BREAK');assert.equal(JSON.stringify(c.lines.map(x=>x.cls)),JSON.stringify(['ders','no','mem']));assert.equal(c.win.n,11);
  assert.equal(m.cards.find(x=>x.key==='ZIRVE5_FIBO_LONG').lines[0].cls,'wait');assert.equal(m.auto.length,2);
});
test('R2544.105 wiring: brain panel with its animation inside the command center; open-position charts and the gainer ladder stay in the compact view',()=>{
  assert.match(html,/<div class="cc-panel cc-brain" id="ccBrain">/);assert.match(html,/<canvas id="brCanvas"/);assert.match(html,/try\{renderBrain\(s\);\}catch\(e\)\{console\.warn\('brain',e\);\}/);
  assert.match(html,/el\.classList\.contains\('mirror-wide'\)\|\|el\.querySelector\?\.\('#ladderMeta'\)/);
  const a=html.indexOf('// ---------- R2544.105 BEYİN'),b=html.indexOf('// ---------- R2544.104 KOMUTA MERKEZİ');assert.doesNotMatch(html.slice(a,b),/fetch\(|\/api\/control/,'display only');
});
