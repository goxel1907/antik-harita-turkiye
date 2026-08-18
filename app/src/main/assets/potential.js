(function(){
'use strict';
if(typeof L==='undefined'||typeof map==='undefined') return;

const landscapeLayer=L.layerGroup().addTo(map);
let landscapeEnabled=true;
let lastLandscapeKey='';
let landscapeCount=0;

function esc2(v){return String(v==null?'':v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
function bbox2(){const b=map.getBounds();return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;}
function key2(){const b=map.getBounds(),z=Math.floor(map.getZoom());return [z,b.getSouth().toFixed(3),b.getWest().toFixed(3),b.getNorth().toFixed(3),b.getEast().toFixed(3)].join(':');}
function featureClass(t){
 const h=(t.historic||'').toLowerCase();
 if(h==='road'||t['route:historic']==='yes') return ['Tarihî yol','road',4];
 if(h==='caravanserai'||h==='inn'||/han|kervansaray|caravan/i.test((t.name||'')+' '+(t.description||''))) return ['Konaklama / menzil','rest',4];
 if(h==='bridge'||t.ford==='yes'||t.bridge==='yes') return ['Geçiş / köprü / ford','cross',3];
 if(t.mountain_pass==='yes') return ['Dağ geçidi','pass',3];
 if(t.natural==='spring'||t.amenity==='drinking_water') return ['Su erişimi','water',2];
 if(h==='castle'||h==='fort'||h==='fortification'||t.fortification_type) return ['Savunma bağlamı','defense',4];
 if(t.natural==='cave_entrance') return ['Yayımlanmış mağara','cave',2];
 if(h==='archaeological_site'||h==='ruins'||t.archaeological_site||t.tourism==='archaeological_site') return ['Yerleşim / arkeoloji','settlement',4];
 return ['Tarihî bağlam','other',1];
}
function styleFor(k){return ({road:'#8f4d30',rest:'#c48525',cross:'#3c86a8',pass:'#7b6550',water:'#3c91c3',defense:'#78506e',cave:'#656565',settlement:'#9b3d35',other:'#777'})[k]||'#777';}
function radiusFor(z,score){if(z>=14)return score>=7?900:1200;if(z>=13)return score>=7?1200:1600;if(z>=12)return 2200;return 3500;}
function cellSize(z){return z>=14?.010:z>=13?.016:z>=12?.025:.04;}
function addInfoCell(cell,z){
 const score=Math.min(10,cell.score);
 const radius=radiusFor(z,score);
 const color=score>=7?'#bd4b4b':score>=4?'#c28a3b':'#8d7b68';
 const c=L.circle([cell.lat/cell.n,cell.lon/cell.n],{radius,color,weight:2,dashArray:score>=7?'':'7 6',fillColor:color,fillOpacity:score>=7?.15:.08}).addTo(landscapeLayer);
 c.bindTooltip(`Koruma bağlamı ${score}/10`,{permanent:z>=14,direction:'center',className:'public-label'});
 c.on('click',()=>{
   const by={};cell.items.forEach(i=>{by[i.label]=(by[i.label]||0)+1});
   const reasons=Object.entries(by).map(([k,v])=>`<span class="tag">${esc2(k)} × ${v}</span>`).join('');
   if(typeof showSheet==='function')showSheet(`<h2>Potansiyel tarihî kullanım / koruma alanı</h2><div class="ok">Model skoru: ${score}/10 • ${Math.round(radius/100)/10} km yaklaşık koruma çevresi</div><p class="muted">Bu hücre yalnız kamuya açık tarihî/peyzaj göstergelerinin birlikte görülmesine göre oluşturuldu.</p><div>${reasons}</div><div class="detailGrid"><div class="k">Göstergeler</div><div class="v">${cell.items.length}</div><div class="k">Kaynak</div><div class="v">OpenStreetMap kamu verisi + uygulama bağlam modeli</div><div class="k">Hassasiyet</div><div class="v">Bölgesel; kesin arkeolojik hedef değildir</div></div><div class="warn">Bu alan “saklama/define noktası” tahmini değildir. Koruma, saha ön inceleme ve kaynak karşılaştırması için bölgesel bağlamdır.</div><button class="b" onclick="closeSheet()">Kapat</button>`);
 });
}
async function loadLandscape(){
 if(!landscapeEnabled||map.getZoom()<11)return;
 const k=key2();if(k===lastLandscapeKey)return;lastLandscapeKey=k;
 const bb=bbox2();
 const q=`[out:json][timeout:22];(nwr[historic=road](${bb});nwr[historic=caravanserai](${bb});nwr[historic=inn](${bb});nwr[historic=bridge](${bb});nwr[historic=castle](${bb});nwr[historic=fort](${bb});nwr[historic=archaeological_site](${bb});nwr[historic=ruins](${bb});nwr[archaeological_site](${bb});nwr[tourism=archaeological_site](${bb});node[mountain_pass=yes](${bb});node[ford=yes](${bb});node[natural=spring](${bb});node[natural=cave_entrance](${bb}););out center tags 500;`;
 try{
   const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(q)});
   if(!r.ok)throw new Error('HTTP '+r.status);
   const j=await r.json();landscapeLayer.clearLayers();
   const z=map.getZoom(),step=cellSize(z),cells=new Map();let sourceCount=0;
   (j.elements||[]).forEach(el=>{
     const lat=el.lat??el.center?.lat,lon=el.lon??el.center?.lon;if(lat==null||lon==null)return;
     const t=el.tags||{},fc=featureClass(t),label=fc[0],kind=fc[1],weight=fc[2];sourceCount++;
     const name=t.name||t['name:tr']||t.old_name||label;
     const marker=L.circleMarker([lat,lon],{radius:z>=14?5:3,color:styleFor(kind),fillColor:styleFor(kind),fillOpacity:.85,weight:1.5}).addTo(landscapeLayer);
     if(z>=13) marker.bindTooltip(esc2(name),{permanent:z>=15,direction:'top',className:'public-label'});
     marker.on('click',()=>{if(typeof showSheet==='function')showSheet(`<h2>${esc2(name)}</h2><div class="ok">${esc2(label)} • kamuya açık kayıt</div><div class="detailGrid"><div class="k">Tür</div><div class="v">${esc2(label)}</div><div class="k">Kaynak</div><div class="v">OpenStreetMap ${esc2(el.type)} ${esc2(el.id)}</div><div class="k">Tarih/dönem</div><div class="v">${esc2(t.start_date||t.period||t.historic||'Belirtilmemiş')}</div><div class="k">Eski ad</div><div class="v">${esc2(t.old_name||t['old_name:tr']||'—')}</div></div><div class="warn">Kamu haritasındaki mevcut kayıt; tarihsel yorum için ayrıca literatür doğrulaması gerekir.</div><button class="b" onclick="closeSheet()">Kapat</button>`)});
     const a=Math.floor(lat/step),b=Math.floor(lon/step),ck=a+':'+b;
     if(!cells.has(ck))cells.set(ck,{lat:0,lon:0,n:0,score:0,items:[]});
     const c=cells.get(ck);c.lat+=lat;c.lon+=lon;c.n++;c.score+=weight;c.items.push({label,kind,name});
   });
   landscapeCount=0;
   cells.forEach(c=>{const kinds=new Set(c.items.map(i=>i.kind));if(c.n>=2||kinds.size>=2){c.score+=Math.min(3,kinds.size-1);addInfoCell(c,z);landscapeCount++;}});
   const zb=document.getElementById('zoomBadge');if(zb)zb.textContent=`${sourceCount} bağlam göstergesi • ${landscapeCount} koruma hücresi`;
   const cb=document.getElementById('countbox');if(cb)cb.textContent=`Yerel çevre: ${sourceCount} gösterge • ${landscapeCount} potansiyel hücre`;
 }catch(e){console.log('landscape',e);}
}
let landscapeTimer=null;function scheduleLandscape(){clearTimeout(landscapeTimer);landscapeTimer=setTimeout(loadLandscape,750);}
map.on('moveend zoomend',scheduleLandscape);
const oldLegend=typeof drawLegend==='function'?drawLegend:null;
if(oldLegend){drawLegend=function(){oldLegend();const el=document.getElementById('legend');if(el)el.innerHTML+=`<div><span style="color:#bd4b4b">◌</span> Potansiyel tarihî kullanım / koruma hücresi</div><div class="tiny">Zoom 11+: bağlam; 13–14+: daha dar koruma hücreleri.</div>`;};drawLegend();}
setTimeout(scheduleLandscape,1300);
})();
