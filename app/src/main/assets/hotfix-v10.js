(function(){
  if(typeof buildQuery!=='function') return;
  buildQuery=function(){
    const r=radius(),q=[];
    const wants=x=>selCategory==='Tümü'||selCategory===x||selCategory==='Potansiyel';
    if(wants('Yerleşim')) q.push(qA('[historic~"^(archaeological_site|ruins)$"]',r),qA('[archaeological_site]',r),qA('[tourism=archaeological_site]',r));
    if(wants('Yol')) q.push(qA('[historic~"^(road|route|milestone)$"]',r),qA('[route:historic=yes]',r));
    if(wants('Konaklama')) q.push(qA('[historic~"^(caravanserai|inn)$"]',r),qA('[tourism=caravanserai]',r));
    if(wants('Savunma')) q.push(qA('[historic~"^(castle|fort|fortification|city_gate|citywalls|tower)$"]',r));
    if(wants('Geçiş')) q.push(qA('[historic=bridge]',r),qA('[ford=yes]',r),qA('[mountain_pass=yes]',r));
    if(selCategory==='Su'||selCategory==='Potansiyel') q.push(qA('[historic=aqueduct]',r),qA('[natural=spring]',Math.min(r,1800)),qA('[man_made=water_well]',Math.min(r,1200)));
    if(selCategory==='Mağara'||selCategory==='Potansiyel') q.push(qA('[natural=cave_entrance]',r));
    if(selCategory==='Yapı') q.push(qA('[historic~"^(monastery|manor|palace|church|mosque|temple|wayside_shrine|wayside_cross)$"]',r),qA('[heritage]',Math.min(r,1400)));
    return `[out:json][timeout:12];(${q.join('')});${zoom>=14?'out body geom qt;':'out body center qt;'}`;
  };
})();
