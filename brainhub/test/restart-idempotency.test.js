'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStore } = require('../store');

test('execution claims stay idempotent across store restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainhub-restart-idempotency-'));
  const owner = 'brainhub-owner';
  const resource = 'EXECUTION:BINANCE';
  const token = 'restart-token-1234567890';
  const eventId = 'event-restart-0001';
  const lineageId = 'lineage-restart-0001';

  let first;
  let second;
  try {
    first = openStore(root);
    const lease = first.lease('acquire', resource, owner, token, 60000);
    assert.equal(lease.acquired, true);

    const initial = first.claim(eventId, owner, resource, token, lineageId);
    assert.equal(initial.claimed, true);
    assert.equal(initial.lineageId, lineageId);
    first.db.close();
    first = null;

    second = openStore(root);

    const duplicateEvent = second.claim(eventId, owner, resource, token, lineageId);
    assert.equal(duplicateEvent.claimed, false);
    assert.equal(duplicateEvent.reason, 'DUPLICATE');

    const duplicateLineage = second.claim('event-restart-0002', owner, resource, token, lineageId);
    assert.equal(duplicateLineage.claimed, false);
    assert.equal(duplicateLineage.reason, 'DUPLICATE_LINEAGE');
    assert.equal(duplicateLineage.original.event_id, eventId);

    const fresh = second.claim('event-restart-0003', owner, resource, token, 'lineage-restart-0003');
    assert.equal(fresh.claimed, true);
    assert.equal(fresh.lineageId, 'lineage-restart-0003');
  } finally {
    try { first?.db.close(); } catch {}
    try { second?.db.close(); } catch {}
    fs.rmSync(root, { recursive:true, force:true });
  }
});
