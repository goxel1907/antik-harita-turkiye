'use strict';
// R2544.110 (kullanıcı 02.11: "versiyon güncellemesi Office'te deployda yenilenmiyor"): Office başlığı çekirdeğin RUNTIME_RELEASE etiketini
// gösteriyor; o etiket R2544.67'den beri elle güncellenmediği için her kurulumdan sonra "R2544.67-TOP3-SUBS" yazıyordu.
// Kural: çekirdek etiketi, kurulum betiğinin beklediği etiket ve Office sürümündeki R numarası HEP aynı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('R2544.110 çekirdek etiketi = JEV-DEPLOY beklenen etiket = Office sürümündeki R numarası',()=>{
  const core=src('server.js').match(/const RUNTIME_RELEASE='([^']+)'/)[1];
  const dep=src('jev-brain/JEV-DEPLOY.ps1').match(/\$EXPECTED_RELEASE = '([^']+)'/)[1];
  const office=src('office-dashboard/office-server.js').match(/const OFFICE_VERSION = '[\d.]+-(R\d+\.\d+)-JEV-Brain'/)[1];
  assert.equal(core,office,'çekirdek etiketi Office sürümüyle aynı olmalı');
  assert.equal(dep,core,'kurulum betiği aynı etiketi beklemeli');
});

// R2544.111 (02.11: iki kurulum "Could not resolve host: github.com" ile durdu): GitHub yedeği 4 kez denenir, olmazsa kurulum devam eder
test('R2544.111 JEV-DEPLOY: GitHub gönderimi 4 deneme, sonra uyarı ve devam; iki gönderim de bu yoldan',()=>{
  const d=src('jev-brain/JEV-DEPLOY.ps1');
  assert.ok(d.includes('function Push-Retry'));assert.ok(d.includes('for ($i = 1; $i -le 4; $i++)'));
  assert.ok(d.includes('WARNING GITHUB_PUSH_SKIPPED'));
  assert.ok(d.includes("$null = Push-Retry $SRC @('push', 'origin', \"HEAD:refs/heads/$BRANCH\")"));
  assert.ok(d.includes("$null = Push-Retry $PUB @('push', 'origin', $PUBBRANCH)"));
  assert.ok(!/Invoke-Git \$(SRC|PUB) push/.test(d),'tek denemelik push kalmadı');
});
