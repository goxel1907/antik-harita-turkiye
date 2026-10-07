'use strict';
// R2544.55 JEV EDGE (user 07.10.2026: "the question sent to JEV must be genius; guide JEV correctly and let it decide").
// Evidence (Claud-Work raporlar 2026-10-07-*): 232 own closes lost 186.50 USDT, 41% of it fees; JEV early exits saved
// money, wider stops and deeper limit entries did not help -> the loss is trade SELECTION (TP1 ~1R, need >~55% hits
// after fees, actual 44.5%). TypeSafe's own guidance for Jev (System One): narrow typed questions, calibrated
// probabilities, confidence gates kept in code. BrainHub discarded every probability and confidence until now.
//
// This module only (1) asks one narrow Noul per executable plan: "+1R before the stop within 4 h?", (2) keeps the
// probabilities and confidence Jev already returns, and (3) turns them into an expected-value gate in code:
//   EV(R) = p*1 - (1-p)*1 - feeR,  feeR = roundTripFee * entry / |entry - stop|
// The gate can only REMOVE an entry; it never creates, sizes or redirects one. A missing edge answer never blocks
// (fail-open + journaled), so a provider hiccup cannot freeze trading the way R45's unexecutable rule did.
const fs = require('fs');
const path = require('path');

const EDGE_VERSION = 'R2544.55_JEV_EDGE';
const EDGE_HORIZON_MIN = 240;
const MAX_EDGE_QUESTIONS = 6;
const DEFAULT_CONFIG = Object.freeze({ enabled:true, mode:'ENFORCE', evMinR:0.05, confidenceMin:0.35, feeRoundTripPct:0.10, missingPolicy:'ALLOW' });

// Shared context for every edge question (one copy in state; questions stay short). Facts are BrainHub's own
// measurements; the rest is soft guidance. Jev still decides the probability.
const EDGE_CONTEXT = Object.freeze({
  task:'For each plan give the probability that price touches +1R before the stop within 4 h (stop first = NO). Code turns it into expected value after fees; honest low numbers are wanted, fewer better trades are the goal.',
  ourRecord:'232 own trades: 44.5% reached +1R before the stop; fees were 41% of the loss; wider stops and deeper entries did not help: selection is the edge. Break-even about 55% (more when the stop is tight).',
  losers:'stop in front of the nearest liquidity (swept first); entry after an extended leg into opposing liquidity or a higher-TF level with <1.5R room; stop inside owner-TF ATR noise; absorbed flow (delta with no progress, depth refilling against); late or crowded entry.',
  winners:'fresh structural level with the stop behind real liquidity; higher-TF aligned; >=1.5R room to the next opposing level; flow and depth supporting the side now.'
});

const finite = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 6) => v === null ? null : Number(v.toFixed(d));

function edgeQuestionId(planId) { return 'p1r_' + String(planId || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48); }

function planGeometry(p) {
  const entry = finite(p?.entryPrice), stop = finite(p?.stopPrice), side = String(p?.side || '').toUpperCase();
  const sign = side === 'LONG' ? 1 : side === 'SHORT' ? -1 : 0;
  if (entry === null || stop === null || !sign) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || (entry - stop) * sign <= 0) return null;
  return { side, sign, entry, stop, risk, target1R: entry + sign * risk };
}

// One Noul per plan (at most MAX_EDGE_QUESTIONS). Returns the questions to merge into the PASS-2 request.
function buildEdgeQuestions(plans) {
  const questions = {}, map = {};
  for (const p of (Array.isArray(plans) ? plans : []).slice(0, MAX_EDGE_QUESTIONS)) {
    const g = planGeometry(p); if (!g || !p.id) continue;
    const id = edgeQuestionId(p.id);
    map[p.id] = id;
    questions[id] = {
      type:'noul',
      instructions:`${p.id}: from entry ${round(g.entry, 10)}, will price touch +1R at ${round(g.target1R, 10)} before the stop ${round(g.stop, 10)} within 4 hours? Use state.edgeContext.`
    };
  }
  return { questions, map };
}

function choiceDetail(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const probabilities = answer.probabilities && typeof answer.probabilities === 'object' && !Array.isArray(answer.probabilities)
    ? Object.fromEntries(Object.entries(answer.probabilities).map(([k, v]) => [k, finite(v)]).filter(([, v]) => v !== null)) : null;
  return { choice:typeof answer.choice === 'string' ? answer.choice : null, confidence:finite(answer.confidence), probabilities };
}
function noulValue(answer) {
  const direct = finite(answer); if (direct !== null && direct >= 0 && direct <= 1) return direct;
  if (!answer || typeof answer !== 'object') return null;
  for (const k of ['noul', 'probability', 'yes', 'true', 'value']) { const n = finite(answer[k]); if (n !== null && n >= 0 && n <= 1) return n; }
  return null;
}

// Keeps what Jev returned (probabilities + confidence for the choices, p(+1R first) per plan).
function parseEdge(answers, plans, selectedId, map) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const planEdges = {};
  for (const p of (Array.isArray(plans) ? plans : [])) {
    const qid = map?.[p.id]; if (!qid) continue;
    const g = planGeometry(p);
    planEdges[p.id] = { p1R:noulValue(a[qid]), side:g?.side || null, entry:g?.entry ?? null, stop:g?.stop ?? null, target1R:g ? round(g.target1R, 10) : null };
  }
  const selected = selectedId && planEdges[selectedId] ? { planId:selectedId, ...planEdges[selectedId] } : null;
  return {
    version:EDGE_VERSION, horizonMin:EDGE_HORIZON_MIN,
    tradePlan:choiceDetail(a.trade_plan), entryTiming:choiceDetail(a.entry_timing), setupFamily:choiceDetail(a.setup_family), edgeBasis:choiceDetail(a.edge_basis),
    planEdges, selected, asked:Object.keys(map || {}).length
  };
}

function readEdgeConfig(root) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(path.join(String(root || '.'), 'config', 'jev-edge.json'), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  const c = { ...DEFAULT_CONFIG };
  if (typeof raw.enabled === 'boolean') c.enabled = raw.enabled;
  if (['ENFORCE', 'SHADOW'].includes(String(raw.mode || '').toUpperCase())) c.mode = String(raw.mode).toUpperCase();
  for (const k of ['evMinR', 'confidenceMin', 'feeRoundTripPct']) { const n = finite(raw[k]); if (n !== null && n >= 0 && n <= (k === 'feeRoundTripPct' ? 1 : 1)) c[k] = n; }
  if (['ALLOW', 'BLOCK'].includes(String(raw.missingPolicy || '').toUpperCase())) c.missingPolicy = String(raw.missingPolicy).toUpperCase();
  return c;
}

// Code-side expected-value gate at execution time (fresh entry price, plan stop).
function edgeGate({ edge, side, entryPrice, stopPrice, config = DEFAULT_CONFIG } = {}) {
  const c = { ...DEFAULT_CONFIG, ...(config || {}) };
  const base = { version:EDGE_VERSION, mode:c.mode, thresholds:{ evMinR:c.evMinR, confidenceMin:c.confidenceMin, feeRoundTripPct:c.feeRoundTripPct } };
  if (!c.enabled) return { ok:true, ...base, decision:'DISABLED' };
  const entry = finite(entryPrice), stop = finite(stopPrice), s = String(side || '').toUpperCase();
  const p = finite(edge?.selected?.p1R), conf = finite(edge?.tradePlan?.confidence);
  if (p === null || entry === null || stop === null || !['LONG', 'SHORT'].includes(s) || !(Math.abs(entry - stop) > 0)) {
    const missing = { ...base, decision:'MISSING', reason:'JEV_EDGE_MISSING', p1R:p, confidence:conf };
    return c.missingPolicy === 'BLOCK' && c.mode === 'ENFORCE' ? { ok:false, ...missing } : { ok:true, ...missing };
  }
  const risk = Math.abs(entry - stop), feeR = (c.feeRoundTripPct / 100) * entry / risk;
  const evR = p - (1 - p) - feeR, breakEvenP = (1 + feeR) / 2;
  const reasons = [];
  if (evR < c.evMinR) reasons.push('JEV_EDGE_BELOW_BREAKEVEN');
  if (conf !== null && conf < c.confidenceMin) reasons.push('JEV_LOW_CONFIDENCE');
  const out = { ...base, p1R:round(p, 4), confidence:conf === null ? null : round(conf, 4), feeR:round(feeR, 4), evR:round(evR, 4), breakEvenP:round(breakEvenP, 4), stopPct:round(risk / entry * 100, 4) };
  if (!reasons.length) return { ok:true, ...out, decision:'PASS' };
  return c.mode === 'SHADOW' ? { ok:true, ...out, decision:'SHADOW_WOULD_BLOCK', reasons } : { ok:false, ...out, decision:'BLOCK', reason:reasons[0], reasons };
}

// Called by the request fitter as the very last step before a size block: the edge questions and context are
// dropped (the decision still happens; the gate then sees a missing edge and passes). R55 never causes a block.
function dropEdgeQuestions(body) {
  const q = body?.questions; let n = 0;
  if (q && typeof q === 'object') for (const k of Object.keys(q)) if (k.startsWith('p1r_')) { delete q[k]; n++; }
  if (body?.state && body.state.edgeContext) { delete body.state.edgeContext; n++; }
  return n;
}

module.exports = { EDGE_VERSION, dropEdgeQuestions, EDGE_HORIZON_MIN, EDGE_CONTEXT, DEFAULT_CONFIG, MAX_EDGE_QUESTIONS, edgeQuestionId, planGeometry, buildEdgeQuestions, parseEdge, readEdgeConfig, edgeGate, noulValue, choiceDetail };
