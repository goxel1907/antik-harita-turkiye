'use strict';
// Same typed market question, an explicitly identified backup decision owner.
// This module has no exchange, sizing, configuration-write or order capability.
const crypto = require('node:crypto');

const FAILOVER_VERSION = 'CODEX_CREDIT_FAILOVER_20261116';
const SUPPORTED = ['lane_focus', 'trade_plan', 'position_action', 'burst_decision', 'burst_exit'];
// R2544.185 (Claude incelemesi, PR #5): Codex sürümü 3 koltuktan en az 2'sinin BÜTÜN seçimlerde (PASS-2'de 11 alan) birebir aynı
// cevabı vermesini istiyordu; ücretsiz modellerde bu pratikte hiç olmaz -> yedek her seferinde NO_QUORUM (yeni tıkanma). Mutabakat artık
// yalnız KARARI belirleyen alanlarda aranır; yürütülen cevap ise mutabık üyelerden TEK birinin eksiksiz cevabıdır (karma plan yine YOK).
const CRITICAL = { trade_plan:['trade_plan', 'entry_timing'], lane_focus:['lane_focus', 'direction_focus'], position_action:['position_action'],
  // vur-kaç: TTL, kaldıraç modu ve tetik sıkılığı riski doğrudan belirler -> Codex'in tam-mutabakat şartı burada korunur
  burst_decision:['burst_decision', 'ttl', 'leverage_mode', 'trigger_strictness'], burst_exit:['burst_exit'] };
// Ölçülen koltuk süreleri (Office model karnesi 16.11: ort 10-64 sn/çağrı). 8 sn sınırında koltukların neredeyse tamamı düşüyordu.
// Vur-kaç saniyelerle yaşar: orada kısa süre kalır (kurul yetişemezse fail-closed = işlem yok, doğru davranış).
const TIMING = { burst_decision:{ call:8000, round2:5000 }, burst_exit:{ call:8000, round2:5000 }, default:{ call:45000, round2:20000 } };
// R2544.186 (kullanıcı 17.11: "botun verileri, Goxel vs hepsi JEV'e her coin için ulaştığına emin ol"): İlk 3 / ZİRVE-5 GİRİŞ kapısına da
// Goxel'in kısa bakışı (yalnız danışman; bu kapılar için kurul YEDEĞİ açılmaz, Codex kapsamı değişmez).
const ADVISOR_ONLY = ['top3_decision', 'zirve5_decision'];
function advisorOnly(body) { return ADVISOR_ONLY.some(k => Object.hasOwn(body?.questions || {}, k)); }
function advisorEligible(body) { return supported(body) || advisorOnly(body); }
// giriş kapısı için kısa biçim (~0,5 kB): yön başına aleyhte/büyük ekran sayısı + gerekçe; ekran metinleri yok
function compactAdvisor(a) {
  if (!a || a.available !== true || a.kind !== 'ENTRY_CONTEXT') return a;
  const side = x => x ? { goxelWouldEnter:x.ok === true, checked:x.checked === true, against:x.against ?? null, big:x.big ?? null, needBig:x.needBig ?? null,
    trendSupports:x.support ?? null, atLevel:x.atLevel ?? null, why:x.why ? String(x.why).slice(0, 160) : null } : null;
  return { authority:a.authority, source:a.source, symbol:a.symbol, at:a.at, kind:'ENTRY_CONTEXT_COMPACT', instruction:a.instruction, long:side(a.long), short:side(a.short) };
}
// danışman notu JEV çağrısını ASLA engelleyemez: not eklenince istek sınırı aşıyorsa not düşürülür, çağrı aynen yapılır
function withAdvisors(body, advisors, prepare) {
  const next = { ...body, state:{ ...body.state, advisors } };
  let ok = false; try { ok = prepare(next)?.ok === true; } catch { ok = false; }
  if (ok) return next;
  return { ...body, state:{ ...body.state, advisors:{ authority:'EVIDENCE_ONLY', available:false, reason:'GOXEL_ADVISOR_DROPPED_SIZE' } } };
}
function phaseOf(body) { return SUPPORTED.find(k => Object.hasOwn(body?.questions || {}, k)) || null; }
// Aynı temel model farklı sağlayıcılardan (nvidia / openrouter / KILO) gelebiliyor: bağımsız oy sayılmaz.
function familyOf(id) {
  let x = String(id || '').toLowerCase().replace(/^(router|free|or|ovh|kilo|cf|nvidia)\s*:/, '');
  x = x.split('/').pop().replace(/:free$/, '').replace(/-(preview|instruct|it|chat)$/, '').replace(/-\d{3,}[a-z0-9-]*$/, '');
  return x || String(id || '');
}
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
function fullSignature(body, answers) {
  const choices = Object.keys(body.questions).sort().filter(k => body.questions[k].type === 'choice').map(k => [k, answers[k].choice]);
  return crypto.createHash('sha256').update(JSON.stringify(choices)).digest('hex');
}
function signature(body, answers) {
  // R2544.185: agreement on the DECISION fields only (which plan / which action). The executed answer is one member's complete answer.
  const keys = (CRITICAL[phaseOf(body)] || []).filter(k => body.questions?.[k]?.type === 'choice' && answers?.[k]);
  if (!keys.length) return fullSignature(body, answers);
  return crypto.createHash('sha256').update(JSON.stringify(keys.map(k => [k, answers[k].choice]))).digest('hex');
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
        size, early:true, callTimeoutMs:(TIMING[phaseOf(body)] || TIMING.default).call, round2Ms:(TIMING[phaseOf(body)] || TIMING.default).round2,
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
      // R2544.185: the same base model behind two providers is ONE opinion
      const families = new Set(winners.map(v => familyOf(v.model || v.member)));
      if (families.size < 2) return {ok:false, reason:'FAILOVER_SAME_MODEL_ONLY'};
      // one complete answer (the most confident on the decision field), never a mix of members
      const dk = (CRITICAL[phaseOf(body)] || [])[0];
      const conf = v => Number(v.answers?.[dk]?.confidence ?? -1);
      const pickV = [...winners].sort((a, b) => conf(b) - conf(a))[0];
      const answer = pickV.answers;
      // Different voters' probabilities are not mixed into a new executable proposal.
      const route = {version:FAILOVER_VERSION, owner:'COMMITTEE', trigger:failure.reason,
        requestId:crypto.randomUUID(),symbol:body.state?.coreMarketPacket?.symbol||body.state?.record?.symbol||body.state?.record?.position?.symbol||null,
        phase:SUPPORTED.find(k=>Object.hasOwn(body.questions,k)),proposalHash:result.final,
        packetHash:crypto.createHash('sha256').update(JSON.stringify(body.state?.coreMarketPacket||null)).digest('hex'),
        httpStatus:Number(failure.httpStatus) || null, at:new Date(clock()).toISOString(),
        members:winners.map(v => ({id:v.member, model:v.model || null, family:familyOf(v.model || v.member)})), executedFrom:pickV.member,
        fullAgreement:winners.every(v => fullSignature(body, v.answers) === fullSignature(body, pickV.answers)), families:families.size,
        agreeing:winners.length, seats, consensus:result.consensus || null, durationMs:clock()-started};
      return {ok:true, data:{answers:answer}, route, model:'COMMITTEE', costUsd:null};
    } catch { return {ok:false, reason:'FAILOVER_COMMITTEE_EXCEPTION'}; }
    finally { active--; }
  };
}
module.exports = {FAILOVER_VERSION, SUPPORTED, CRITICAL, TIMING, ADVISOR_ONLY, advisorOnly, advisorEligible, compactAdvisor, withAdvisors, supported, creditFailure, parseResponse, validateAnswers, signature, fullSignature, familyOf, phaseOf, createCommitteeFallback};
