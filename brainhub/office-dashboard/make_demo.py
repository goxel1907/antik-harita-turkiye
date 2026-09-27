import json, datetime as dt
base = dt.datetime(2026,9,21,6,24,40,tzinfo=dt.timezone.utc)
B = int(base.timestamp()*1000)
def ago(m): return B - int(m*60000)
def iso(ms): return dt.datetime.fromtimestamp(ms/1000, dt.timezone.utc).isoformat().replace('+00:00','Z')
rows = [
 dict(symbol='SAGAUSDT', side='SHORT', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='3m', ownerTF='15m', waitFor='', workerState='REFRESH_REQUIRED', lastAnalyzedAt=ago(3)),
 dict(symbol='PTBUSDT', side='LONG', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='4h', ownerTF='1d', waitFor="NONE — tüm TF'lerde teyit edilmemiş oluşan mumları ve yapısal dönüşümün teyit edilmediği belirtiliyor.", workerState='REFRESH_REQUIRED', lastAnalyzedAt=ago(9)),
 dict(symbol='CUSDT', side='LONG', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='1m', ownerTF='1d', waitFor='Model somut bekleme koşulu üretmedi; sonraki taze veride yeniden değerlendir.', workerState='REFRESH_REQUIRED', lastAnalyzedAt=ago(14)),
 dict(symbol='NEARUSDT', side='SHORT', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='4h', ownerTF='1d', waitFor="1h-4h-1d süreklilik, 1d'de kapanmış mumlar ve oluşan mumu ayrı değerlendirilir; 1h'de FAILED_BREAKOUT, 4h'de ACCEPTED.", workerState='WAIT', lastAnalyzedAt=ago(24)),
 dict(symbol='AKEUSDT', side='LONG', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='5m', ownerTF='1h', waitFor="NONE — tüm TF'lerde NO_ACTIVE_BREAKOUT veya WATCH durumu; 1h'da ACCEPTED ve ACTIVE_CONTEXT durumu.", workerState='REFRESH_REQUIRED', lastAnalyzedAt=ago(31)),
 dict(symbol='BTWUSDT', side='LONG', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='1m', ownerTF='1m', waitFor="NONE — tüm TF'lerde NO_ACTIVE_BREAKOUT ve ACTIVE_CONTEXT → teyit yok, sadece bağlam.", workerState='REFRESH_REQUIRED', lastAnalyzedAt=ago(38)),
 dict(symbol='GUSDT', side='LONG', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='1m', ownerTF='1m', waitFor='1m → 3m → 5m → 15m → 30m; 45m ve üst zaman dilimlerinde formasyonlar teyit edilmemiş.', workerState='WAIT', lastAnalyzedAt=ago(47)),
 dict(symbol='FFUSDT', side='SHORT', state='WATCH', planStatus='WATCH', originTF='3m', ownerTF='5m', waitFor="NONE (CORE_DECISION: WATCH → tüm TF_EVIDENCE'de teyit edilmemiş oluşan ve yön etkileri)", workerState='REFRESH_REQUIRED', lastAnalyzedAt=ago(185)),
 dict(symbol='ONEUSDT', side='LONG', state='WATCH', planStatus='REVIEW_REQUIRED', originTF='1d', ownerTF='1d', waitFor="1d yükseliş + RSI 95.74 + yapısal destek → 1d'deki teyitli yapısal destek.", workerState='WAIT', lastAnalyzedAt=ago(190)),
]
for r in rows: r['reanalysisEligible']=True
plans_spec = [(2,'SAGAUSDT','SHORT','REVIEW_REQUIRED'),(8,'PTBUSDT','LONG','WATCH'),(13,'SAGAUSDT','SHORT','REVIEW_REQUIRED'),(18,'CUSDT','LONG','WATCH'),
 (23,'PTBUSDT','LONG','WATCH'),(29,'SAGAUSDT','SHORT','WATCH'),(34,'AKEUSDT','LONG','REVIEW_REQUIRED'),(39,'PTBUSDT','LONG','WATCH'),(45,'SAGAUSDT','SHORT','WATCH'),(51,'CUSDT','LONG','REVIEW_REQUIRED'),(57,'PTBUSDT','LONG','WATCH')]
waits = {r['symbol']:r['waitFor'] for r in rows}
plans=[]
for m,s,side,st in plans_spec:
    w = waits.get(s,'')
    fake = st=='WATCH' and (w.upper().startswith('NONE') or 'somut bekleme' in w)
    plans.append(dict(ts=ago(m),kind='PLAN',symbol=s,desk='brain',status=st,previousStatus=None,side=side,originTF=None,ownerTF=None,confidence=None,
      waitFor=w if st=='WATCH' else '',fakeWait=fake,reason='VISION_COMMITTEE_UNAVAILABLE' if st=='REVIEW_REQUIRED' else None,supportTFs=[],vetoTFs=[],visionAttached=9,riskReasons=['PLAN_NOT_QUALIFIED'],jev={'called':False,'veto':False,'reasons':[],'reason':'JEV_NOT_NEEDED_FOR_NON_QUALIFIED','probabilities':None,'timeframeConflicts':None,'costUsd':None}))
events=[]
for p in plans:
    events.append(dict(ts=p['ts'],kind='PLAN',symbol=p['symbol'],source='journal',desk='brain',title=f"{p['symbol']} {p['side']} → {p['status']}",detail=('Bekleme koşulu sahte (NONE...)' if p['fakeWait'] else (p['reason'] or ''))))
    if p['status']=='REVIEW_REQUIRED':
        events.append(dict(ts=p['ts']-20000,kind='PLAN_COMMITTEE_FALLBACK',symbol=p['symbol'],source='journal',desk='vision',title=f"{p['symbol']} görsel komite yanıt vermedi",detail='(demo) ayrıntı PC journal kaydında'))
for i in range(14):
    s=['PTBUSDT','CUSDT','SAGAUSDT','AKEUSDT','BTWUSDT','FFUSDT'][i%6]
    events.append(dict(ts=ago(1+i*4.1),kind='PLAN_WORKER_REVIEW',symbol=s,source='journal',desk='workers',title=f"Worker {s}: {'WAIT' if i in (5,11) else 'REFRESH_REQUIRED'}",detail=''))
events.sort(key=lambda e:-e['ts'])
st = {
 'ok':True,'featureVersion':'9.5.107-VISION','armed':True,'armedAt':iso(ago(350)),'expiresAt':iso(B+1090*60000),'liveAllowed':False,
 'execution':'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED','lastDisarmReason':'STARTUP_FAIL_CLOSED','sizingAuthority':'USER_PANEL_EXACT',
 'leaderAuto':{
   'ok':True,'configured':True,'enabled':True,'marginQuote':25,'leverage':10,'maxOpenPositions':2,'allowLong':True,'allowShort':True,'busy':False,
   'lastExecution':'LEADER_AUTO_WAIT','lastSymbol':'SAGAUSDT','lastReasons':['LEADER_PLAN_NOT_QUALIFIED','VISION_COMMITTEE_UNAVAILABLE'],'lastTickAt':iso(ago(4)),
   'diagnostics':{'universeCount':24,'lightweightUniverseCount':523,'shortlistCount':16,'eligibleCount':15,'candidates':[
      {'symbol':'SAGAUSDT','side':'SHORT','eligible':True,'stage':'PIPELINE_SELECTED'},{'symbol':'NILUSDT','side':'LONG','eligible':False,'reasons':['SPREAD_ABOVE_8_BPS']},
      {'symbol':'BTWUSDT','side':'SHORT','eligible':True},{'symbol':'CUSDT','side':'LONG','eligible':True},{'symbol':'CELRUSDT','side':'LONG','eligible':True},
      {'symbol':'PTBUSDT','side':'LONG','eligible':True},{'symbol':'1000PEPEUSDT','side':'LONG','eligible':True},{'symbol':'LUNA2USDT','side':'SHORT','eligible':True},{'symbol':'KMNOUSDT','side':'SHORT','eligible':True}]},
   'health':{'windowMinutes':60,'observedMinutes':60,'scanRuns':11,'tickResults':11,'skippedBusy':109,'skippedPipelineBusy':0,'deepAnalyses':11,'uniqueAnalyzedSymbols':4,
     'preJevQualified':0,'jevCalled':0,'jevVetoed':0,'qualified':0,'watch':7,'reviewRequired':4,'reject':0,'visionUnavailable':4,'intentReady':0,'executionResults':0,'ordersPlaced':0,
     'workerReviews':130,'workerWaits':3,'workerTriggers':0,'workerRefreshes':127,'fullVisionAvoided':3,'avgAnalysisMs':287200,
     'latestUniverseCount':24,'latestLightweightUniverseCount':523,'latestShortlistCount':16,'latestEligibleCount':15,
     'topReasons':[{'reason':'VISION_COMMITTEE_UNAVAILABLE','count':12},{'reason':'LEADER_PLAN_NOT_QUALIFIED','count':11}]},
   'analysisLifecycle':{'version':1,'tracked':24,'activeTracking':24,'rows':rows},
   'planWorkers':{'enabled':True,'busy':False,'cadenceSec':30,'parallelWithVision':True,'routineRouter':'9ROUTER_FREE_TEXT',
     'secondOpinion':{'configured':True,'model':'openrouter/free','freeOnly':True,'last':{'called':False,'ok':False,'reason':'NOT_CALLED'}},
     'lastReview':{'symbol':'PTBUSDT','side':'LONG','checkedAt':iso(ago(1)),'state':'REFRESH_REQUIRED','source':'(demo)','reason':'(demo) gerçek gerekçe PC journal kaydında'}}
 },
 'positionManager':{'ok':True,'busy':False,'cadenceMinutes':5,'ruleTr':'1m/3m/5m tek başına çıkış kararı vermez; owner zaman dilimi ve büyük resim doğrulaması gerekir.','lastReview':{'action':'HOLD','actionTr':'AÇIK POZİSYON YOK'}},
 'learning':{'recent':[],'stats':[]},
 'visionAvailability':{'summaryTr':'Görsel model çalışıyor • zaman dilimi 4h okunuyor • model sağlayıcısından yanıt alınamadı','models':[{'model':'local/brainhub-qwen3-vl-4b-16k','reason':'PROVIDER_UNAVAILABLE'}],'freeQuotaFallbackConfigured':False},
 'visionProgress':{'stage':'VISUAL_TF=4h','model':'local/brainhub-qwen3-vl-4b-16k','lastStageDurationMs':21400,'queueDepth':1,'pipelineActive':1,'error':None},
 'jev':{'configured':True,'enabled':True,'model':'typesafe/jev-1.13','mode':'ADVISORY_VETO_ONLY','budget':{'calls':0,'spentUsd':0,'softBudgetUsd':0.25,'dailyCapUsd':2.0,'remainingUsd':2.0}},
 'openRouterFreeWorker':{'configured':True,'model':'openrouter/free','freeOnly':True,'last':{'called':False,'ok':False,'reason':'NOT_CALLED'}},
}
snap = {
 'officeVersion':'1.0.0','demo':True,'demoBaseTs':B,'generatedAt':iso(B),
 'config':{'brainUrl':'http://127.0.0.1:8787','brainRoot':'C:\\BrainHub','backupRoot':'C:\\BrainHubBackups','tokenConfigured':True,'accountEnabled':True},
 'health':{'ok':True,'status':200,'ms':14,'data':{'featureVersion':'9.5.107-VISION'}},
 'status':{'ok':True,'status':200,'ms':31,'data':st},
 'visionProgress':{'ok':True,'data':st['visionProgress']},
 'models':{'ok':True,'data':{'models':[{'model':m,'status':s} for m,s in [('oc/muse-spark-1.3-contributor-free','untested'),('oc/mimo-v2.5-free','untested'),('oc/nemotron-3.5-lightning-free','untested'),('kr/claude-sonnet-4.5','untested'),('local/brainhub-qwen3-vl-4b-16k','untested')]]}},
 'account':{'ok':True,'data':{'equity':80.54,'availableBalance':80.54}},
 'ollama':{'ok':True,'data':{'models':[{'name':'brainhub-qwen3-vl-4b-16k','size_vram':0}]}},
 'router':{'ok':True,'status':200,'ms':None},
 'backups':{'ok':True,'root':'C:\\BrainHubBackups','count':5,'latest':[{'name':n} for n in ['20260921-025836','20260921-025650','20260920-152710','20260920-133603','20260919-130948']]},
 'plans':sorted(plans,key=lambda p:-p['ts']),'lastJev':None,'lastRisk':{'symbol':'SAGAUSDT','ts':ago(2),'reasons':['PLAN_NOT_QUALIFIED']},
 'events':events,'log':{'ok':True,'mtime':iso(ago(1))}
}
snap['officeVersion']='1.1.0-CLAUDE-V109'
snap['demoLabel']="DEMO — 21 Eylül 09:24 ekran görüntülerindeki gerçek sayılar (PC v9.5.107). Gerçek Brain Hub'a bağlı değil."
json.dump(snap, open('demo-snapshot.json','w'), ensure_ascii=False, indent=1)
print('ok base', len(events), len(plans))

# ---- SİMÜLASYON: v9.5.109-CLAUDE panellerinin görünümü (UYDURULMUŞ sayılar) ----
import copy
sim = copy.deepcopy(snap)
sim['demoLabel']="SİMÜLASYON — v9.5.109-CLAUDE panellerini ve yürüyen trader'ları göstermek için UYDURULMUŞ örnek sayılar. Gerçek sonuç değildir; PC güncellenince gerçek veri gelir."
sst = sim['status']['data']
sst['featureVersion']='9.5.109-CLAUDE-VISION'; sst['armed']=False; sst['claudeMarker']='CLAUDE_V109'
sst['claudeV109Config']={'deterministicTriggerMode':'SHADOW','jevVetoPolicy':'V108_ANY_065','chaseAtrMultiple':1,'chaseCapPct':3}
sim['health']['data']={'featureVersion':'9.5.109-CLAUDE-VISION','builtBy':'Claude (Anthropic) • Cowork','claudeMarker':'CLAUDE_V109','claudeV109Config':sst['claudeV109Config']}
hh = sst['leaderAuto']['health']
hh.update({'deepAnalyses':12,'uniqueAnalyzedSymbols':9,'preJevQualified':2,'jevCalled':2,'jevVetoed':1,'qualified':1,'watch':8,'reviewRequired':2,'visionUnavailable':1,
  'intentReady':1,'executionResults':0,'ordersPlaced':0,'workerReviews':96,'workerWaits':88,'workerTriggers':5,'workerRefreshes':3,'fullVisionAvoided':88,'avgAnalysisMs':241000,'skippedBusy':41,
  'shadowPlans':8,'shadowTriggers':3,'shadow15mMeasured':2,'shadow60mMeasured':1,'shadowAvg15mPct':0.41,'shadowAvg60mPct':0.87,'shadowEvidenceHours':6.5,'shadowReady24h':False,
  'jevShadowCalled':8,'jevShadowWouldVeto':6,
  'claudeV109':{'config':sst['claudeV109Config'],'dtWouldQualify':3,'dtApplied':0,'triggerAutoSelected':5,'numericWaitFallback':2,'jevV108Veto':1,'jevRoleWeightedVeto':0,'jevShadowV108WouldVeto':6,'jevShadowRoleWeightedWouldVeto':2,'chaseBlocked':1},
  'topReasons':[{'reason':'LEADER_PLAN_NOT_QUALIFIED','count':8},{'reason':'WORKER_NUMERIC_TRIGGER_WAIT','count':6}]})
trig=[('PTBUSDT','LONG','15m',0.0412),('SAGAUSDT','SHORT','15m',0.2231),('AKEUSDT','LONG','30m',0.00187),('NEARUSDT','SHORT','1h',2.412)]
rows2=[]
for i,(sym,side,tf,px) in enumerate(trig):
    rows2.append(dict(symbol=sym,side=side,state='WATCH',planStatus='WATCH',originTF=tf,ownerTF='1h',workerState='WAIT',lastAnalyzedAt=ago(3+i*7),reanalysisEligible=True,
      triggerTF=tf,triggerLevelId='PRIOR20_HIGH' if side=='LONG' else 'PRIOR20_LOW',triggerPrice=px,triggerValid=True,
      waitFor=f"{tf} kapanışı {px} {'üstünde' if side=='LONG' else 'altında'} (CLAUDE_V109 sayısal tetik)",shadowTriggeredAt=ago(20) if i==0 else None))
sst['leaderAuto']['analysisLifecycle']['rows']=rows2
sst['leaderAuto']['planWorkers']['lastReview']={'symbol':'PTBUSDT','side':'LONG','state':'WAIT','source':'DETERMINISTIC','reason':'WORKER_NUMERIC_TRIGGER_WAIT (simülasyon)'}
sst['visionProgress']={'stage':'VISUAL_BATCH=15m,30m,45m','model':'local/brainhub-qwen3-vl-4b-16k','lastStageDurationMs':38000,'queueDepth':0,'pipelineActive':1,'error':None}
sim['visionProgress']={'ok':True,'data':sst['visionProgress']}
sim['plans']=[dict(p, status=('WATCH' if p['status']=='REVIEW_REQUIRED' else p['status']), fakeWait=False, waitFor='15m kapanışı … (sayısal tetik)') for p in sim['plans']]
sim['plans'][0]=dict(sim['plans'][0], symbol='PTBUSDT', side='LONG', status='QUALIFIED')
sim['lastRisk']={'symbol':'PTBUSDT','ts':ago(2),'reasons':['LIVE_NOT_ARMED']}
sim['lastJev']={'called':True,'veto':False,'shadow':False,'symbol':'PTBUSDT','side':'LONG','ts':ago(2),'reasons':[],'roleWeightedVeto':False,
  'probabilities':{'structuralVeto':0.18,'formingDependency':0.22,'dataQualityInsufficient':0.08,'directionConflict':0.21,'symbolPackageIntegrity':0.04,'originOwnerContinuity':0.31,'tfConflict':0.27,'smcLiquidityConflict':0.33,'microstructureReliability':0.29,'closedCandleConfirmation':0.24,'visualDataConsistency':0.19,'waitRequired':0.41},
  'timeframeConflicts':{'1m':0.35,'3m':0.22,'5m':0.18,'15m':0.12,'30m':0.2,'45m':0.15,'1h':0.28,'4h':0.44,'1d':0.52}}
sim['events']=[dict(ts=ago(1),kind='CLAUDE_V109_DT',symbol='SAGAUSDT',source='journal',desk='brain',title='Kod-tetik SAGAUSDT SHORT: QUALIFIED olurdu (gölge)',detail='15m kapanış kırılımı • (simülasyon)'),
               dict(ts=ago(2),kind='SHADOW_TRIGGER',symbol='PTBUSDT',source='journal',desk='workers',title='Gölge tetik PTBUSDT LONG • 15m PRIOR20_HIGH',detail='(simülasyon)')]+sim['events'][:20]
json.dump(sim, open('demo-sim-v109.json','w'), ensure_ascii=False, indent=1)
print('ok sim')
