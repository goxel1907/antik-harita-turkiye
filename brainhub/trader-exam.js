'use strict';
// R2544.86 TRADER SINAVI (yalnız ölçüm): Claud-Work\sinav\packets.jsonl içindeki geçmiş sinyal "ekranlarını" (trader-brain.js; coin ve
// tarih gizli, fiyat giriş = 100) ücretsiz modellere sorar: önce 9Router (Kiro'daki ücretsiz Claude vb.), sonra OpenRouter ücretsiz.
// Cevaplar answers.jsonl'a yazılır; sonuçları (R) model görmez, analiz ayrı yapılır. Emir yok, giriş kararı yok.
// Hız: en çok 45 sn'de bir soru, günde en çok dailyCap; packets.jsonl yoksa hiçbir şey yapmaz.
const fs = require('fs'), path = require('path');
const TB = require('./trader-brain');
const EXAM_VERSION = 'R2544.92-TRADER-EXAM-PA3';
function createTraderExam({ dir, judges = {}, committee = null, clock = () => Date.now(), minIntervalMs = 45000, dailyCap = 600, maxAttempts = 3 } = {}) {
  const P = f => path.join(dir, f);
  let busy = false, lastAt = 0, st = null;
  const readState = () => { try { return JSON.parse(fs.readFileSync(P('exam-state.json'), 'utf8')); } catch { return { attempts:{}, day:null, used:0, answered:0, lastError:null }; } };
  const saveState = () => { try { fs.writeFileSync(P('exam-state.json.tmp'), JSON.stringify(st)); fs.renameSync(P('exam-state.json.tmp'), P('exam-state.json')); } catch {} };
  const config = () => { try { return { enabled:true, order:['ROUTER', 'FREE'], ...JSON.parse(fs.readFileSync(P('exam-config.json'), 'utf8')) }; } catch { return { enabled:true, order:['ROUTER', 'FREE'] }; } };
  function answeredIds() { const s = new Set(); try { for (const l of fs.readFileSync(P('answers.jsonl'), 'utf8').split('\n')) { if (!l.trim()) continue; try { s.add(JSON.parse(l).id); } catch {} } } catch {} return s; }
  function nextPacket(done) {
    let txt; try { txt = fs.readFileSync(P('packets.jsonl'), 'utf8'); } catch { return null; }
    for (const l of txt.split('\n')) { if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; }
      if (!j?.id || done.has(j.id) || (st.attempts[j.id] || 0) >= maxAttempts) continue; return j; }
    return null;
  }
  async function tick() {
    if (busy || !dir || !fs.existsSync(P('packets.jsonl'))) return null;
    // R2544.87: a pause written for an older build ends by itself when this build runs (enableForVersion = this exam version)
    const cfg = config(); if (cfg.enabled === false && cfg.enableForVersion !== EXAM_VERSION) return null;
    const now = clock(); if (now - lastAt < minIntervalMs) return null;
    st = st || readState(); const day = new Date(now).toISOString().slice(0, 10); if (st.day !== day) { st.day = day; st.used = 0; }
    if (st.used >= (Number(cfg.dailyCap) || dailyCap)) return { skipped:'DAILY_CAP' };
    // R2544.92: no attempt (and no packet marked failed) while the committee has fewer than 2 healthy members (27.10: 177 packets burned)
    if (committee && typeof committee.healthy === 'function' && committee.healthy().length < 2) return { skipped:'COMMITTEE_NOT_READY' };
    const done = answeredIds(), pk = nextPacket(done); if (!pk) { st.finished = true; saveState(); return { finished:true }; }
    busy = true; lastAt = now;
    try {
      st.attempts[pk.id] = (st.attempts[pk.id] || 0) + 1; st.used++;
      const tried = [];
      // R2544.86: the committee answers together (each member's vote is kept: the exam measures every model AND the consensus)
      if (committee && typeof committee.decide === 'function' && (cfg.mode || 'COMMITTEE') === 'COMMITTEE') {
        let r; try { r = await committee.decide({ system:TB.ENTRY_SYSTEM, prompt:JSON.stringify(pk.packet), validate:TB.validEntry, parse:TB.parseEntry, field:'decision', fallback:'SKIP', roles:TB.ENTRY_ROLES }); } catch (e) { r = { ok:false, reason:String(e?.message || e).slice(0, 120) }; }
        if (r?.ok) {
          const slim = a => (a || []).map(v => ({ member:v.member, seat:v.seat || null, model:v.model, ok:v.ok, ms:v.ms, error:v.error, ...(v.vote ? { decision:v.vote.decision, confidence:v.vote.confidence, pTarget:v.vote.pTarget, reasonTr:v.vote.reasonTr, keyRisk:v.vote.keyRisk } : {}) }));
          fs.appendFileSync(P('answers.jsonl'), JSON.stringify({ id:pk.id, rule:pk.rule, at:new Date(clock()).toISOString(), judge:'COMMITTEE', decision:r.final, consensus:r.consensus, rounds:r.rounds, voters:r.voters, round1:slim(r.votes), round2:slim(r.round2), version:EXAM_VERSION }) + '\n');
          st.answered = (st.answered || 0) + 1; st.lastError = null; st.lastOk = { id:pk.id, judge:'COMMITTEE', consensus:r.consensus, at:clock() }; saveState();
          return { ok:true, id:pk.id, judge:'COMMITTEE', decision:r.final };
        }
        tried.push('COMMITTEE:' + (r?.reason || 'FAILED'));
        st.lastError = { at:clock(), id:pk.id, tried }; saveState(); return { ok:false, tried };
      }
      for (const j of cfg.order || ['ROUTER', 'FREE']) {
        const w = j === 'ROUTER' ? judges.router : j === 'FREE' ? judges.free : null;
        if (!w || typeof w.review !== 'function') { tried.push(j + '_NOT_WIRED'); continue; }
        let r; try { r = await w.review({ system:TB.ENTRY_SYSTEM, prompt:JSON.stringify(pk.packet), validate:TB.validEntry, role:'TRADER' }); } catch (e) { r = { ok:false, reason:String(e?.message || e).slice(0, 120) }; }
        const d = r?.ok ? TB.parseEntry(r.text) : null;
        if (d?.ok) {
          fs.appendFileSync(P('answers.jsonl'), JSON.stringify({ id:pk.id, rule:pk.rule, at:new Date(clock()).toISOString(), judge:j, model:r.model || null, ...d, version:EXAM_VERSION }) + '\n');
          st.answered = (st.answered || 0) + 1; st.lastError = null; st.lastOk = { id:pk.id, judge:j, model:r.model || null, at:clock() }; saveState();
          return { ok:true, id:pk.id, judge:j, decision:d.decision };
        }
        tried.push(j + ':' + (r?.reason || d?.reason || 'FAILED'));
      }
      st.lastError = { at:clock(), id:pk.id, tried }; saveState(); return { ok:false, tried };
    } finally { busy = false; }
  }
  function status() { st = st || readState(); let total = 0; try { total = fs.readFileSync(P('packets.jsonl'), 'utf8').split('\n').filter(l => l.trim()).length; } catch {}
    return { version:EXAM_VERSION, dir, present:total > 0, total, answered:answeredIds().size, today:st.used || 0, finished:st.finished === true, lastError:st.lastError || null, lastOk:st.lastOk || null }; }
  return { tick, status };
}
module.exports = { EXAM_VERSION, createTraderExam };
