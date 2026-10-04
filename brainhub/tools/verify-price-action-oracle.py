"""Offline only: regenerate the pinned pyvsmc FVG-only ORCA golden result.
Requires numpy. No network, credentials, workers or exchange execution.
Run from any directory; node regression tests use the committed golden file.
"""
from pathlib import Path
import sys, json
sys.dont_write_bytecode=True
import numpy as np
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'third-party/price-action/Khaymat--pyvsmc/src'))
from pyvsmc.order_blocks import detect_order_blocks
c=json.loads((root/'test/fixtures/r37-orca-5m.json').read_text())['candles']
a=lambda k:np.array([x[k] for x in c],dtype=float)
r=detect_order_blocks(a('open'),a('high'),a('low'),a('close'),lookback=5,use_bos=False,use_fvg=True,zone_mode='full',compute_mitigation=False)
zones=[]
for i in range(len(c)):
    if r.bullish_ob[i] or r.bearish_ob[i]:
        zones.append(dict(side='BULL' if r.bullish_ob[i] else 'BEAR',at=c[i]['closeTime'],confirmedAt=c[int(r.validated_index[i])]['closeTime'],low=float(r.ob_low[i]),high=float(r.ob_high[i])))
out=dict(repo='Khaymat/pyvsmc',commit='55008a6dce09e0e36691d2e34150f0f499ac4f4b',mode='FVG_ONLY_FULL_RANGE_LOOKBACK_5',zones=zones)
dest=root/'test/fixtures/r37-pyvsmc-golden.json'
dest.write_text(json.dumps(out,indent=2)+'\n')
print(f'{len(zones)} independently computed FVG OB origins -> {dest}')
