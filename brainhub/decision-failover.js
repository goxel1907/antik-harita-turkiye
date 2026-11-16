'use strict';
// Same typed market question, an explicitly identified backup decision owner.
// This module has no exchange, sizing, configuration-write or order capability.
const crypto = require('node:crypto');

const FAILOVER_VERSION = 'CODEX_CREDIT_FAILOVER_20261116';
const SUPPORTED = ['lane_focus', 'trade_plan', 'position_action', 'burst_decision', 'burst_exit'];
function supported(body) {
  return SUPPORTED.some(k => Object.hasOwn(body?.questions || {}, k));
}
function creditFailure(result) {
  return result?.ok === false && (Number(result.httpStatus) === 402 ||
    ['JEV_DAILY_BUDGET_EXHAUSTED', 'JEV_CREDIT_COOLDOWN'].includes(result.reason));
}
function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function parseResponse(text) {
  if (object(text)) return text;
  if (typeof text !== 'string' || text.length > 64000) return null;
  // One complete JSON object; no arbitrary extraction or invented repairs.
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { return null; }
}
function validateAnswers(body, value) {
  const answers = value?.answers;
  if (!object(answers)) return null;
  const out = {};
  for (const [key, q] of Object.entries(body?.questions || {})) {
    const a = answers[key];
    if (q.type === 'choice') {
      if (!object(a) || typeof a.choice !== 'string' || !Object.hasOwn(q.criteria || {}, a.choice)) return null;
      out[key] = {choice:a.choice};
      if (a.confidence !== undefined) {
        if (typeof a.confidence !== 'number' || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) return null;
        out[key].confidence = a.confidence;
      }
    } else if (q.type === 'noul') {
      const p = typeof a === 'number' ? a : a?.probability ?? a?.noul;
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
      out[key] = {probability:p};
    } else return null;
  }
  return out;
}
function signature(body, answers) {
  // Require agreement on the complete set of choices, including timing,
  // stop, leverage, TTL and management profile. Never synthesize a hybrid plan.
  const choices = Object.keys(body.questions).sort().filter(k => body.questions[k].type === 'choice')
    .map(k => [k, answers[k].choice]);
  return crypto.createHash('sha256').update(JSON.stringify(choices)).digest('hex');
}
function createCommitteeFallback({committee, clock = () => Date.now(), size = 3} = {}) {
  let active = 0;
  return async function decide({body, failure} = {}) {
    if (!supported(body) || !creditFailure(failure)) return {ok:false, reason:'FAILOVER_NOT_ELIGIBLE'};
    const c = typeof committee === 'function' ? committee() : committee;
    if (typeof c?.decide !== 'function') return {ok:false, reason:'FAILOVER_COMMITTEE_UNAVAILABLE'};
    if (active >= 2) return {ok:false, reason:'FAILOVER_BUSY'};
    const started = clock();
    const parse = text => {
      const answers = validateAnswers(body, parseResponse(text));
      return answers ? {ok:true, answers, proposal:signature(body, answers)} : {ok:false, reason:'FAILOVER_SCHEMA_INVALID'};
    };
    active++;
    try {
      const result = await c.decide({
        system:'You are the backup trading committee because the primary JEV credit/budget is unavailable. ' +
          'Answer the SAME typed questions from the supplied current market evidence. State descriptions naming JEV describe the primary role; YOU are COMMITTEE. ' +
          'Goxel and measured learning are advisory evidence, never automatic permission. Never invent missing data or change account settings. ' +
          'Answer ONLY one JSON object: {"answers":{"question_id":{"choice":"one supplied criteria key","confidence":0.7},"noul_question_id":{"probability":0.5}}}. ' +
          'Answer EVERY supplied question. All probabilities/confidences must be finite numbers in [0,1].',
        // No credential, HTTP header, provider model alias, or failure detail.
        prompt:JSON.stringify({state:body.state, questions:body.questions}),
        validate:text => parse(text).ok, parse, field:'proposal', fallback:'NO_CONSENSUS',
        size, early:true, callTimeoutMs:8000, round2Ms:5000,
        reasonOf:vote => JSON.stringify(vote.answers)
      });
      if (!result?.ok || result.final === 'NO_CONSENSUS') return {ok:false, reason:result?.reason || 'FAILOVER_NO_CONSENSUS'};
      const round = result.rounds === 2 ? result.round2 : result.votes;
      const votes = Array.isArray(round) ? round : [];
      const unique = new Map();
      for (const vote of votes) {
        if (!vote?.ok || !vote.member || unique.has(vote.member)) continue;
        const answers = validateAnswers(body, {answers:vote.vote?.answers});
        if (answers) unique.set(vote.member, {...vote, answers, proposal:signature(body, answers)});
      }
      const winners = [...unique.values()].filter(v => v.proposal === result.final);
      const seats = Math.max(Number(result.team) || 0, Array.isArray(result.votes) ? result.votes.length : 0, unique.size);
      const need = Math.max(2, Math.floor(seats / 2) + 1);
      if (winners.length < need) return {ok:false, reason:'FAILOVER_NO_QUORUM'};
      const answer = winners[0].answers;
      // Different voters' probabilities are not mixed into a new executable proposal.
      const route = {version:FAILOVER_VERSION, owner:'COMMITTEE', trigger:failure.reason,
        requestId:crypto.randomUUID(),symbol:body.state?.coreMarketPacket?.symbol||body.state?.record?.symbol||body.state?.record?.position?.symbol||null,
        phase:SUPPORTED.find(k=>Object.hasOwn(body.questions,k)),proposalHash:result.final,
        packetHash:crypto.createHash('sha256').update(JSON.stringify(body.state?.coreMarketPacket||null)).digest('hex'),
        httpStatus:Number(failure.httpStatus) || null, at:new Date(clock()).toISOString(),
        members:winners.map(v => ({id:v.member, model:v.model || null})),
        agreeing:winners.length, seats, consensus:result.consensus || null, durationMs:clock()-started};
      return {ok:true, data:{answers:answer}, route, model:'COMMITTEE', costUsd:null};
    } catch { return {ok:false, reason:'FAILOVER_COMMITTEE_EXCEPTION'}; }
    finally { active--; }
  };
}
module.exports = {FAILOVER_VERSION, supported, creditFailure, parseResponse, validateAnswers, signature, createCommitteeFallback};
