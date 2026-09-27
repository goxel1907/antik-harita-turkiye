# JEV Sovereign Evidence – open-source research notes

This BrainHub implementation does **not** vendor third-party source code. It re-implements small, testable evidence concepts against BrainHub's existing Binance public-data pipeline.

Research references used for design:
- OctopusTakopi/binance_l3_est (MIT): L2/L3-estimation research, order/cancel metrics, whale/TWAP-style footprint ideas.
- mamonet/orderbook-heatmap (MIT): public depth + aggTrade heatmap, CVD/imbalance/absorption ideas.
- MYMDO/CryptoTradingLiquidationMap (MIT): observed liquidation and liquidation-visualization concepts.

BrainHub invariants:
- JEV is the final strategic authority.
- Scanner is ATTENTION_ONLY.
- Workers and all OSS-derived analytics are EVIDENCE_ONLY.
- Public-data heuristics never identify a market maker or prove spoofing/iceberg intent.
- Observed Binance forceOrder prints are distinguished from any estimated liquidation zone.
- Binance/BrainHub numeric truth outranks visual interpretation.
- User-owned margin/leverage/max-position envelope is not rewritten here.
- Hard execution safety remains deterministic and fail-closed.
