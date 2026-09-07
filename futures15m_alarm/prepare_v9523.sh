#!/usr/bin/env bash
set -euo pipefail

cat futures15m_alarm/v9.part00.b64 futures15m_alarm/v9.part01.b64 futures15m_alarm/v9.fix02a.b64 futures15m_alarm/v9.fix02b.b64 futures15m_alarm/v9.part03.b64 futures15m_alarm/v9.part04.b64 > /tmp/Futures15mAlarm-v9-source.b64
python3 - <<'PY'
import base64, hashlib, zipfile
from pathlib import Path
src=Path('/tmp/Futures15mAlarm-v9-source.b64'); dst=Path('/tmp/Futures15mAlarm-v9-source.zip')
data=base64.b64decode(src.read_text().strip()); dst.write_bytes(data)
print('v9 base ZIP bytes:',len(data)); print('v9 base SHA256:',hashlib.sha256(data).hexdigest())
if not zipfile.is_zipfile(dst): raise SystemExit('Decoded v9 source is not a ZIP')
with zipfile.ZipFile(dst,'r') as zf:
    bad=zf.testzip()
    if bad: raise SystemExit('Corrupt ZIP member: '+bad)
PY

rm -rf /tmp/futures15m-build
mkdir -p /tmp/futures15m-build
unzip -q /tmp/Futures15mAlarm-v9-source.zip -d /tmp/futures15m-build

python3 "$CM_BUILD_DIR/futures15m_alarm/v91_patch.py"
python3 "$CM_BUILD_DIR/futures15m_alarm/v92_binance_patch.py"
python3 - <<'PY'
import base64,gzip,os
from pathlib import Path
root=Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app')
build=Path('/tmp/futures15m-build/Futures15mAlarm/app/build.gradle')
srcroot=Path(os.environ['CM_BUILD_DIR'])/'futures15m_alarm'
for payload,target in [('v93_MainActivity.gz.b64',root/'MainActivity.java'),('v93_MonitorService.gz.b64',root/'MonitorService.java')]:
    target.write_bytes(gzip.decompress(base64.b64decode((srcroot/payload).read_text().strip())))
b=build.read_text().replace('versionCode 11','versionCode 12').replace("versionName '9.2.0'","versionName '9.3.0'")
build.write_text(b)
PY

patches=(
  v94_patch.py
  v95_pre_anchor.py
  v95_patch.py
  v951_import_dialog_fix.py
  v952_logic_ui_fix.py
  v953_signal_guard.py
  v954_reclaim_precision.py
  v955_ui_icon.py
  v956_stale_flow_radar.py
  v957_launcher_cache_fix.py
  v958_forming_candles.py
  v959_conditional_scenarios.py
  v9510_plan_parser.py
  v9511_same_chat_external.py
  v9512_chatgpt_launch_fix.py
  v9513_prompt_image_handoff.py
  v9514_java_string_fix.py
  v9515_prompt_dialog_ui.py
  v9516_structure_engine.py
  v9517_fresh_signal_history_hunt.py
  v9517b_flow_stability.py
  v9518a_ui_tr.py
  v9518b_signal_tracking.py
  v9519_prompt_quality.py
  v9520_professional_ui_prompt.py
  v9520b_turkish_labels.py
  v9520c_compile_safe.py
  v9521_trade_handoff_logic.py
  v9521b_ltf_meta_compat.py
  v9522a_weighted_ltf.py
  v9522a2_binance_anchor_compat.py
  v9522b_api_order.py
  v9522c_api_guard_ui.py
  v9523_profit_target_precision.py
  v9524_binance_native_deeplink.py
  v9524b_manifest_query_fix.py
  v9525_dynamic_retest_precision.py
  v9525b_dynamic_reentry_monitor.py
)
for p in "${patches[@]}"; do
  echo "--- patch: $p"
  python3 "$CM_BUILD_DIR/futures15m_alarm/$p"
done

python3 - <<'PY'
from pathlib import Path
app=Path('/tmp/futures15m-build/Futures15mAlarm')
main=(app/'app/src/main/java/com/futuresalarm/app/MainActivity.java').read_text()
mon=(app/'app/src/main/java/com/futuresalarm/app/MonitorService.java').read_text()
ana=(app/'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java').read_text()
eng=(app/'app/src/main/java/com/futuresalarm/app/StructureEngine.java').read_text()
manifest=(app/'app/src/main/AndroidManifest.xml').read_text()
build=(app/'app/build.gradle').read_text()
root=manifest.find('<manifest'); q=manifest.find('<queries>', root); ap=manifest.find('<application', root)
checks={
  'main v9.5.25':'v9.5.25' in main,
  'native Binance Futures deep link':'binance://futures/trade?symbol=' in main and 'com.binance.dev' in main,
  'native Binance fallback':'v9524LaunchBinanceHome' in main and 'Binance uygulaması bulunamadı' in main,
  'Binance package visibility':'<package android:name="com.binance.dev" />' in manifest and q > root and (ap < 0 or q < ap),
  'secure API storage':'AndroidKeyStore' in main and 'AES/GCM/NoPadding' in main,
  'API diagnostics':'V9523_API_DIAGNOSTICS' in main and '/fapi/v1/accountConfig' in main,
  'manual API confirmation':'SON EMİR ONAYI • RİSK / KÂR' in main and "EMİRLERİ BINANCE'A GÖNDER" in main,
  'USDT PnL preview':'riskUsd' in main and 'splitAllTpUsd' in main,
  'dynamic TP split':'V9523_DYNAMIC_TP_SPLIT_AND_PNL' in main and 'TREND %25 / %25 / %50' in main,
  'protective orders':'STOP_MARKET' in main and 'TAKE_PROFIT_MARKET' in main and 'v9522EmergencyClose' in main,
  'weighted flow':'V9522_WEIGHTED_FLOW' in mon and 'support < 22' in mon,
  'weighted prompt':'V9522_WEIGHTED_DECISION_LTF' in ana and 'YALNIZ DÖRT SERT VETO' in ana,
  'chart-data crosscheck':'GRAFİK/VERİ ÇAPRAZ DOĞRULAMA:' in ana,
  'target quality':'KÂR POTANSİYELİ KURALI:' in ana and 'TP AYRIŞMA KURALI:' in ana,
  'dynamic structural retest':'V9525_DYNAMIC_STRUCTURAL_RETEST' in ana and 'DİNAMİK RETEST / YENİDEN KABUL KURALI:' in ana,
  'dynamic retest META':'RETEST:<ORIJINAL/5M_FVG/5M_OB/5M_BREAKER/5M_FIB/5M_SWING/KARMA/NONE>' in ana,
  'dynamic retest map':'V9525_DYNAMIC_RETEST_MAP' in eng and 'Dinamik Retest Adayları' in eng,
  'live 5m dynamic monitor':'V9525B_LIVE_5M_DYNAMIC_REENTRY' in mon and 'v9525EvaluateDynamicReentry' in mon,
  '5m structural families':'v9525AddFvgZones' in mon and 'v9525AddObZone' in mon and 'v9525AddFibZones' in mon and 'v9525AddSwingZone' in mon,
  '5m no-open-candle':'closeTime>=now' in mon and 'age>90000L' in mon,
  '5m no-chase and RR':'1.0035' in mon and '(t1-live)/risk<1.0' in mon and '(live-t1)/risk<1.0' in mon,
  'dynamic signal reasons':'LONG DİNAMİK RETEST' in mon and 'SHORT DİNAMİK RETEST' in mon and 'orijinal giriş kovalanmadı' in mon,
  'original 15m reclaim retained':'closed.close >= p.pullbackHigh' in mon and 'closed.close <= p.resistanceLow' in mon,
  'six timeframes':'{"15m", "5m", "3m", "1h", "4h", "1d"}' in ana,
  'LTF structure':'{"15m", "5m", "3m", "1h", "4h", "1d"}' in eng,
  'signal tracking':'v9518RecordSignal' in mon and 'v9518UpdateSignalResult' in mon,
  'fresh signal':'v9517FreshSignalEligible' in mon,
  'version':'versionCode 39' in build and "versionName '9.5.25'" in build,
}
print('--- Final v9.5.25 checks ---')
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.25 sanity check failed: '+', '.join(bad))
print('Final v9.5.25 sanity checks OK.')
PY
