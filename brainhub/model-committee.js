'use strict';
// R2544.86 MODEL KURULU (kullanıcı 27.10: "9Router'dakileri de dene, bağla"; "modellerin çalıştığına emin ol, ortak mutabakat yapacaklar
// aralarında"). Ücretsiz modeller (9Router: Kiro'daki Claude / DeepSeek / GLM ...; OpenRouter ücretsiz havuzu):
//  1) SAĞLIK: her 30 dk her adaya küçük bir JSON sorusu; cevap vermeyen kurula alınmaz (data/model-committee-health.json, Office).
//  2) KURUL: farklı ailelerden en çok 3 sağlıklı üye AYNI ekranı birbirinden habersiz değerlendirir (1. tur).
//  3) MUTABAKAT: oybirliği -> karar. Ayrışma -> 2. tur: her üye diğerlerinin oyunu ve gerekçesini görür, son kararını verir; çoğunluk
//     -> karar; çoğunluk yoksa varsayılan (masa: HOLD, giriş: SKIP). Her üyenin oyu ayrı kaydedilir (ölçüm için).
const fs = require('fs'), path = require('path');
const COMMITTEE_VERSION = 'R2544.86-MODEL-COMMITTEE';
// R2544.92: more families (OpenRouter / 9Router API providers) and the provider of a member (ROUTER:kr = Kiro, ROUTER:gc = Gemini CLI, OR = OpenRouter ...)
const provider = id => { const s = String(id || ''); const m = s.match(/^ROUTER:([a-z0-9-]+)\//i); return m ? 'ROUTER:' + m[1].toLowerCase() : s.split(':')[0]; };
const family = id => { const s = String(id || '').toLowerCase(); return /gemma/.test(s) ? 'GEMMA' : /gemini/.test(s) ? 'GEMINI' : /minimax/.test(s) ? 'MINIMAX' : /claude/.test(s) ? 'CLAUDE' : /llama|maverick|scout/.test(s) ? 'LLAMA' : /mistral|magistral|codestral/.test(s) ? 'MISTRAL' : /kimi/.test(s) ? 'KIMI' : /gpt-oss|openai\//.test(s) ? 'GPTOSS' : /laguna|poolside/.test(s) ? 'POOLSIDE' : /xing/.test(s) ? 'XING' : /dots/.test(s) ? 'DOTS' : /deepseek/.test(s) ? 'DEEPSEEK' : /glm/.test(s) ? 'GLM' : /qwen/.test(s) ? 'QWEN' : /nemotron/.test(s) ? 'NEMOTRON' : s.startsWith('openrouter') ? 'OPENROUTER' : s.split('/')[0] || 'OTHER'; };
const PROBE_SYSTEM = 'Health check. Answer ONLY with this JSON and nothing else: {"ok":true,"model":"<your model name>"}';
const validProbe = t => { try { return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)?.[0]).ok === true; } catch { return false; } };
// members: [{ id, call:async({system,prompt,validate,role})=>({ok,text,model}) }]  (id = 'ROUTER:kr/claude-sonnet-4.5' or 'FREE:openrouter')
function createCommittee({ members: membersIn = [], healthFile = null, clock = () => Date.now(), size = 3, probeEveryMs = 60 * 60000, timeoutMs = 120000 } = {}) {
  // R2544.92: members may be a function (re-discovered: models added to 9Router / OpenRouter join without a code change)
  const membersNow = () => { try { const m = typeof membersIn === 'function' ? membersIn() : membersIn; return Array.isArray(m) ? m : []; } catch { return []; } };
  let health = {}; try { if (healthFile) health = JSON.parse(fs.readFileSync(healthFile, 'utf8')).health || {}; } catch {}
  let probing = false, lastProbeAt = 0;
  const save = () => { if (!healthFile) return; try { fs.mkdirSync(path.dirname(healthFile), { recursive:true }); fs.writeFileSync(healthFile + '.tmp', JSON.stringify({ version:COMMITTEE_VERSION, at:new Date(clock()).toISOString(), health }, null, 1)); fs.renameSync(healthFile + '.tmp', healthFile); } catch {} };
  const mark = (id, ok, extra = {}) => { const h = health[id] || { ok:0, fail:0 }; health[id] = { ...h, ...extra, lastOk:ok, at:clock(), ok:(h.ok || 0) + (ok ? 1 : 0), fail:(h.fail || 0) + (ok ? 0 : 1), consecutiveFail:ok ? 0 : (h.consecutiveFail || 0) + 1 }; };
  // R2544.90: the timer is cleared when the answer comes (an open timer kept every test process alive ~2 min; deploy runs tests one by one)
  const withTimeout = (p, ms) => { let t; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise(r => { t = setTimeout(() => r({ ok:false, reason:'COMMITTEE_TIMEOUT' }), ms); })]); };
  async function probe({ force = false } = {}) {
    if (probing || (!force && clock() - lastProbeAt < probeEveryMs)) return null; probing = true; lastProbeAt = clock();
    try {
      await Promise.all(membersNow().map(async m => { const t0 = clock(); let r;
        try { r = await withTimeout(m.call({ system:PROBE_SYSTEM, prompt:'ping', validate:validProbe, role:'TRADER' }), 120000); } /* R2544.91: Gemini Pro thinks long */ catch (e) { r = { ok:false, reason:String(e?.message || e).slice(0, 160) }; }
        mark(m.id, !!(r?.ok && validProbe(r.text)), { latencyMs:clock() - t0, model:r?.model || null, error:r?.ok ? null : String(r?.reason || r?.detail || 'FAILED').slice(0, 200), probedAt:clock() }); }));
      save(); return healthy().map(m => m.id);
    } finally { probing = false; }
  }
  // healthy = last probe or last real call ok; never more than 2 consecutive failures
  function healthy() { return membersNow().filter(m => health[m.id]?.lastOk === true && (health[m.id].consecutiveFail || 0) < 3); }
  // up to `size` members from different families first (diversity), then fill
  function pick() {
    const h = healthy(), out = [], fams = new Set(), byProv = new Map();
    for (const m of h) { const p = provider(m.id); if (!byProv.has(p)) byProv.set(p, []); byProv.get(p).push(m); }
    // round-robin over providers, one new family at a time: a provider running out of quota never empties the table
    let moved = true;
    while (out.length < size && moved) { moved = false;
      for (const list of byProv.values()) { const i = list.findIndex(m => !fams.has(family(m.id))); if (i < 0) continue; const m = list.splice(i, 1)[0]; out.push(m); fams.add(family(m.id)); moved = true; if (out.length >= size) break; } }
    for (const m of h) { if (out.length >= size) break; if (!out.includes(m)) out.push(m); }
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
  // R2544.87 SEATS: each member owns a part of the screen (e.g. 1d/4h, 1h/15m, 5m+flow, risk); the seat text is added to its system prompt
  async function decide({ system, prompt, validate, parse, field, fallback, roles = null, reasonOf = v => v?.reasonTr || '' }) {
    const team = pick(); if (!team.length) { save(); return { ok:false, reason:'COMMITTEE_NO_HEALTHY_MEMBER', votes:[] }; }
    // R2544.91: seats go to the preferred model family first (Claude = price action even when Gemini is missing), then by order
    const seatMap = assignSeats(team, roles), seatOf = i => seatMap[i] || null, sysOf = i => seatOf(i) ? system + '\n\nYOUR SEAT AT THE DESK: ' + seatOf(i).text : system;
    const r1 = await Promise.all(team.map((m, i) => ask(m, sysOf(i), prompt, validate, parse).then(x => ({ ...x, seat:seatOf(i)?.key || null })))), v1 = r1.filter(x => x.ok);
    const tally = vs => { const c = {}; for (const v of vs) c[v.vote[field]] = (c[v.vote[field]] || 0) + 1; return c; };
    const majority = (vs) => { const c = tally(vs), need = Math.floor(vs.length / 2) + 1; const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= need ? top[0] : null; };
    if (!v1.length) { save(); return { ok:false, reason:'COMMITTEE_NO_ANSWER', votes:r1, rounds:1 }; }
    const unanimous = Object.keys(tally(v1)).length === 1;
    if (unanimous || v1.length === 1) { save(); return { ok:true, final:v1.length >= 2 ? v1[0].vote[field] : fallback, consensus:v1.length >= 2 ? 'UNANIMOUS' : 'SINGLE_VOTER_DEFAULT', votes:r1, round2:null, rounds:1, voters:v1.length, version:COMMITTEE_VERSION }; }
    // round 2: each member sees the others' views and gives a final answer
    const views = v1.map((x, i) => `Trader ${String.fromCharCode(65 + i)}${x.seat ? ' (' + x.seat + ')' : ''}: ${x.vote[field]} — ${reasonOf(x.vote)}`).join('\n');
    const r2 = await Promise.all(v1.map(x => { const i = team.findIndex(m => m.id === x.member);
      const sys2 = sysOf(i) + '\n\nOther traders on the desk looked at the SAME screen from their own seats and disagree:\n' + views + '\nWeigh their arguments against the chart, then give your FINAL answer in the same JSON format.';
      return ask(team[i], sys2, prompt, validate, parse).then(y => ({ ...y, seat:x.seat })); })), v2 = r2.filter(x => x.ok);
    const fin = v2.length >= 2 ? majority(v2) : null;
    save();
    return { ok:true, final:fin ?? fallback, consensus:fin ? 'MAJORITY_AFTER_DEBATE' : 'NO_MAJORITY_DEFAULT', votes:r1, round2:r2, rounds:2, voters:v2.length, version:COMMITTEE_VERSION };
  }
  function assignSeats(team, roles) {
    if (!Array.isArray(roles) || !roles.length) return [];
    const out = new Array(team.length).fill(null), taken = new Set(), fam = team.map(m => family(m.id));
    for (let pass = 0; pass < 3; pass++) for (const r of roles) { if (taken.has(r)) continue; const pref = (r.prefer || [])[pass]; if (!pref) continue;
      const i = fam.findIndex((f, k) => f === pref && !out[k]); if (i >= 0) { out[i] = r; taken.add(r); } }
    const rest = roles.filter(r => !taken.has(r));
    for (let k = 0; k < team.length; k++) if (!out[k]) out[k] = rest.length ? rest.shift() : roles[k % roles.length];
    return out;
  }
  function status() { return { version:COMMITTEE_VERSION, members:membersNow().map(m => ({ id:m.id, family:family(m.id), ...(health[m.id] || {}), healthy:healthy().includes(m) })), team:pick().map(m => m.id), lastProbeAt }; }
  return { probe, healthy, pick, decide, status, assignSeats };
}
module.exports = { COMMITTEE_VERSION, family, provider, PROBE_SYSTEM, validProbe, createCommittee };
