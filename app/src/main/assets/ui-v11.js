(function(){
'use strict';
const VERSION='v11 DETAY';
const TYPE_SHORT={Yerleşim:'Yerleşim',Yol:'Tarihî yol',Konaklama:'Han / kervansaray',Savunma:'Kale / savunma',Geçiş:'Köprü / geçit',Su:'Su yapısı',Mağara:'Mağara',Yapı:'Tarihî yapı',Diğer:'Tarihî kayıt'};
const css=document.createElement('style');
css.textContent=`
.top{top:7px;left:7px;right:7px;padding:8px;border-radius:15px}.q{padding:9px 10px;font-size:15px}.b{padding:9px 11px}.chips{gap:5px;margin-top:6px}.chip{padding:6px 10px;font-size:12px}.status{gap:5px;margin-top:6px}.badge{padding:4px 7px;font-size:11px}.zoom{top:215px;left:10px}.zoom button{width:46px;height:46px}.legend{display:none!important}.nearbtn{right:68px;bottom:10px;padding:9px 11px;font-size:12px}.counter{display:none}.label.v11label{transform:translate(22px,-50%);font-size:12px;font-weight:850;padding:5px 8px;border:1px solid #ffffff66;max-width:260px;box-shadow:0 2px 8px #0008}.poi.v11poi{width:38px;height:38px;border:3px solid #fff;font-size:17px}.cluster.v11cluster{width:auto;min-width:44px;height:40px;padding:0 9px;gap:5px;border-radius:20px;display:flex;background:#101820;color:#fff}.cluster-label{position:absolute;transform:translate(25px,20px);font-size:10px;background:#101820e8;border-radius:7px;padding:3px 5px;white-space:nowrap}.map-summary{position:fixed;z-index:36;left:10px;bottom:10px;max-width:58vw;background:#101820ed;border:1px solid #ffffff22;border-radius:12px;padding:8px 10px;color:#fff;font-size:11px;line-height:1.5;box-shadow:0 5px 18px #0007}.map-summary b{font-size:12px}.v11ver{position:fixed;z-index:45;right:10px;top:176px;background:#101820e8;border:1px solid #ffffff44;border-radius:9px;padding:5px 8px;font-size:11px;font-weight:900}.loading{top:205px}.empty{top:48%}
`;
document.head.appendChild(css);
let sum=document.getElementById('mapSummary');if(!sum){sum=document.createElement('div');sum.id='mapSummary';sum.className='map-summary';document.body.appendChild(sum)}
let ver=document.getElementById('v11ver');if(!ver){ver=document.createElement('div');ver.id='v11ver';ver.className='v11ver';ver.textContent=VERSION;document.body.appendChild(ver)}else ver.textContent=VERSION;
function vRadius(){return zoom<=11?4800:zoom===12?2800:zoom===13?1900:zoom===14?1250:zoom===15?850:600}
try{queryRadius=vRadius}catch(e){};try{radius=vRadius}catch(e){}
function qa(filter,r){return `nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})${filter};`}
try{buildQuery=function(){
  const r=vRadius(),q=[],w=x=>selCategory==='Tümü'||selCategory===x||selCategory==='Potansiyel';
  if(w('Yerleşim'))q.push(qa('[historic~"^(archaeological_site|ruins)$"]',r),qa('[archaeological_site]',r),qa('[tourism=archaeological_site]',r),qa('[ruins=yes]',r));
  if(w('Yol'))q.push(qa('[historic~"^(road|route|milestone)$"]',r),qa('[route:historic=yes]',r));
  if(w('Konaklama'))q.push(qa('[historic~"^(caravanserai|inn)$"]',r),qa('[tourism=caravanserai]',r));
  if(w('Savunma'))q.push(qa('[historic~"^(castle|fort|fortification|city_gate|citywalls|tower)$"]',r),qa('[fortification_type]',Math.min(r,1800)));
  if(w('Geçiş'))q.push(qa('[historic=bridge]',r),qa('[ford=yes]',Math.min(r,1800)),qa('[mountain_pass=yes]',r));
  if(selCategory==='Tümü'&&zoom>=12||selCategory==='Su'||selCategory==='Potansiyel')q.push(qa('[historic=aqueduct]',r),qa('[natural=spring]',Math.min(r,1200)),qa('[man_made=water_well]',Math.min(r,900)));
  if(selCategory==='Tümü'&&zoom>=13||selCategory==='Mağara'||selCategory==='Potansiyel')q.push(qa('[natural=cave_entrance]',r));
  if(selCategory==='Yapı')q.push(qa('[historic]',r),qa('[heritage]',Math.min(r,1100)));
  if(selCategory==='Tümü'&&zoom>=15){q.push(qa('[historic]',Math.min(r,750)),qa('[heritage]',Math.min(r,650)));}
  return `[out:json][timeout:10];(${q.join('')});${zoom>=14?'out body geom qt;':'out body center qt;'}`;
}}catch(e){}
try{const oldClassify=classify;classify=function(t){const k=oldClassify(t);if(k!=='Diğer')return k;if(t&&((t.historic&&t.historic!=='no')||t.heritage))return'Yapı';return k}}catch(e){}
function safeCfg(kind){return CAT[kind]||CAT.Diğer}
function addV11Marker(it,showLabel){const p=screenFor(it.lat,it.lon),x=p[0],y=p[1];if(x<-90||x>innerWidth+90||y<-90||y>innerHeight+90)return;const cfg=safeCfg(it.kind),d=createEl('div');d.className='marker poi v11poi';d.style.left=x+'px';d.style.top=y+'px';d.style.background=cfg.color;d.textContent=cfg.icon;d.title=(TYPE_SHORT[it.kind]||it.kind)+' • '+it.name;d.onclick=()=>detailItem(it);markers.appendChild(d);if(showLabel){const l=createEl('div');l.className='label v11label';l.style.left=x+'px';l.style.top=y+'px';l.textContent=(TYPE_SHORT[it.kind]||it.kind)+' • '+it.name;markers.appendChild(l)}}
function addV11Cluster(list){let a=0,o=0;for(const it of list){a+=it.lat;o+=it.lon}a/=list.length;o/=list.length;const p=screenFor(a,o),x=p[0],y=p[1],kind=list[0].kind,cfg=safeCfg(kind),d=createEl('div');d.className='marker cluster v11cluster';d.style.left=x+'px';d.style.top=y+'px';d.style.borderColor=cfg.color;const ic=document.createElement('span');ic.textContent=cfg.icon;const n=document.createElement('b');n.textContent=list.length;d.append(ic,n);d.onclick=()=>setCenter(a,o,zoom+1);markers.appendChild(d);if(zoom>=12){const l=createEl('div');l.className='cluster-label';l.style.left=x+'px';l.style.top=y+'px';l.textContent=(TYPE_SHORT[kind]||kind)+' • '+list.length;markers.appendChild(l)}}
function summary(visible){if(zoom<11){sum.innerHTML='<b>Yakınlaşarak ayrıntıyı aç</b><br>Zoom 11+: çevre kayıtları • Zoom 13+: adlar • Zoom 14+: yol/alan geometrileri';return}const counts={};for(const it of visible)counts[it.kind]=(counts[it.kind]||0)+1;const order=['Yerleşim','Yol','Konaklama','Savunma','Geçiş','Su','Mağara','Yapı'];const parts=order.filter(k=>counts[k]).map(k=>`${safeCfg(k).icon} ${counts[k]}`);sum.innerHTML=`<b>${visible.length} görünür / ${publicItems.length} yüklü</b><br>${parts.join('  ')||'Bu görünümde eşleşen kayıt yok'}`}
try{addMarker=function(it){addV11Marker(it,zoom>=13)}}catch(e){}
try{addCluster=function(list){addV11Cluster(list)}}catch(e){}
try{renderOverlay=function(){
  markers.innerHTML='';svg.innerHTML='';
  if(zoom<11){summary([]);updateStatus(0);return}
  const visible=publicItems.filter(matchesFilter).sort((a,b)=>hav(lat,lon,a.lat,a.lon)-hav(lat,lon,b.lat,b.lon));
  for(const it of visible)renderGeometry(it);
  if(selCategory==='Potansiyel'){for(const c of potentialCells)renderPotential(c)}else if(zoom<=12){const cells=new Map();for(const it of visible){const p=screenFor(it.lat,it.lon),k=it.kind+':'+Math.floor(p[0]/85)+':'+Math.floor(p[1]/85);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(it)}for(const list of cells.values())list.length>1?addV11Cluster(list):addV11Marker(list[0],zoom>=12)}else{const maxLabels=zoom>=15?90:zoom===14?65:45;visible.forEach((it,i)=>addV11Marker(it,i<maxLabels));for(const c of potentialCells)renderPotential(c)}
  if(zoom>=13&&typeof window.renderProtectionOverlay==='function')try{window.renderProtectionOverlay()}catch(e){}
  summary(visible);updateStatus(visible.length);
}}catch(e){}
try{scheduleNearby=function(){clearTimeout(nearbyTimer);if(zoom<11){queryInFlight=false;networkState='idle';loading.style.display='none';renderOverlay();return}nearbyTimer=setTimeout(loadNearby,500)}}catch(e){}
const oldUpdate=typeof updateStatus==='function'?updateStatus:null;if(oldUpdate){updateStatus=function(n){oldUpdate(n);const rb=document.getElementById('recordBadge'),nb=document.getElementById('networkBadge');if(zoom<11)rb.textContent='Zoom 11+ canlı ayrıntı';else rb.textContent=`${publicItems.length} yüklü • ${n} görünür`;if(networkState==='loading')nb.textContent='Yükleniyor';else if(networkState==='ok')nb.textContent='Canlı';else if(networkState==='error')nb.textContent='Bağlantı hatası';}}
const m=document.getElementById('menu');if(m){const prev=m.onclick;m.onclick=()=>showSheet(`<h2>Harita açıklaması</h2><div class="card"><b>Zoom 11–12</b><br>Türlere göre kümeler gösterilir.</div><div class="card"><b>Zoom 13</b><br>Kayıt türü ve adı doğrudan haritada görünür.</div><div class="card"><b>Zoom 14+</b><br>Kaynakta bulunan tarihî yol/alan geometrileri çizilir.</div><div class="card"><b>Zoom 15+</b><br>Dar çevrede genel historic/heritage kayıtları da ayrıntıya katılır.</div><button class="b" onclick="retryNearby()">Veriyi yenile</button> <button class="b" onclick="closeSheet()">Kapat</button>`)}}
try{buildChips();render();scheduleNearby()}catch(e){}
})();
