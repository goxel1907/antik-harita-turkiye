'use strict';
// Test preload: allow local fixture servers, deny outbound sockets and DNS.
const net=require('node:net'),dns=require('node:dns');
const local=h=>!h||['localhost','127.0.0.1','::1','[::1]'].includes(String(h));
const productionPort=p=>process.env.JEV_TEST_PROTECT_INSTALLED==='1'&&[8787,8788,8790].includes(Number(p));
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const a=Array.isArray(args[0])?args[0]:args;
  const opts=a[0]&&typeof a[0]==='object'?a[0]:null;
  const host=opts?.host||opts?.hostname||(typeof a[1]==='string'?a[1]:null);
  if(!local(host))throw new Error('TEST_EXTERNAL_NETWORK_DENIED');
  if(productionPort(opts?.port||a[0]))throw new Error('TEST_INSTALLED_BOT_PORT_DENIED');
  return connect.apply(this,args);
};
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!local(host))throw new Error('TEST_EXTERNAL_DNS_DENIED');return lookup.call(this,host,...args);};
const fetch=globalThis.fetch;
globalThis.fetch=function(url,...args){const u=new URL(typeof url==='string'?url:url.url||String(url));if(!local(u.hostname))return Promise.reject(new Error('TEST_EXTERNAL_NETWORK_DENIED'));if(productionPort(u.port))return Promise.reject(new Error('TEST_INSTALLED_BOT_PORT_DENIED'));return fetch.call(this,url,...args);};
