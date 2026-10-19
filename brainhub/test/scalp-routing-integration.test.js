'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function freePort() {
  const s = http.createServer();
  const port = await listen(s);
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function waitFor(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      lastError = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastError = e;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('server did not become ready');
}

function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill('SIGTERM'); } catch { resolve(); }
  });
}

test('SCALP /committee stays on fast free OpenCode route and avoids Kiro judge on consensus', { timeout: 20000 }, async () => {
  const requestedModels = [];
  const fakeRouter = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type':'application/json' });
      return res.end(JSON.stringify({ error:'not found' }));
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requestedModels.push(String(body.model || ''));
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ choices:[{ message:{ content:'NO_TRADE' } }] }));
  });

  const routerPort = await listen(fakeRouter);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainhub-scalp-route-'));
  const brainPort = await freePort();
  const configDir = path.join(root, 'config');
  fs.mkdirSync(configDir, { recursive:true });

  const opencode = [
    'oc/muse-spark-1.2-contributor-free',
    'oc/muse-spark-1.3-contributor-free',
    'oc/big-pickle',
    'oc/mimo-v2.5-free',
    'oc/ling-3.0-flash-fin-free',
    'oc/nemotron-3-ultra-free',
    'oc/nemotron-3.5-lightning-free'
  ];
  const judges = ['kr/claude-sonnet-4.5'];
  fs.writeFileSync(path.join(configDir, 'models.json'), JSON.stringify({
    baseUrl:`http://127.0.0.1:${routerPort}/v1`,
    opencode,
    kiro:judges,
    healthCacheSeconds:1
  }), 'utf8');
  fs.writeFileSync(path.join(configDir, 'committee.json'), JSON.stringify({
    analysts:opencode.slice(0, 3),
    backupAnalysts:opencode.slice(3),
    judges,
    minAnalystReplies:2,
    parallelAnalysts:3,
    judgeOnlyOnDisagreement:true
  }), 'utf8');

  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd:root,
    env:{
      ...process.env,
      BRAINHUB_ROOT:root,
      BRAINHUB_ROUTER_KEY:'integration-test-router-key-123456',
      BRAINHUB_HOST:'127.0.0.1',
      BRAINHUB_PORT:String(brainPort),
      BRAINHUB_CLIENT_TOKEN:''
    },
    stdio:['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });

  try {
    await waitFor(`http://127.0.0.1:${brainPort}/health`);

    const routesRes = await fetch(`http://127.0.0.1:${brainPort}/models/routes`);
    assert.equal(routesRes.status, 200);
    const routes = await routesRes.json();
    assert.deepEqual(routes.roles.SCALP, routes.roles.FAST);
    assert.equal(routes.kiroJudgeOnly, true);

    const committeeRes = await fetch(`http://127.0.0.1:${brainPort}/committee`, {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({
        role:'SCALP',
        system:'Routing regression only. Do not analyze markets.',
        prompt:'Return exactly one token: NO_TRADE'
      })
    });
    const committee = await committeeRes.json();
    assert.equal(committeeRes.status, 200, JSON.stringify(committee));
    assert.equal(committee.ok, true);
    assert.equal(committee.role, 'SCALP');
    assert.equal(committee.verdictConsensus, 'NO_TRADE');
    assert.equal(committee.judge?.used, false);
    assert.ok(Array.isArray(committee.analysts) && committee.analysts.length >= 2);
    assert.ok(committee.analysts.every(x => String(x.model).startsWith('oc/')));

    assert.ok(requestedModels.length >= 3);
    assert.ok(requestedModels.every(model => model.startsWith('oc/')), requestedModels.join(','));
    const firstWave = new Set(requestedModels.slice(0, 3));
    assert.ok([...firstWave].some(x => x.includes('lightning')));
    assert.ok([...firstWave].some(x => x.includes('flash')));
    assert.ok([...firstWave].some(x => x.includes('mimo')));
    assert.equal(requestedModels.some(model => model.startsWith('kr/')), false);
  } finally {
    await stopChild(child);
    await new Promise(resolve => fakeRouter.close(resolve));
    fs.rmSync(root, { recursive:true, force:true });
  }

  assert.equal(stderr.includes('BRAINHUB_ROUTER_KEY missing'), false, stderr);
});
