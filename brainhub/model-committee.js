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
// R2544.94 MODEL KARNESİ + KALAN LİMİT (kullanıcı 27.10: "model karnesi ... modellerin office'te kalan limit ve başka gösterge"):
// sağlayıcıların YAYIMLADIĞI ücretsiz sınırlar (kaynak: sağlayıcı sayfaları / mnfst/awesome-free-llm-apis, 27.10). 9Router'ın kendi kota
// sayfası panel girişi ister (401) -> 9Router modellerinde kalan = yayımlanan günlük sınır - BrainHub'ın bugünkü çağrısı (YAKLAŞIK).
const PROVIDER_LIMITS = [
  [/^ROUTER:groq\//i, { perDay:1000, text:'Groq 1000/gün' }],
  [/^ROUTER:(nvidia|nim)\//i, { perDay:10000, text:'NVIDIA 10.000/gün' }],
  [/^ROUTER:cerebras\//i, { perDay:null, text:'Cerebras jeton kovası' }],
  [/^ROUTER:(cf|cloudflare)/i, { perDay:null, text:'Cloudflare 10k nöron/gün' }],
  [/^ROUTER:mistral\//i, { perDay:null, text:'Mistral ~1/sn' }],
  [/^ROUTER:(glm|zai)\//i, { perDay:null, text:'GLM aynı anda 1' }],
  [/^ROUTER:(gemini|google|aistudio)\//i, { perDay:null, text:'AI Studio günlük' }],
  [/^ROUTER:kc\//i, { perDay:null, text:'Kilo 200/saat' }],
  [/^ROUTER:kr\//i, { perDay:null, text:'Kiro aylık kota' }],
  [/^ROUTER:gc\//i, { perDay:null, text:'Gemini CLI günlük' }],
  [/^(OR:|FREE:openrouter)/i, { perDay:null, shared:'OR', text:'OpenRouter hesap' }]];
const limitOf = id => (PROVIDER_LIMITS.find(([re]) => re.test(String(id || ''))) || [null, null])[1];
const QUOTA_RE = /quota|limit|exhaust|exceeded|\b429\b|\b402\b|too many|rate.?limit|credits/i;
// MONTHLY / QUOTA = the free allowance is used up (waits for the reset); RATE = the provider is busy right now (429), it comes back by itself
const quotaOf = (err, at) => { const e = String(err || ''); if (!QUOTA_RE.test(e)) return null; const kind = /month/i.test(e) ? 'MONTHLY' : /reached the limit|exhaust|credits|402|quota/i.test(e) ? 'QUOTA' : 'RATE'; return { at, kind, monthly:kind === 'MONTHLY', text:e.slice(0, 120) }; };
const dayOf = t => new Date(t).toISOString().slice(0, 10);
// R2544.95 (kullanıcı 27.10: "hangilerine anahtar gireceğim"): 9Router'a eklenen sağlayıcıların modelleri kurula katılırken HER SAĞLAYICIDAN
// en çok 3 (toplam 12): NVIDIA 100+ model getirir, tek başına bütün yerleri kapıp Groq / Gemini'yi dışarıda bırakmasın. Ses / gömme / güvenlik
// modelleri (metin trader'ı değil) alınmaz.
const ROUTER_NOT_TEXT = /tts|whisper|embed|rerank|guard|safety|transcri|speech|audio|image-gen|imagen|veo/i;
// R2544.96 (27.10 kurulumdan sonra): 9Router'ın model listesi eski; Groq / NVIDIA'da listedeki modellerin çoğu kalkmış (410 Gone, 404 "does not
// exist"). Kalkmış model 3 gün boyunca yer TUTMAZ (sıradaki model geçer; 3 gün sonra bir kez daha denenir). Sağlayıcının bugün açık olan modelleri
// (candidates) listeden önce gelir ve güçlü-model süzgecinden muaftır (elle seçildiler).
const GONE_RE = /\[404\]|\b410\b|\bGone\b|end of life|does not exist|Not Found|not found|decommission|no longer (available|supported)/i;
const GONE_TTL_MS = 3 * 24 * 3600000;
// R2544.97 (R96 kurulumundan sonra): Groq ücretsiz katmanı tek istekte ~8K jeton kabul eder; masa / sınav paketi (~17K karakter + 4096 cevap)
// "413 Request too large" alır: sağlık yoklamasını geçer ama gerçek soruda hep düşer → o da 3 gün yer tutmaz. Üst üste 3 zaman aşımı (NVIDIA
// ücretsiz kuyruğu GLM 5.3 / DeepSeek V4.1: 110 sn) da öyle; yer sıradaki modele geçer.
const TOO_BIG_RE = /\b413\b|Request too large|maximum context|context.{0,12}(length|window).{0,20}exceed/i;
const SLOW_RE = /timeout|timed out|aborted/i;
const unusableWhy = rec => { const e = String(rec?.error || '');
  if (TOO_BIG_RE.test(e)) return 'TOO_BIG';
  if (GONE_RE.test(e) && !QUOTA_RE.test(e.replace(/\b404\b|\b410\b/g, ''))) return 'GONE';
  if ((rec?.consecutiveFail || 0) >= 3 && SLOW_RE.test(e)) return 'SLOW';
  return null; };
const isGone = (rec, now = Date.now()) => !!(rec && rec.lastOk === false && unusableWhy(rec) && now - (Number(rec.at) || 0) < GONE_TTL_MS);
function pickRouterExtras(ids, { have = new Set(), strong = /./, perProvider = 3, max = 12, candidates = [], gone = () => false } = {}) {
  const per = new Map(), out = [], cand = new Set(candidates), seen = new Set();
  for (const m of [...(Array.isArray(candidates) ? candidates : []), ...(Array.isArray(ids) ? ids : [])]) {
    if (seen.has(m)) continue; seen.add(m);
    if (have.has(m) || /^(kr|gc|oc)\//.test(m) || /qwen3-coder/.test(m) || ROUTER_NOT_TEXT.test(m) || (!cand.has(m) && !strong.test(m))) continue;
    if (gone('ROUTER:' + m)) continue;
    const p = String(m).split('/')[0], n = per.get(p) || 0; if (n >= perProvider) continue;
    per.set(p, n + 1); out.push(m); if (out.length >= max) break;
  }
  return out;
}
const memberKey = id => String(id || '').replace(/^ROUTER:|^FREE:|^OR:/, '');
const avg = (s, n) => n ? Number((s / n).toFixed(3)) : null;
// a vote is scored only when the outcome (R) is known: TAKE is right when R > 0, SKIP is right when R <= 0.
// The edge (avg R of its TAKEs - avg R of its SKIPs) is the number that matters: "always SKIP" gets a high hit rate and no edge.
function scoreAdd(acc, key, decision, R) {
  if (!key || !(decision === 'TAKE' || decision === 'SKIP') || !Number.isFinite(R)) return;
  const s = acc[key] || (acc[key] = { TAKE:{ n:0, sum:0 }, SKIP:{ n:0, sum:0 }, hit:0 });
  s[decision].n++; s[decision].sum += R; if ((decision === 'TAKE') === (R > 0)) s.hit++;
}
function scoreFinish(acc) {
  const out = {};
  for (const [k, s] of Object.entries(acc)) { const n = s.TAKE.n + s.SKIP.n, t = avg(s.TAKE.sum, s.TAKE.n), k2 = avg(s.SKIP.sum, s.SKIP.n);
    out[k] = { n, take:{ n:s.TAKE.n, avgR:t }, skip:{ n:s.SKIP.n, avgR:k2 }, edge:t !== null && k2 !== null ? Number((t - k2).toFixed(3)) : null, hitPct:n ? Math.round(s.hit / n * 100) : null }; }
  return out;
}
// lessons: closed trades (features.committee = shadow or gate record); answers + key: the exam (R from the key, never shown to models)
function scorecard({ lessons = [], answers = [], key = null } = {}) {
  const live = {}, exam = {}, cm = {}; let missed = 0, scored = 0, baseSum = 0, examN = 0, examSum = 0;
  for (const l of Array.isArray(lessons) ? lessons : []) { const c = l?.features?.committee, R = Number(l?.rMultiple); if (!c || !Number.isFinite(R)) continue;
    if (c.error || !c.decision) { missed++; continue; } scored++; baseSum += R; scoreAdd(cm, 'live', c.decision, R);
    for (const v of (c.round1 && c.round1.length ? c.round1 : c.votes) || []) scoreAdd(live, memberKey(v.m), v.d, R); }
  for (const a of Array.isArray(answers) ? answers : []) { const R = Number(key?.[a?.id]?.R); if (!Number.isFinite(R)) continue; examN++; examSum += R;
    if (a.judge === 'COMMITTEE') scoreAdd(cm, 'exam', a.decision, R);
    for (const v of a.round1 || []) if (v.ok !== false) scoreAdd(exam, memberKey(v.member), v.decision, R); }
  const c = scoreFinish(cm);
  return { live:scoreFinish(live), exam:scoreFinish(exam), committee:{ live:c.live || null, exam:c.exam || null, missed, scored, baseR:avg(baseSum, scored), examN, examBaseR:avg(examSum, examN) } };
}
// one row per member for the Office board: health, today's calls, remaining limit, live + exam scorecard
function board({ status = null, freeStatus = null, score = null, now = Date.now() } = {}) {
  const today = dayOf(now), q = freeStatus?.quota || null, pm = new Map((freeStatus?.perModel || []).map(x => [x.model, x]));
  const team = status?.team || [];
  const rows = (status?.members || []).map(m => { const L = limitOf(m.id) || {}, same = m.day === today, used = same ? (m.callsToday || 0) : 0, okN = same ? (m.okToday || 0) : 0;
    const orModel = /^OR:/.test(m.id) ? m.id.slice(3) : null, p = orModel ? pm.get(orModel) : null, k = memberKey(m.id);
    const cool = p && p.cooldownUntil > now ? Math.ceil((p.cooldownUntil - now) / 60000) : null;
    return { id:m.id, key:k, family:m.family || family(m.id), healthy:m.healthy === true, inTeam:team.includes(m.id), today:{ calls:used, ok:okN, avgMs:same && used ? Math.round((m.msToday || 0) / used) : null },
      limit:{ text:L.text || null, perDay:L.perDay || null, remaining:L.perDay ? Math.max(0, L.perDay - used) : null, approx:!!L.perDay, account:L.shared === 'OR' && q ? { used:q.used, limit:q.limit, remaining:q.remaining ?? Math.max(0, q.limit - q.used) } : null, cooldownMin:cool },
      quota:m.quota || (m.lastOk === false ? quotaOf(m.error, m.at || null) : null), lastError:m.lastOk === false ? (m.error || null) : null, live:score?.live?.[k] || null, exam:score?.exam?.[k] || null }; });
  rows.sort((a, b) => (b.inTeam - a.inTeam) || (b.healthy - a.healthy) || (((b.live?.n || 0) + (b.exam?.n || 0)) - ((a.live?.n || 0) + (a.exam?.n || 0))));
  return { at:now, rows, orAccount:q ? { used:q.used, limit:q.limit, remaining:q.remaining ?? Math.max(0, q.limit - q.used) } : null, committee:score?.committee || null };
}
const PROBE_SYSTEM = 'Health check. Answer ONLY with this JSON and nothing else: {"ok":true,"model":"<your model name>"}';
const validProbe = t => { try { return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)?.[0]).ok === true; } catch { return false; } };
// members: [{ id, call:async({system,prompt,validate,role})=>({ok,text,model}) }]  (id = 'ROUTER:kr/claude-sonnet-4.5' or 'FREE:openrouter')
function createCommittee({ members: membersIn = [], healthFile = null, clock = () => Date.now(), size = 3, probeEveryMs = 60 * 60000, timeoutMs = 120000 } = {}) {
  // R2544.92: members may be a function (re-discovered: models added to 9Router / OpenRouter join without a code change)
  let health = {}; try { if (healthFile) health = JSON.parse(fs.readFileSync(healthFile, 'utf8')).health || {}; } catch {}
  // R2544.96: the members function is told which models are gone (from THIS committee's own health)
  const ctx = { gone:id => isGone(health[id], clock()) };
  const membersNow = () => { try { const m = typeof membersIn === 'function' ? membersIn(ctx) : membersIn; return Array.isArray(m) ? m : []; } catch { return []; } };
  let probing = false, lastProbeAt = 0;
  const save = () => { if (!healthFile) return; try { fs.mkdirSync(path.dirname(healthFile), { recursive:true }); fs.writeFileSync(healthFile + '.tmp', JSON.stringify({ version:COMMITTEE_VERSION, at:new Date(clock()).toISOString(), health }, null, 1)); fs.renameSync(healthFile + '.tmp', healthFile); } catch {} };
  // R2544.94: today's counters (calls / ok / ms, probes included: they spend quota too) and a quota flag read from the error text
  const mark = (id, ok, extra = {}) => { const h = health[id] || { ok:0, fail:0 }, today = dayOf(clock()), same = h.day === today, err = String(extra.error || '');
    health[id] = { ...h, ...extra, lastOk:ok, at:clock(), ok:(h.ok || 0) + (ok ? 1 : 0), fail:(h.fail || 0) + (ok ? 0 : 1), consecutiveFail:ok ? 0 : (h.consecutiveFail || 0) + 1,
      day:today, callsToday:(same ? h.callsToday || 0 : 0) + 1, okToday:(same ? h.okToday || 0 : 0) + (ok ? 1 : 0), msToday:(same ? h.msToday || 0 : 0) + (Number(extra.latencyMs) || 0),
      quota:ok ? null : quotaOf(err, clock()) || (h.quota || null) }; };
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
module.exports = { COMMITTEE_VERSION, family, provider, PROBE_SYSTEM, validProbe, createCommittee, PROVIDER_LIMITS, limitOf, quotaOf, memberKey, scorecard, board, pickRouterExtras, ROUTER_NOT_TEXT, GONE_RE, isGone, unusableWhy };
