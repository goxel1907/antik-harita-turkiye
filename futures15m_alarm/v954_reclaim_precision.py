from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MONITOR = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MONITOR, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.4 missing: {p}')

# ------------------------------------------------------------------
# MainActivity: explain the stricter professional confirmation rule.
# ------------------------------------------------------------------
s = MAIN.read_text()
s = s.replace('15m Futures Alarm PRO v9.5.3', '15m Futures Alarm PRO v9.5.4')
s = s.replace('15m Futures Alarm PRO v9.5.2', '15m Futures Alarm PRO v9.5.4')

old_long = ('Yalnız LONG senaryoları aktif adaydır. Alarm için: tamamlanmış 15m teyit + fiyat hâlâ giriş aralığında + canlı flow kabul edilebilir olmalı.')
new_long = ('Yalnız LONG senaryoları aktif adaydır. Pullback için yalnız bölge teması YETMEZ: tamamlanmış 15m mum pullback üst sınırını reclaim etmelidir. Breakout için wick değil tamamlanmış 15m kapanış gerekir. Fiyat hâlâ giriş yakınında ve canlı flow uygun olmalıdır.')
s = s.replace(old_long, new_long)

old_short = ('Yalnız SHORT senaryoları aktif adaydır. Alarm için: tamamlanmış 15m teyit + fiyat hâlâ giriş aralığında + canlı flow kabul edilebilir olmalı.')
new_short = ('Yalnız SHORT senaryoları aktif adaydır. Direnç için yalnız bölge teması YETMEZ: tamamlanmış 15m mum direnç alt sınırının altına rejection kapanışı yapmalıdır. Breakdown için wick değil tamamlanmış 15m kapanış gerekir. Fiyat hâlâ giriş yakınında ve canlı flow uygun olmalıdır.')
s = s.replace(old_short, new_short)

# Keep the copied master prompt aligned with the actual alarm engine.
rule = 'Breakout/breakdown için TAMAMLANMIŞ 15m mum kapanışı şart olsun.'
extra = ('Breakout/breakdown için TAMAMLANMIŞ 15m mum kapanışı şart olsun. '
         'LONG pullback teyidinde fiyatın bölgeye yalnız temas etmesi yeterli değildir; bölge teması sonrası TAMAMLANMIŞ 15m mum pullHigh üzerinde kapanarak reclaim yapmalıdır. '
         'SHORT direnç/rejection teyidinde bölge teması sonrası TAMAMLANMIŞ 15m mum resLow altında kapanmalıdır. Wick/temas tek başına işlem sinyali değildir.')
if rule in s and 'pullHigh üzerinde kapanarak reclaim' not in s:
    s = s.replace(rule, extra, 1)
MAIN.write_text(s)

# ------------------------------------------------------------------
# MonitorService: strict edge reclaim/rejection + safer live-flow gate.
# ------------------------------------------------------------------
m = MONITOR.read_text()
m = m.replace('15m Futures Alarm PRO v9.5.3', '15m Futures Alarm PRO v9.5.4')
m = m.replace('15m Futures Alarm PRO v9.5.2', '15m Futures Alarm PRO v9.5.4')

# LONG pullback: touch + bullish completed candle + close above upper edge.
old_pull = '''        boolean pullRaw = pullTouched && closed.close > closed.open && closed.close >= pullMid;
        double v953LivePrice = (set.current != null ? set.current.close : closed.close);
        boolean pullConfirmed = v953DirectionAllowed(p.symbol, true)
                && pullRaw
                && v953FlowAcceptable(true, market, false)
                && v953InEntryRange(v953LivePrice, p.pullbackLow, p.pullbackHigh, 0.50);'''
new_pull = '''        // v9.5.4: professional pullback confirmation.
        // Touch/wick alone is NOT a signal. The completed 15m candle must reclaim
        // the upper edge of the LONG pullback zone after touching it.
        boolean v954PullReclaim = pullTouched
                && closed.close > closed.open
                && closed.close >= p.pullbackHigh;
        double v953LivePrice = (set.current != null ? set.current.close : closed.close);
        boolean pullConfirmed = v953DirectionAllowed(p.symbol, true)
                && v954PullReclaim
                && v953FlowAcceptable(true, market, false)
                && v953InEntryRange(v953LivePrice, p.pullbackLow, p.pullbackHigh, 0.50);'''
if old_pull in m:
    m = m.replace(old_pull, new_pull, 1)
elif 'boolean v954PullReclaim' not in m:
    raise SystemExit('v9.5.4: LONG pullback anchor not found')

# SHORT resistance: touch + bearish completed candle + close below lower edge.
old_res = '''        boolean resRaw = resTouched && closed.close < closed.open && closed.close <= resMid;
        boolean resConfirmed = v953DirectionAllowed(p.symbol, false)
                && resRaw
                && v953FlowAcceptable(false, market, false)
                && v953InEntryRange(v953LivePrice, p.resistanceLow, p.resistanceHigh, 0.50);'''
new_res = '''        // v9.5.4: professional resistance rejection confirmation.
        // Touch/wick alone is NOT a signal. The completed 15m candle must reject
        // back below the lower edge of the SHORT resistance zone.
        boolean v954ResReject = resTouched
                && closed.close < closed.open
                && closed.close <= p.resistanceLow;
        boolean resConfirmed = v953DirectionAllowed(p.symbol, false)
                && v954ResReject
                && v953FlowAcceptable(false, market, false)
                && v953InEntryRange(v953LivePrice, p.resistanceLow, p.resistanceHigh, 0.50);'''
if old_res in m:
    m = m.replace(old_res, new_res, 1)
elif 'boolean v954ResReject' not in m:
    raise SystemExit('v9.5.4: SHORT resistance anchor not found')

# High-accuracy mode: if live confirmation data is incomplete, do not fire.
m = m.replace('if (sc[2] < 3) return false;', 'if (sc[2] < 4) return false;', 1)
m = m.replace('if (support < 35) return false;', 'if (support < 40) return false;', 1)
m = m.replace('double minVol = breakoutStyle ? 0.70 : 0.55;',
              'double minVol = breakoutStyle ? 1.00 : 0.70;', 1)

# Make the alarm gate wording match the real engine.
generic_gate = '• Alarm = tamamlanmış 15m teyit + fiyat giriş aralığında + flow filtresi uygun\\n'
strict_gate = ('• Pullback/direnç alarmı = bölge teması + tamamlanmış 15m reclaim/rejection + fiyat giriş yakınında + flow uygun\\n'
               '• Breakout/breakdown alarmı = TAMAMLANMIŞ 15m kapanış + fiyat giriş aralığında + flow uygun; wick tek başına yetmez\\n')
m = m.replace(generic_gate, strict_gate)

# CVD is based on at most 1000 aggTrades. Make the limitation visible so a
# large number is not mistaken for a full 15-minute sample on very busy coins.
m = m.replace('(≤1000 aggTrade)', '(≤1000 aggTrade; yoğun coinde kapsama 15m’den kısa olabilir)')
m = m.replace('(<=1000 aggTrade)', '(<=1000 aggTrade; yoğun coinde kapsama 15m’den kısa olabilir)')

MONITOR.write_text(m)

# ------------------------------------------------------------------
# Analysis-package prompt: tell ChatGPT the same reclaim/rejection semantics.
# ------------------------------------------------------------------
a = ANALYSIS.read_text()
a = a.replace('15m Futures Alarm PRO v9.5.3', '15m Futures Alarm PRO v9.5.4')
a = a.replace('Futures15mAlarmPRO/9.5', 'Futures15mAlarmPRO/9.5.4')
if rule in a and 'pullHigh üzerinde kapanarak reclaim' not in a:
    a = a.replace(rule, extra, 1)
ANALYSIS.write_text(a)

# ------------------------------------------------------------------
# Version bump.
# ------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 18', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.4'", b, count=1)
BUILD.write_text(b)

mf = MAIN.read_text()
mon = MONITOR.read_text()
af = ANALYSIS.read_text()
bf = BUILD.read_text()
checks = [
    ('15m Futures Alarm PRO v9.5.4' in mf, 'title'),
    ('pullHigh üzerinde kapanarak reclaim' in mf or 'pullback üst sınırını reclaim' in mf, 'master prompt reclaim rule'),
    ('boolean v954PullReclaim' in mon, 'strict LONG reclaim'),
    ('closed.close >= p.pullbackHigh' in mon, 'LONG upper-edge close'),
    ('boolean v954ResReject' in mon, 'strict SHORT rejection'),
    ('closed.close <= p.resistanceLow' in mon, 'SHORT lower-edge close'),
    ('if (sc[2] < 4) return false;' in mon, 'minimum live metrics'),
    ('if (support < 40) return false;' in mon, 'flow score threshold'),
    ('breakoutStyle ? 1.00 : 0.70' in mon, 'volume threshold'),
    ('reclaim/rejection' in mon, 'alarm gate wording'),
    ('kapsama 15m’den kısa olabilir' in mon or 'kapsama 15m\'den kısa olabilir' in mon, 'CVD sample warning'),
    ('versionCode 18' in bf and "versionName '9.5.4'" in bf, 'version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.4 check failed: ' + msg)

print('v9.5.4 OK: strict pullback reclaim + resistance rejection + stronger flow/volume guard + visible CVD sample limitation.')
