'use strict';

function normalizeWaitText(v){
  return String(v??'')
    .normalize('NFKC')
    .replace(/\s+/g,' ')
    .trim()
    .toLocaleUpperCase('tr-TR');
}

function isNonConcreteWait(v){
  const z=normalizeWaitText(v);
  if(!z)return true;
  if(/^(?:NONE|YOK|N\/A|-|—)(?:\b|\s|[—\-–(:;,.]|$)/u.test(z))return true;
  return /SOMUT BEKLEME KOŞULU ÜRETMEDİ|SONRAKİ TAZE VERİDE YENİDEN DEĞERLENDİR|YENİDEN İNCELEME GEREKLİ/u.test(z);
}

module.exports={normalizeWaitText,isNonConcreteWait};
