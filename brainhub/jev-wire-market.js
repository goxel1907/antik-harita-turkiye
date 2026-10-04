'use strict';

// Lossless, self-describing JSON rows. This is a wire representation, not a
// market summary: values, field names, order, nulls and timestamps round-trip.
const VERSION='R2544.34_LOSSLESS_ROWS';
const PREFIX='@r';
const bytes=v=>Buffer.byteLength(JSON.stringify(v),'utf8');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeKey=k=>!['__proto__','prototype','constructor'].includes(k);

function expandMarketPacket(packet){
  if(!packet?.wire)return packet;
  const wire=packet.wire;
  if(wire.version!==VERSION||!object(wire.fields))throw new Error('JEV_WIRE_SCHEMA_INVALID');
  for(const [tag,keys] of Object.entries(wire.fields)){
    if(!tag.startsWith(PREFIX)||!Array.isArray(keys)||keys.length<2||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||!safeKey(k)))throw new Error('JEV_WIRE_SCHEMA_INVALID');
  }
  const visit=v=>{
    if(Array.isArray(v)){
      const keys=typeof v[0]==='string'&&Object.hasOwn(wire.fields,v[0])?wire.fields[v[0]]:null;
      if(keys){
        if(v.length!==keys.length+1)throw new Error('JEV_WIRE_ROW_INVALID');
        return Object.fromEntries(keys.map((k,i)=>[k,visit(v[i+1])]));
      }
      if(typeof v[0]==='string'&&v[0].startsWith(PREFIX))throw new Error('JEV_WIRE_TAG_UNKNOWN');
      return v.map(visit);
    }
    if(object(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
    return v;
  };
  return Object.fromEntries(Object.entries(packet).filter(([k])=>k!=='wire').map(([k,v])=>[k,visit(v)]));
}

function encodeMarketPacket(packet){
  if(!object(packet)||packet.wire)return {packet,encoded:false};
  const layouts=new Map();let collision=false;
  const count=v=>{
    if(Array.isArray(v)){
      if(typeof v[0]==='string'&&v[0].startsWith(PREFIX))collision=true;
      for(const x of v)count(x);
    }else if(object(v)){
      const keys=Object.keys(v);if(keys.some(k=>!safeKey(k)))collision=true;
      const id=JSON.stringify(keys);const layout=layouts.get(id)||{keys,count:0};layout.count++;layouts.set(id,layout);
      for(const x of Object.values(v))count(x);
    }
  };
  // Keep top-level packet fields readable. Only repeated nested record shapes
  // with a positive total byte saving get a dictionary entry.
  for(const v of Object.values(packet))count(v);
  if(collision)return {packet,encoded:false,reason:'RESERVED_TAG_OR_FIELD'};
  const tags=new Map(),fields={};let i=0;
  for(const [id,l] of layouts){
    const tag=PREFIX+(++i);
    if(l.keys.length>1&&l.count*(bytes(l.keys)-bytes(tag)-3)>bytes(l.keys)+tag.length+8){tags.set(id,tag);fields[tag]=l.keys;}
  }
  const visit=v=>{
    if(Array.isArray(v))return v.map(visit);
    if(!object(v))return v;
    const keys=Object.keys(v),tag=tags.get(JSON.stringify(keys));
    return tag?[tag,...keys.map(k=>visit(v[k]))]:Object.fromEntries(keys.map(k=>[k,visit(v[k])]));
  };
  const result={...Object.fromEntries(Object.entries(packet).map(([k,v])=>[k,visit(v)])),wire:{version:VERSION,
    interpretation:'Decode every array starting with @r using wire.fields[tag]: values after the tag correspond to those field names in order. Decode nested rows recursively. These are exact records, not candles or numeric vectors. No market fact is omitted; null, false, zero, prices and timestamps retain their original meaning.',fields}};
  const beforeBytes=bytes(packet),afterBytes=bytes(result);
  if(afterBytes>=beforeBytes)return {packet,encoded:false};
  if(JSON.stringify(expandMarketPacket(result))!==JSON.stringify(packet))throw new Error('JEV_WIRE_ROUND_TRIP_FAILED');
  return {packet:result,encoded:true,beforeBytes,afterBytes,schemaCount:Object.keys(fields).length};
}

module.exports={VERSION,encodeMarketPacket,expandMarketPacket};
