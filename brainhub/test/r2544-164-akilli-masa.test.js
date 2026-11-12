'use strict';
// R2544.164 AKILLI MASA: the models (quota) are asked when something changed; Goxel watches for free
const test = require('node:test'), assert = require('node:assert');
const DESK = require('../position-desk');
const M = 60000, T = 1794400000000, cfg = { firstAfterMin:2, cadenceMin:10 };
const due = (o) => DESK.smartDue({ openedAt:T, cfg, ...o });

test('R2544.164 first look 2 min after the entry; events at once (>= 2 min apart)', () => {
  assert.strictEqual(due({ now:T + M, markR:0 }).why, 'WAIT_FIRST');
  assert.deepStrictEqual(due({ now:T + 2 * M, markR:0 }), { due:true, why:'FIRST_LOOK', event:true });
  const desk = { lastAt:T + 2 * M, lastR:0.2, lastGx:{ against:1, big:0 } };
  assert.strictEqual(due({ now:T + 3 * M, markR:0.2, desk, gx:{ against:1, big:1, need:3, needBig:1 } }).due, false, 'a minute after the last look: wait');
  assert.strictEqual(due({ now:T + 4 * M, markR:0.2, desk, gx:{ against:1, big:1, need:3, needBig:1 } }).why, 'GOXEL_BIG_SCREEN');
  assert.strictEqual(due({ now:T + 4 * M, markR:0.2, desk, gx:{ against:3, big:0, need:3, needBig:1 } }).why, 'GOXEL_TWO_MORE_AGAINST');
  assert.strictEqual(due({ now:T + 4 * M, markR:0.2, desk:{ ...desk, lastGx:{ against:1, big:1 } }, gx:{ against:2, big:1, need:3, needBig:1 } }).why, 'GOXEL_NEAR_EXIT');
  assert.strictEqual(due({ now:T + 4 * M, markR:0.55, desk, gx:{ against:1, big:0 } }).why, 'R_STEP_UP');
  assert.strictEqual(due({ now:T + 4 * M, markR:-0.1, desk, gx:{ against:1, big:0 } }).why, 'R_STEP_DOWN');
});

test('R2544.164 no event: calm 30 min, moving 10 min; nothing changed = no look; the budget stretches routine looks only', () => {
  const desk = { lastAt:T, lastR:0.2, lastGx:{ against:0, big:0 } };
  assert.strictEqual(due({ now:T + 12 * M, markR:0.25, desk, gx:{ against:0, big:0 } }).why, 'CALM');
  assert.strictEqual(due({ now:T + 31 * M, markR:0.25, desk, gx:{ against:0, big:0 } }).why, 'NOTHING_CHANGED', 'same picture: the models are not asked');
  assert.strictEqual(due({ now:T + 31 * M, markR:0.25, desk, gx:{ against:1, big:0 } }).why, 'ROUTINE_CALM');
  const d1 = { lastAt:T, lastR:0.2, lastGx:{ against:1, big:0 } };
  assert.strictEqual(due({ now:T + 11 * M, markR:0.25, desk:d1, gx:{ against:2, big:0 } }).why, 'ROUTINE_ACTIVE');
  assert.strictEqual(due({ now:T + 11 * M, markR:0.25, desk:d1, gx:{ against:2, big:0 }, looksToday:45 }).why, 'ACTIVE', 'past half the budget: 20 min');
  assert.strictEqual(due({ now:T + 21 * M, markR:0.25, desk:d1, gx:{ against:2, big:0 }, looksToday:45 }).why, 'ROUTINE_ACTIVE');
  assert.strictEqual(due({ now:T + 4 * M, markR:0.55, desk, gx:{ against:0, big:0 }, looksToday:70 }).why, 'R_STEP_UP', 'an event passes a tight budget');
  assert.strictEqual(due({ now:T + 4 * M, markR:0.55, desk, gx:null, looksToday:160 }).why, 'BUDGET_HARD_STOP');
});
