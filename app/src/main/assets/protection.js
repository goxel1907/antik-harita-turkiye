(function(){
  'use strict';
  const STORAGE_KEY='antik_harita_protection_observations_v1';
  const SIGNS=[
    ['fresh_pit','Taze kazı çukuru / yeni açılmış toprak',3],
    ['spoil','Yeni toprak-moloz yığını',2],
    ['tool_marks','Yeni alet / kırma izi',2],
    ['vehicle_tracks','Alana yönelen yeni araç veya yoğun ayak izi',1],
    ['moved_stone','Yerinden oynatılmış / kırılmış taş-duvar parçası',2],
    ['new_path','Yeni oluşmuş patika veya giriş izi',1],
    ['detector_activity','İzinsiz dedektör kullanımına ilişkin doğrudan gözlem',3],
    ['repeat_visits','Tekrarlayan şüpheli ziyaret gözlemi',2]
  ];
  let observations=[];
  try{ observations=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); if(!Array.isArray(observations))observations=[]; }catch(e){ observations=[]; }
  const roundCoord=v=>Math.round(v*100)/100; // yaklaşık 1 km; tam hedef koordinatı gösterme
  const esc2=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function save(){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(observations.slice(-300)));}catch(e){} }
  function score(signs){ let s=0; for(const id of signs){ const x=SIGNS.find(a=>a[0]===id); if(x)s+=x[2]; } return Math.min(10,s); }
  function level(s){ return s>=7?'Yüksek':s>=4?'Orta':'Düşük'; }
  function btn(){
    let b=document.getElementById('protectionBtn');
    if(b)return;
    b=document.createElement('button'); b.id='protectionBtn'; b.textContent='🛡';
    b.title='Yağma riski / saha gözlemi';
    Object.assign(b.style,{position:'fixed',zIndex:'55',right:'12px',bottom:'58px',width:'48px',height:'48px',border:'0',borderRadius:'14px',background:'#efc768',color:'#1b1408',fontSize:'23px',fontWeight:'900',boxShadow:'0 5px 18px #0007'});
    b.onclick=openProtection;
    document.body.appendChild(b);
  }
  function openProtection(){
    const near=nearbyObs();
    let h='<h2>🛡 Yağma / bozulma erken uyarı</h2>'+
      '<div class="warn">Bu mod define veya saklama yeri ipucu üretmez. Yalnız gözlenen bozulma/kaçak müdahale belirtilerini koruma amacıyla kaydeder. Konum ekranda yaklaşık 1 km düzeyinde genelleştirilir.</div>'+
      '<div class="card"><b>Bu görünümde kayıtlı koruma gözlemi:</b> '+near.length+'<br><span class="muted">Aynı cihazda tutulur.</span></div>'+
      '<button class="b" onclick="window.newProtectionObservation()">Yeni saha gözlemi</button> ' +
      '<button class="b" onclick="closeSheet()">Kapat</button>';
    if(near.length){ h+='<h3>Yakındaki gözlemler</h3>'; for(const o of near.slice(-15).reverse()) h+=obsCard(o); }
    showSheet(h);
  }
  function obsCard(o){
    const s=score(o.signs||[]), names=(o.signs||[]).map(id=>{const x=SIGNS.find(a=>a[0]===id);return x?x[1]:id}).join(', ');
    return '<div class="card"><b>'+level(s)+' koruma riski • '+s+'/10</b><br><span class="muted">'+new Date(o.time).toLocaleString('tr-TR')+'</span><br>'+esc2(names)+(o.note?'<br><span class="muted">'+esc2(o.note)+'</span>':'')+'</div>';
  }
  window.newProtectionObservation=function(){
    let h='<h2>Yeni saha gözlemi</h2><div class="card">';
    for(const [id,label] of SIGNS) h+='<label style="display:block;padding:7px 0"><input type="checkbox" class="protSign" value="'+id+'"> '+esc2(label)+'</label>';
    h+='</div><textarea id="protNote" placeholder="Kısa gözlem notu (isteğe bağlı)" style="width:100%;min-height:80px;border-radius:10px;padding:10px;background:#0c1218;color:#fff;border:1px solid #566472"></textarea>'+
      '<div class="warn">Yalnız gördüğünüz fiziksel/insan kaynaklı bozulmayı kaydedin. “Burada define olabilir” gibi tahminler koruma puanına dahil edilmez.</div>'+
      '<button class="b" onclick="window.saveProtectionObservation()">Kaydet</button> <button class="b" onclick="window.openProtectionPanel()">Geri</button>';
    showSheet(h);
  };
  window.saveProtectionObservation=function(){
    const signs=[...document.querySelectorAll('.protSign:checked')].map(x=>x.value);
    if(!signs.length){ alert('En az bir gözlenen bozulma belirtisi seçin.'); return; }
    const note=(document.getElementById('protNote')||{}).value||'';
    const o={lat:roundCoord(lat),lon:roundCoord(lon),time:Date.now(),signs,note:String(note).slice(0,500)};
    observations.push(o); save(); renderOverlay(); openProtection();
  };
  window.openProtectionPanel=openProtection;
  function nearbyObs(){
    if(typeof bbox!=='function')return observations;
    const b=bbox(); return observations.filter(o=>o.lat<=b[0]&&o.lat>=b[2]&&o.lon>=b[1]&&o.lon<=b[3]);
  }
  function renderProtection(){
    if(!window.markers && typeof markers==='undefined')return;
    const target=(typeof markers!=='undefined')?markers:window.markers;
    for(const o of observations){
      const p=screenFor(o.lat,o.lon),x=p[0],y=p[1];
      if(x<-50||x>innerWidth+50||y<-50||y>innerHeight+50)continue;
      const s=score(o.signs||[]),d=document.createElement('div');
      d.className='marker poi'; d.style.left=x+'px'; d.style.top=y+'px';
      d.style.background=s>=7?'#b13d36':s>=4?'#d18422':'#637887';
      d.textContent='🛡'; d.onclick=()=>showSheet('<h2>Koruma gözlemi</h2>'+obsCard(o)+'<div class="warn">Gösterilen konum yaklaşıklaştırılmıştır; kültür varlığı hedef koordinatı değildir.</div><button class="b" onclick="closeSheet()">Kapat</button>');
      target.appendChild(d);
    }
  }
  if(typeof renderOverlay==='function'){
    const original=renderOverlay;
    renderOverlay=function(){ original(); renderProtection(); };
  }
  const oldLegend=document.getElementById('legend'); if(oldLegend) oldLegend.innerHTML += '<br>🛡 Yağma/bozulma gözlemi';
  btn();
  try{renderOverlay();}catch(e){}
})();