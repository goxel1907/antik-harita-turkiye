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

async function postJson(url, body) {
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify(body)
  });
  return { status:r.status, body:await r.json() };
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

test('/execution/claim rejects a second event from the same lineage', { timeout:20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainhub-claim-http-'));
  const configDir = path.join(root, 'config');
  fs.mkdirSync(configDir, { recursive:true });
  fs.writeFileSync(path.join(configDir, 'models.json'), JSON.stringify({
    baseUrl:'http://127.0.0.1:9/v1',
    opencode:['oc/integration-free'],
    kiro:[],
    healthCacheSeconds:1
  }), 'utf8');
  fs.writeFileSync(path.join(configDir, 'committee.json'), JSON.stringify({
    analysts:['oc/integration-free'],
    backupAnalysts:[],
    judges:[],
    minAnalystReplies:1,
    parallelAnalysts:1,
    judgeOnlyOnDisagreement:true
  }), 'utf8');

  const brainPort = await freePort();
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

  const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const base = `http://127.0.0.1:${brainPort}`;
  try {
    await waitFor(`${base}/health`);

    const lease = await postJson(`${base}/lease`, {
      action:'acquire', resource:'EXECUTOR', owner:'PHONE', token, ttlMs:30000
    });
    assert.equal(lease.status, 200, JSON.stringify(lease.body));
    assert.equal(lease.body.acquired, true);

    const first = await postJson(`${base}/execution/claim`, {
      eventId:'signal-http-0001',
      lineageId:'lineage-btc-long-0001',
      owner:'PHONE', resource:'EXECUTOR', token
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.claimed, true);
    assert.equal(first.body.lineageId, 'lineage-btc-long-0001');

    const handoffDuplicate = await postJson(`${base}/execution/claim`, {
      eventId:'signal-http-0002',
      lineageId:'lineage-btc-long-0001',
      owner:'PHONE', resource:'EXECUTOR', token
    });
    assert.equal(handoffDuplicate.status, 200, JSON.stringify(handoffDuplicate.body));
    assert.equal(handoffDuplicate.body.claimed, false);
    assert.equal(handoffDuplicate.body.reason, 'DUPLICATE_LINEAGE');
    assert.equal(handoffDuplicate.body.original?.event_id, 'signal-http-0001');

    const eventDuplicate = await postJson(`${base}/execution/claim`, {
      eventId:'signal-http-0001',
      lineageId:'lineage-btc-long-0002',
      owner:'PHONE', resource:'EXECUTOR', token
    });
    assert.equal(eventDuplicate.status, 200, JSON.stringify(eventDuplicate.body));
    assert.equal(eventDuplicate.body.claimed, false);
    assert.equal(eventDuplicate.body.reason, 'DUPLICATE');
  } finally {
    await stopChild(child);
    fs.rmSync(root, { recursive:true, force:true });
  }

  assert.equal(stderr.includes('BRAINHUB_ROUTER_KEY missing'), false, stderr);
});
