'use strict';
// R2544.86 MODEL KURULU (kullanıcı 27.10: "9Router'dakileri de dene, bağla"; "modellerin çalıştığına emin ol, ortak mutabakat yapacaklar
// aralarında"). Ücretsiz modeller (9Router: Kiro'daki Claude / DeepSeek / GLM ...; OpenRouter ücretsiz havuzu):
//  1) SAĞLIK: her 30 dk her adaya küçük bir JSON sorusu; cevap vermeyen kurula alınmaz (data/model-committee-health.json, Office).
//  2) KURUL: farklı ailelerden en çok 3 sağlıklı üye AYNI ekranı birbirinden habersiz değerlendirir (1. tur).
//  3) MUTABAKAT: oybirliği -> karar. Ayrışma -> 2. tur: her üye diğerlerinin oyunu ve gerekçesini görür, son kararını verir; çoğunluk
//     -> karar; çoğunluk yoksa varsayılan (masa: HOLD, giriş: SKIP). Her üyenin oyu ayrı kaydedilir (ölçüm için).
const fs = require('fs'), path = require('path');
const COMMITTEE_VERSION = 'R2544.86-MODEL-COMMITTEE';
const family = id => { const s = String(id || '').toLowerCase(); return /claude/.test(s) ? 'CLAUDE' : /deepseek/.test(s) ? 'DEEPSEEK' : /glm/.test(s) ? 'GLM' : /qwen/.test(s) ? 'QWEN' : /nemotron/.test(s) ? 'NEMOTRON' : s.startsWith('openrouter') ? 'OPENROUTER' : s.split('/')[0] || 'OTHER'; };
const PROBE_SYSTEM = 'Health check. Answer ONLY with this JSON and nothing else: {"ok":true,"model":"<your model name>"}';
const validProbe = t => { try { return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)?.[0]).ok === true; } catch { return false; } };
// members: [{ id, call:async({system,prompt,validate,role})=>({ok,text,model}) }]  (id = 'ROUTER:kr/claude-sonnet-4.5' or 'FREE:openrouter')
function createCommittee({ members = [], healthFile = null, clock = () => Date.now(), size = 3, probeEveryMs = 30 * 60000, timeoutMs = 120000 } = {}) {
  let health = {}; try { if (healthFile) health = JSON.parse(fs.readFileSync(healthFile, 'utf8')).health || {}; } catch {}
  let probing = false, lastProbeAt = 0;
  const save = () => { if (!healthFile) return; try { fs.mkdirSync(path.dirname(healthFile), { recursive:true }); fs.writeFileSync(healthFile + '.tmp', JSON.stringify({ version:COMMITTEE_VERSION, at:new Date(clock()).toISOString(), health }, null, 1)); fs.renameSync(healthFile + '.tmp', healthFile); } catch {} };
  const mark = (id, ok, extra = {}) => { const h = health[id] || { ok:0, fail:0 }; health[id] = { ...h, ...extra, lastOk:ok, at:clock(), ok:(h.ok || 0) + (ok ? 1 : 0), fail:(h.fail || 0) + (ok ? 0 : 1), consecutiveFail:ok ? 0 : (h.consecutiveFail || 0) + 1 }; };
  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r({ ok:false, reason:'COMMITTEE_TIMEOUT' }), ms))]);
  async function probe({ force = false } = {}) {
    if (probing || (!force && clock() - lastProbeAt < probeEveryMs)) return null; probing = true; lastProbeAt = clock();
    try {
      await Promise.all(members.map(async m => { const t0 = clock(); let r;
        try { r = await withTimeout(m.call({ system:PROBE_SYSTEM, prompt:'ping', validate:validProbe, role:'TRADER' }), 60000); } catch (e) { r = { ok:false, reason:String(e?.message || e).slice(0, 160) }; }
        mark(m.id, !!(r?.ok && validProbe(r.text)), { latencyMs:clock() - t0, model:r?.model || null, error:r?.ok ? null : String(r?.reason || r?.detail || 'FAILED').slice(0, 200), probedAt:clock() }); }));
      save(); return healthy().map(m => m.id);
    } finally { probing = false; }
  }
  // healthy = last probe or last real call ok; never more than 2 consecutive failures
  function healthy() { return members.filter(m => health[m.id]?.lastOk === true && (health[m.id].consecutiveFail || 0) < 3); }
  // up to `size` members from different families first (diversity), then fill
  function pick() {
    const h = healthy(), out = [], fams = new Set();
    for (const m of h) { const f = family(m.id); if (!fams.has(f)) { out.push(m); fams.add(f); } if (out.length >= size) return out; }
    for (const m of h) { if (!out.includes(m)) out.push(m); if (out.length >= size) break; }
    return out;
  }
  async function ask(m, system, prompt, validate, parse) {
    const t0 = clock(); let r;
    try { r = await withTimeout(m.call({ system, prompt, validate, role:'TRADER' }), timeoutMs); } catch (e) { r = { ok:false, reason:String(e?.message || e).slice(0, 160) }; }
    const p = r?.ok ? parse(r.text) : null, ok = !!p?.ok;
    mark(m.id, ok, { latencyMs:clock() - t0, model:r?.model || health[m.id]?.model || null, error:ok ? null : String(r?.reason || p?.reason || 'FAILED').slice(0, 200) });
    return { member:m.id, model:r?.model || null, ok, vote:ok ? p : null, ms:clock() - t0, error:ok ? null : String(r?.reason || p?.reason || 'FAILED').slice(0, 160) };
  }
  // field = the voted key ('decision' | 'action'); fallback = value when there is no majority
  async function decide({ system, prompt, validate, parse, field, fallback, reasonOf = v => v?.reasonTr || '' }) {
    const team = pick(); if (!team.length) { save(); return { ok:false, reason:'COMMITTEE_NO_HEALTHY_MEMBER', votes:[] }; }
    const r1 = await Promise.all(team.map(m => ask(m, system, prompt, validate, parse))), v1 = r1.filter(x => x.ok);
    const tally = vs => { const c = {}; for (const v of vs) c[v.vote[field]] = (c[v.vote[field]] || 0) + 1; return c; };
    const majority = (vs) => { const c = tally(vs), need = Math.floor(vs.length / 2) + 1; const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= need ? top[0] : null; };
    if (!v1.length) { save(); return { ok:false, reason:'COMMITTEE_NO_ANSWER', votes:r1, rounds:1 }; }
    const unanimous = Object.keys(tally(v1)).length === 1;
    if (unanimous || v1.length === 1) { save(); return { ok:true, final:v1.length >= 2 ? v1[0].vote[field] : fallback, consensus:v1.length >= 2 ? 'UNANIMOUS' : 'SINGLE_VOTER_DEFAULT', votes:r1, round2:null, rounds:1, voters:v1.length, version:COMMITTEE_VERSION }; }
    // round 2: each member sees the others' views and gives a final answer
    const views = v1.map((x, i) => `Trader ${String.fromCharCode(65 + i)}: ${x.vote[field]} — ${reasonOf(x.vote)}`).join('\n');
    const sys2 = system + '\n\nOther traders on the desk looked at the SAME screen independently and disagree:\n' + views + '\nWeigh their arguments against the chart, then give your FINAL answer in the same JSON format.';
    const r2 = await Promise.all(v1.map(x => ask(team.find(m => m.id === x.member), sys2, prompt, validate, parse))), v2 = r2.filter(x => x.ok);
    const fin = v2.length >= 2 ? majority(v2) : null;
    save();
    return { ok:true, final:fin ?? fallback, consensus:fin ? 'MAJORITY_AFTER_DEBATE' : 'NO_MAJORITY_DEFAULT', votes:r1, round2:r2, rounds:2, voters:v2.length, version:COMMITTEE_VERSION };
  }
  function status() { return { version:COMMITTEE_VERSION, members:members.map(m => ({ id:m.id, family:family(m.id), ...(health[m.id] || {}), healthy:healthy().includes(m) })), team:pick().map(m => m.id), lastProbeAt }; }
  return { probe, healthy, pick, decide, status };
}
module.exports = { COMMITTEE_VERSION, family, PROBE_SYSTEM, validProbe, createCommittee };
